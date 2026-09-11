"use server";

import { revalidatePath } from "next/cache";
import type { ModelMessage } from "ai";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveAccess, can } from "@/lib/rbac";
import { loadAiContext, runStructured, resolveChain } from "@/lib/ai/router";
import { matrixProposalSchema, reviewSchema, documentModePrompt, contextModePrompt, reviewModePrompt, SYSTEM_BASE, PROMPT_VERSION, type MatrixProposal, type MatrixReview, type MasterDataNames, type ProjectContext } from "@/lib/ai/schema";
import { extractDocument } from "@/lib/ai/extract";
import { effectiveNorms, normsAsPromptText } from "@/lib/ai/norms";
import { mapName, mapRotation, type Alias, type Mapping } from "@/lib/ai/mapping";

type Supa = Awaited<ReturnType<typeof createClient>>;

async function requireMatrixManage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "crew.matrix.manage")) throw new Error("You don't have permission to manage crew matrices.");
  if (!access.orgId) throw new Error("No company context.");
  return { supabase, access, userId: user.id, orgId: access.orgId };
}

function unwrap<T>(x: T | T[] | null | undefined): T | null {
  if (!x) return null;
  return Array.isArray(x) ? x[0] ?? null : x;
}

type Named = { name?: string };
type Rel<T> = T | T[] | null;
type HistoryMatrixRow = {
  id: string;
  title: string;
  expected_pob: number | null;
  status: string;
  offshore_sites: Rel<{ name?: string; site_type?: string }>;
  crew_matrix_lines: { required_headcount: number; job_roles: Rel<Named> }[] | null;
};
type ReviewLineRow = {
  required_headcount: number;
  day_shift_quantity: number | null;
  night_shift_quantity: number | null;
  other_shift_quantity: number | null;
  minimum_experience_years: number | null;
  nationality_preference: string | null;
  language_requirement: string | null;
  client_approval_required: boolean | null;
  job_roles: Rel<Named>;
  rotation_templates: Rel<Named>;
  crew_matrix_line_documents: { is_mandatory: boolean | null; waiver_permitted: boolean | null; document_types: Rel<Named> }[] | null;
  crew_matrix_line_skills: { skills: Rel<Named> }[] | null;
};

/* ================= Shared loaders ================= */

async function loadProjectContext(supabase: Supa, projectId: string, siteId: string): Promise<ProjectContext | { error: string }> {
  const [{ data: project }, { data: site }] = await Promise.all([
    supabase.from("projects").select("project_name, expected_pob, country, operating_region, planned_start_date, planned_end_date, notes, contract_id, contracts(contract_title, contract_services(service))").eq("id", projectId).single(),
    supabase.from("offshore_sites").select("name, site_type").eq("id", siteId).single(),
  ]);
  if (!project || !site) return { error: "Could not find that project or site." };
  const contract = unwrap<{ contract_title?: string; contract_services?: { service: string }[] | { service: string } }>(project.contracts as unknown as Record<string, unknown>);
  const servicesRaw = contract?.contract_services;
  const services = (Array.isArray(servicesRaw) ? servicesRaw : servicesRaw ? [servicesRaw] : []).map((s) => s.service.replace(/_/g, " "));
  return {
    projectName: project.project_name,
    contractTitle: contract?.contract_title ?? null,
    services,
    siteName: site.name,
    siteType: site.site_type ?? null,
    expectedPob: project.expected_pob ?? null,
    country: project.country ?? null,
    region: project.operating_region ?? null,
    plannedStart: project.planned_start_date ?? null,
    plannedEnd: project.planned_end_date ?? null,
    notes: project.notes ?? null,
  };
}

type MasterData = {
  jobRoles: { id: string; name: string }[];
  skills: { id: string; name: string }[];
  documentTypes: { id: string; name: string }[];
  rotationTemplates: { id: string; name: string; days_on: number | null; days_off: number | null }[];
  aliases: Alias[];
};

async function loadMasterData(supabase: Supa, orgId: string): Promise<MasterData> {
  const [jr, sk, dt, rt, al] = await Promise.all([
    supabase.from("job_roles").select("id, name").eq("org_id", orgId).eq("is_active", true).order("name"),
    supabase.from("skills").select("id, name").eq("org_id", orgId).order("name"),
    supabase.from("document_types").select("id, name").eq("org_id", orgId).eq("is_active", true).order("name"),
    supabase.from("rotation_templates").select("id, name, days_on, days_off").eq("org_id", orgId).eq("is_active", true).order("name"),
    supabase.from("ai_name_aliases").select("entity_type, alias, target_id").eq("org_id", orgId),
  ]);
  return { jobRoles: jr.data ?? [], skills: sk.data ?? [], documentTypes: dt.data ?? [], rotationTemplates: rt.data ?? [], aliases: (al.data ?? []) as Alias[] };
}

function masterNames(md: MasterData): MasterDataNames {
  return { jobRoles: md.jobRoles.map((x) => x.name), skills: md.skills.map((x) => x.name), documentTypes: md.documentTypes.map((x) => x.name), rotationTemplates: md.rotationTemplates.map((x) => x.name) };
}

async function loadNormsText(supabase: Supa, orgId: string) {
  const { data } = await supabase.from("ai_norm_overrides").select("norm_key, value_text, is_active").eq("org_id", orgId);
  return normsAsPromptText(effectiveNorms(data ?? []));
}

async function loadHistoryText(supabase: Supa, orgId: string) {
  const { data: matrices } = await supabase
    .from("crew_matrices")
    .select("id, title, expected_pob, status, offshore_sites(name, site_type), crew_matrix_lines(required_headcount, job_roles(name))")
    .eq("org_id", orgId)
    .in("status", ["approved", "active", "superseded"])
    .order("updated_at", { ascending: false })
    .limit(8);
  return ((matrices ?? []) as unknown as HistoryMatrixRow[])
    .map((m) => {
      const site = unwrap(m.offshore_sites);
      const lines = (m.crew_matrix_lines ?? []).map((l) => `${unwrap<{ name?: string }>(l.job_roles)?.name ?? "?"} ×${l.required_headcount}`).join(", ");
      return `- ${m.title} (${site?.name ?? "?"}${site?.site_type ? `, ${site.site_type}` : ""}, POB ${m.expected_pob ?? "?"}, ${m.status}): ${lines || "no lines"}`;
    })
    .join("\n");
}

/* ================= Mapped proposal (what the review screen edits) ================= */

export type MappedDocument = { name: string; mapping: Mapping; is_mandatory: boolean; waiver_permitted: boolean; minimum_remaining_validity_days: number | null };
export type MappedLine = {
  job_role: Mapping;
  required_headcount: number;
  day_shift_quantity: number | null;
  night_shift_quantity: number | null;
  other_shift_quantity: number | null;
  rotation: Mapping | null;
  employment_type_preference: string | null;
  nationality_preference: string | null;
  language_requirement: string | null;
  minimum_experience_years: number | null;
  mobilization_lead_days: number | null;
  client_approval_required: boolean;
  remarks: string | null;
  documents: MappedDocument[];
  skills: Mapping[];
  competencies: { name: string; minimum_grade: string | null }[];
  client_requirements: { text: string; is_mandatory: boolean }[];
  confidence: number;
  source_excerpt: string | null;
  norm_applied: string | null;
};
export type MappedProposal = {
  generationId: string;
  title: string | null;
  expected_pob: number | null;
  lines: MappedLine[];
  assumptions: string[];
  open_questions: string[];
  modelLabel: string;
  attempts: { model: string; outcome: string }[];
  masterData: { jobRoles: { id: string; name: string }[]; skills: { id: string; name: string }[]; documentTypes: { id: string; name: string }[]; rotationTemplates: { id: string; name: string }[] };
};

function mapProposal(p: MatrixProposal, md: MasterData): Omit<MappedProposal, "generationId" | "modelLabel" | "attempts" | "masterData"> {
  return {
    title: p.title,
    expected_pob: p.expected_pob,
    assumptions: p.assumptions,
    open_questions: p.open_questions,
    lines: p.lines.map((l) => ({
      job_role: mapName(l.job_role_name, "job_role", md.jobRoles, md.aliases),
      required_headcount: l.required_headcount,
      day_shift_quantity: l.day_shift_quantity,
      night_shift_quantity: l.night_shift_quantity,
      other_shift_quantity: l.other_shift_quantity,
      rotation: l.rotation_name ? mapRotation(l.rotation_name, md.rotationTemplates, md.aliases) : null,
      employment_type_preference: l.employment_type_preference,
      nationality_preference: l.nationality_preference,
      language_requirement: l.language_requirement,
      minimum_experience_years: l.minimum_experience_years,
      mobilization_lead_days: l.mobilization_lead_days,
      client_approval_required: l.client_approval_required,
      remarks: l.remarks,
      documents: l.required_documents.map((d) => ({ name: d.name, mapping: mapName(d.name, "document_type", md.documentTypes, md.aliases), is_mandatory: d.is_mandatory, waiver_permitted: d.waiver_permitted, minimum_remaining_validity_days: d.minimum_remaining_validity_days })),
      skills: l.required_skills.map((s) => mapName(s, "skill", md.skills, md.aliases)),
      competencies: l.competencies,
      client_requirements: l.client_requirements,
      confidence: l.confidence,
      source_excerpt: l.source_excerpt,
      norm_applied: l.norm_applied,
    })),
  };
}

/* ================= Availability (for the New Matrix screen) ================= */

export async function aiAvailability(): Promise<{ enabled: boolean; reason: string | null; maxUploadMb: number; documentCapable: boolean }> {
  const { supabase, orgId } = await requireMatrixManage();
  const ctx = await loadAiContext(supabase, orgId);
  if (!ctx.settings.ai_enabled) return { enabled: false, reason: "AI features are disabled for this company.", maxUploadMb: ctx.settings.max_upload_mb, documentCapable: false };
  const text = resolveChain(ctx, "matrix_from_context", false);
  const docs = resolveChain(ctx, "matrix_from_document", true);
  if (text.chain.length === 0) {
    const why = text.skipped.length ? text.skipped.map((s) => `${s.model.display_name}: ${s.skipReason}`).join("; ") : "no models configured";
    return { enabled: false, reason: `No usable AI model (${why}). Configure one under Administration → AI Settings.`, maxUploadMb: ctx.settings.max_upload_mb, documentCapable: false };
  }
  return { enabled: true, reason: null, maxUploadMb: ctx.settings.max_upload_mb, documentCapable: docs.chain.length > 0 };
}

/* ================= Generate ================= */

export async function generateMatrixDraft(formData: FormData): Promise<{ proposal: MappedProposal } | { error: string; attempts?: { model: string; outcome: string }[] }> {
  const { supabase, userId, orgId } = await requireMatrixManage();
  const mode = String(formData.get("mode") ?? "context");
  const projectId = String(formData.get("projectId") ?? "");
  const siteId = String(formData.get("offshoreSiteId") ?? "");
  const pasted = String(formData.get("pastedText") ?? "").trim();
  const file = formData.get("file");
  if (!projectId || !siteId) return { error: "Project and offshore site are required." };

  const ctx = await loadAiContext(supabase, orgId);
  const context = await loadProjectContext(supabase, projectId, siteId);
  if ("error" in context) return context;
  const md = await loadMasterData(supabase, orgId);
  const names = masterNames(md);

  let messages: ModelMessage[];
  let task: "matrix_from_document" | "matrix_from_context";
  let needsDocuments = false;
  let sourceFilename: string | null = null;
  let extracted: Awaited<ReturnType<typeof extractDocument>> | null = null;
  let inputSummary = "";

  if (mode === "document") {
    task = "matrix_from_document";
    if (file instanceof File && file.size > 0) {
      if (file.size > ctx.settings.max_upload_mb * 1024 * 1024) return { error: `File is larger than the ${ctx.settings.max_upload_mb} MB limit.` };
      extracted = await extractDocument(file);
      sourceFilename = extracted.filename;
    }
    if (!extracted && !pasted) return { error: "Upload a document or paste the requirement text." };
    const documentText = [pasted, extracted?.text].filter(Boolean).join("\n\n") || null;
    needsDocuments = !!extracted?.needsModelVision;
    const prompt = documentModePrompt({ context, masterData: names, documentText, hasAttachedFile: needsDocuments });
    const content: Exclude<ModelMessage, { role: "system" | "assistant" | "tool" }>["content"] = needsDocuments && extracted
      ? [{ type: "text", text: prompt }, { type: "file", data: extracted.bytes, mediaType: extracted.mediaType, filename: extracted.filename }]
      : prompt;
    messages = [{ role: "user", content }];
    inputSummary = `document: ${sourceFilename ?? "pasted text"} (${documentText ? documentText.length : 0} chars${needsDocuments ? ", read by model" : ""})`;
  } else {
    task = "matrix_from_context";
    const [normsText, historyText] = await Promise.all([loadNormsText(supabase, orgId), loadHistoryText(supabase, orgId)]);
    messages = [{ role: "user", content: contextModePrompt({ context, masterData: names, normsText, historyText }) }];
    inputSummary = `context: ${context.siteName}, POB ${context.expectedPob ?? "?"}, services ${context.services.join("/") || "?"}`;
  }

  const result = await runStructured(supabase, ctx, { task, schema: matrixProposalSchema, system: SYSTEM_BASE, messages, needsDocuments, userId });
  if ("error" in result) return { error: result.error, attempts: result.attempts };

  const { data: gen, error: genError } = await supabase
    .from("ai_generations")
    .insert({
      org_id: orgId,
      task,
      project_id: projectId,
      offshore_site_id: siteId,
      status: "draft",
      provider: result.model.provider,
      model_id: result.model.model_id,
      prompt_version: PROMPT_VERSION,
      input_summary: inputSummary,
      source_filename: sourceFilename,
      raw_output: result.object,
      created_by: userId,
    })
    .select("id")
    .single();
  if (genError) return { error: genError.message };
  const generationId = gen!.id as string;

  if (ctx.settings.keep_source_documents && extracted) {
    const path = `${orgId}/${generationId}/${extracted.filename.replace(/[^\w.\-]+/g, "_")}`;
    const { error: upErr } = await supabase.storage.from("ai-source-documents").upload(path, extracted.bytes, { contentType: extracted.mediaType, upsert: true });
    if (!upErr) await supabase.from("ai_generations").update({ source_document_path: path }).eq("id", generationId);
  }

  const mapped = mapProposal(result.object, md);
  return {
    proposal: {
      generationId,
      ...mapped,
      modelLabel: `${result.model.display_name} (${result.model.cost_tier})`,
      attempts: result.attempts,
      masterData: { jobRoles: md.jobRoles, skills: md.skills, documentTypes: md.documentTypes, rotationTemplates: md.rotationTemplates.map((r) => ({ id: r.id, name: r.name })) },
    },
  };
}

/* ================= Save the reviewed proposal as a draft matrix ================= */

type SavePayload = {
  title: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  expectedPob: number | null;
  notes: string | null;
  lines: {
    job_role_id: string | null;
    new_job_role_name: string | null;
    job_role_alias: string | null;
    required_headcount: number;
    day_shift_quantity: number | null;
    night_shift_quantity: number | null;
    other_shift_quantity: number | null;
    rotation_template_id: string | null;
    employment_type_preference: string | null;
    nationality_preference: string | null;
    language_requirement: string | null;
    minimum_experience_years: number | null;
    mobilization_lead_days: number | null;
    client_approval_required: boolean;
    remarks: string | null;
    documents: { document_type_id: string | null; new_name: string | null; alias: string | null; is_mandatory: boolean; waiver_permitted: boolean; minimum_remaining_validity_days: number | null }[];
    skills: { skill_id: string | null; new_name: string | null; alias: string | null }[];
    competencies: { name: string; minimum_grade: string | null }[];
    client_requirements: { text: string; is_mandatory: boolean }[];
  }[];
};

export async function saveGeneratedMatrix(generationId: string, payloadJson: string) {
  const { supabase, userId, orgId } = await requireMatrixManage();
  let payload: SavePayload;
  try {
    payload = JSON.parse(payloadJson);
  } catch {
    return { error: "Invalid payload." };
  }
  if (!payload.title?.trim()) return { error: "Title is required." };
  if (!payload.lines?.length) return { error: "Add at least one line." };

  const { data: gen } = await supabase.from("ai_generations").select("id, project_id, offshore_site_id, status").eq("id", generationId).single();
  if (!gen || !gen.project_id || !gen.offshore_site_id) return { error: "Could not find the AI generation to save." };
  if (gen.status === "saved") return { error: "This proposal has already been saved." };

  // Create any master data the reviewer chose to create, and remember aliases.
  const createdRoles = new Map<string, string>();
  const createdSkills = new Map<string, string>();
  const createdDocs = new Map<string, string>();
  const ensure = async (table: "job_roles" | "skills" | "document_types", name: string, cache: Map<string, string>, extra: Record<string, unknown> = {}) => {
    const key = name.trim().toLowerCase();
    if (cache.has(key)) return cache.get(key)!;
    const { data: existing } = await supabase.from(table).select("id").eq("org_id", orgId).ilike("name", name.trim()).maybeSingle();
    if (existing) {
      cache.set(key, existing.id);
      return existing.id as string;
    }
    const { data, error } = await supabase.from(table).insert({ org_id: orgId, name: name.trim(), ...extra }).select("id").single();
    if (error) throw new Error(`Could not create ${table.replace(/_/g, " ")} "${name}": ${error.message}`);
    cache.set(key, data.id);
    return data.id as string;
  };
  const aliasRows: { org_id: string; entity_type: string; alias: string; target_id: string; created_by: string }[] = [];

  try {
    const resolvedLines = [];
    for (const l of payload.lines) {
      const jobRoleId = l.job_role_id ?? (l.new_job_role_name ? await ensure("job_roles", l.new_job_role_name, createdRoles, { created_by: userId }) : null);
      if (!jobRoleId) return { error: "Every line needs a job role (map it or create it)." };
      if (l.job_role_alias && l.job_role_id) aliasRows.push({ org_id: orgId, entity_type: "job_role", alias: l.job_role_alias, target_id: l.job_role_id, created_by: userId });
      const docs = [];
      for (const d of l.documents) {
        const id = d.document_type_id ?? (d.new_name ? await ensure("document_types", d.new_name, createdDocs, { category: "certificate", tracks_number: true, created_by: userId }) : null);
        if (!id) continue;
        if (d.alias && d.document_type_id) aliasRows.push({ org_id: orgId, entity_type: "document_type", alias: d.alias, target_id: d.document_type_id, created_by: userId });
        docs.push({ document_type_id: id, is_mandatory: d.is_mandatory, waiver_permitted: d.waiver_permitted, minimum_remaining_validity_days: d.minimum_remaining_validity_days });
      }
      const skills = [];
      for (const s of l.skills) {
        const id = s.skill_id ?? (s.new_name ? await ensure("skills", s.new_name, createdSkills) : null);
        if (!id) continue;
        if (s.alias && s.skill_id) aliasRows.push({ org_id: orgId, entity_type: "skill", alias: s.alias, target_id: s.skill_id, created_by: userId });
        skills.push(id);
      }
      resolvedLines.push({ ...l, jobRoleId, docs, skillIds: Array.from(new Set(skills)) });
    }

    const { data: code, error: codeError } = await supabase.rpc("next_number_range_code", { p_org_id: orgId, p_entity_type: "crew_matrix" });
    if (codeError) return { error: `Could not assign a matrix number: ${codeError.message}` };

    const { data: matrix, error } = await supabase
      .from("crew_matrices")
      .insert({
        org_id: orgId,
        project_id: gen.project_id,
        offshore_site_id: gen.offshore_site_id,
        matrix_number: code,
        version_number: 1,
        title: payload.title.trim(),
        effective_from: payload.effectiveFrom || null,
        effective_to: payload.effectiveTo || null,
        expected_pob: payload.expectedPob,
        notes: payload.notes,
        status: "draft",
        generation_method: "ai",
        ai_generation_id: generationId,
        prepared_by: userId,
        created_by: userId,
        updated_by: userId,
      })
      .select("id")
      .single();
    if (error) return { error: error.message };
    const matrixId = matrix!.id as string;

    for (let i = 0; i < resolvedLines.length; i++) {
      const l = resolvedLines[i];
      const { data: line, error: lineError } = await supabase
        .from("crew_matrix_lines")
        .insert({
          org_id: orgId,
          crew_matrix_id: matrixId,
          line_number: i + 1,
          sort_order: i,
          job_role_id: l.jobRoleId,
          required_headcount: Math.max(1, l.required_headcount),
          day_shift_quantity: l.day_shift_quantity,
          night_shift_quantity: l.night_shift_quantity,
          other_shift_quantity: l.other_shift_quantity,
          rotation_template_id: l.rotation_template_id,
          employment_type_preference: l.employment_type_preference,
          nationality_preference: l.nationality_preference,
          language_requirement: l.language_requirement,
          minimum_experience_years: l.minimum_experience_years,
          mobilization_lead_days: l.mobilization_lead_days,
          client_approval_required: l.client_approval_required,
          remarks: l.remarks,
          created_by: userId,
          updated_by: userId,
        })
        .select("id")
        .single();
      if (lineError) return { error: lineError.message, id: matrixId };
      const lineId = line!.id as string;
      if (l.skillIds.length) await supabase.from("crew_matrix_line_skills").insert(l.skillIds.map((skill_id) => ({ org_id: orgId, line_id: lineId, skill_id })));
      if (l.docs.length) await supabase.from("crew_matrix_line_documents").insert(l.docs.map((d) => ({ org_id: orgId, line_id: lineId, ...d })));
      if (l.competencies.length) await supabase.from("crew_matrix_line_competencies").insert(l.competencies.map((c) => ({ org_id: orgId, line_id: lineId, competency_name: c.name, minimum_grade: c.minimum_grade })));
      if (l.client_requirements.length) await supabase.from("crew_matrix_line_client_requirements").insert(l.client_requirements.map((c) => ({ org_id: orgId, line_id: lineId, requirement_text: c.text, is_mandatory: c.is_mandatory })));
    }

    // The unique index is on lower(alias), so insert one at a time and
    // ignore duplicates rather than relying on ON CONFLICT column matching.
    for (const row of aliasRows) await supabase.from("ai_name_aliases").insert(row);
    await supabase.from("ai_generations").update({ status: "saved", crew_matrix_id: matrixId }).eq("id", generationId);
    await supabase.from("ai_usage_log").update({ crew_matrix_id: matrixId }).eq("org_id", orgId).is("crew_matrix_id", null).eq("user_id", userId).gte("created_at", new Date(Date.now() - 30 * 60 * 1000).toISOString());

    revalidatePath("/crew/matrices");
    return { id: matrixId };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function discardGeneration(generationId: string) {
  const { supabase } = await requireMatrixManage();
  await supabase.from("ai_generations").update({ status: "discarded" }).eq("id", generationId).eq("status", "draft");
  return {};
}

/* ================= Review an existing draft ================= */

export async function reviewMatrix(crewMatrixId: string): Promise<{ review: MatrixReview; modelLabel: string } | { error: string }> {
  const { supabase, userId, orgId } = await requireMatrixManage();
  const { data: matrix } = await supabase
    .from("crew_matrices")
    .select("id, title, project_id, offshore_site_id, expected_pob, crew_matrix_lines(required_headcount, day_shift_quantity, night_shift_quantity, other_shift_quantity, minimum_experience_years, nationality_preference, language_requirement, client_approval_required, job_roles(name), rotation_templates(name), crew_matrix_line_documents(is_mandatory, waiver_permitted, document_types(name)), crew_matrix_line_skills(skills(name)))")
    .eq("id", crewMatrixId)
    .single();
  if (!matrix) return { error: "Could not find that crew matrix." };
  const ctx = await loadAiContext(supabase, orgId);
  const context = await loadProjectContext(supabase, matrix.project_id, matrix.offshore_site_id);
  if ("error" in context) return context;
  context.expectedPob = matrix.expected_pob ?? context.expectedPob;
  const normsText = await loadNormsText(supabase, orgId);
  const matrixText = ((matrix.crew_matrix_lines ?? []) as unknown as ReviewLineRow[])
    .map((l) => {
      const docs = (l.crew_matrix_line_documents ?? []).map((d) => `${unwrap<{ name?: string }>(d.document_types)?.name ?? "?"}${d.is_mandatory ? " (mandatory)" : ""}`).join(", ");
      const skills = (l.crew_matrix_line_skills ?? []).map((s) => unwrap<{ name?: string }>(s.skills)?.name ?? "?").join(", ");
      return `- ${unwrap<{ name?: string }>(l.job_roles)?.name ?? "?"} ×${l.required_headcount} (day ${l.day_shift_quantity ?? "?"}/night ${l.night_shift_quantity ?? "?"}/other ${l.other_shift_quantity ?? "?"}), rotation ${unwrap<{ name?: string }>(l.rotation_templates)?.name ?? "none"}, min exp ${l.minimum_experience_years ?? "?"}y, docs: ${docs || "none"}, skills: ${skills || "none"}`;
    })
    .join("\n");
  const result = await runStructured(supabase, ctx, {
    task: "matrix_review",
    schema: reviewSchema,
    system: SYSTEM_BASE,
    messages: [{ role: "user", content: reviewModePrompt({ context, normsText, matrixText: matrixText || "(no lines)" }) }],
    needsDocuments: false,
    userId,
    crewMatrixId,
  });
  if ("error" in result) return { error: result.error };
  return { review: result.object, modelLabel: `${result.model.display_name} (${result.model.cost_tier})` };
}

