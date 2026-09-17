"use server";

import { revalidatePath } from "next/cache";
import type { ModelMessage } from "ai";
import sharp from "sharp";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveAccess, can } from "@/lib/rbac";
import { loadAiContext, runStructured, resolveChain } from "@/lib/ai/router";
import { crewIntakeSchema, SYSTEM_INTAKE, intakePrompt, INTAKE_PROMPT_VERSION } from "@/lib/ai/crew-intake-schema";
import { extractDocument } from "@/lib/ai/extract";
import { mapName, type Alias, type Mapping } from "@/lib/ai/mapping";

// Phase 12 — Onboarding intake from a CV or ID scan. Mirrors the shape of
// app/crew/matrices/ai-actions.ts (generate → review/map → save), scoped
// to a single crew member instead of a matrix. See
// supabase/migrations/0010_ai_crew_intake.sql for why this is gated
// behind crew.matrix.manage in addition to crew.manage /
// crew.documents.manage.

// Local name-similarity helper for the duplicate-crew check. Mirrors
// lib/ai/mapping.ts's token-overlap algorithm, which isn't exported
// there (only mapName/mapRotation are) — kept small and local rather
// than widening that module's exports for one caller.
function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9/ ]+/g, " ").replace(/\s+/g, " ").trim();
}
function tokens(s: string) {
  return new Set(norm(s).split(" ").filter((t) => t.length > 1 && !["the", "and", "of", "for", "a", "an"].includes(t)));
}
function nameSimilarity(a: string, b: string) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.max(ta.size, tb.size);
}

async function requireIntakeAccess() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "crew.manage")) throw new Error("You don't have permission to manage crew profiles.");
  if (!can(access, "crew.matrix.manage")) {
    throw new Error("CV/ID scan intake uses the same AI infrastructure as crew matrices — you need the crew matrix management permission as well as crew management to use it.");
  }
  if (!access.orgId) throw new Error("No company context.");
  return { supabase, access, userId: user.id, orgId: access.orgId };
}

/* ================= Availability ================= */

export async function intakeAvailability(): Promise<{ enabled: boolean; reason: string | null; maxUploadMb: number; documentCapable: boolean }> {
  const { supabase, orgId } = await requireIntakeAccess();
  const ctx = await loadAiContext(supabase, orgId);
  if (!ctx.settings.ai_enabled) return { enabled: false, reason: "AI features are disabled for this company.", maxUploadMb: ctx.settings.max_upload_mb, documentCapable: false };
  const text = resolveChain(ctx, "crew_intake", false);
  const docs = resolveChain(ctx, "crew_intake", true);
  if (text.chain.length === 0) {
    const why = text.skipped.length ? text.skipped.map((s) => `${s.model.display_name}: ${s.skipReason}`).join("; ") : "no models configured";
    return { enabled: false, reason: `No usable AI model (${why}). Configure one under Administration → AI Settings.`, maxUploadMb: ctx.settings.max_upload_mb, documentCapable: false };
  }
  return { enabled: true, reason: null, maxUploadMb: ctx.settings.max_upload_mb, documentCapable: docs.chain.length > 0 };
}

/* ================= Extract ================= */

export type MappedIntakeDocument = { name: string; mapping: Mapping; document_number: string | null; issue_date: string | null; expiry_date: string | null; confidence: number; source_excerpt: string | null };
export type DuplicateCandidate = { id: string; full_name: string; employee_code: string | null; score: number };
export type MappedIntakeProposal = {
  generationId: string;
  full_name: string | null;
  date_of_birth: string | null;
  nationality: string | null;
  gender: string | null;
  phone: string | null;
  email: string | null;
  home_country: string | null;
  job_role: Mapping | null;
  documents: MappedIntakeDocument[];
  photoUrl: string | null;
  name_mismatch_warning: string | null;
  assumptions: string[];
  duplicates: DuplicateCandidate[];
  modelLabel: string;
  attempts: { model: string; outcome: string }[];
  masterData: { jobRoles: { id: string; name: string }[]; documentTypes: { id: string; name: string }[] };
};

export async function extractCrewIntake(formData: FormData): Promise<{ proposal: MappedIntakeProposal } | { error: string; attempts?: { model: string; outcome: string }[] }> {
  const { supabase, userId, orgId } = await requireIntakeAccess();
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const pasted = String(formData.get("pastedText") ?? "").trim();
  if (files.length === 0 && !pasted) return { error: "Upload at least one document (CV, passport, ID, or certificate) or paste the text." };

  const ctx = await loadAiContext(supabase, orgId);
  const maxBytes = ctx.settings.max_upload_mb * 1024 * 1024;
  for (const f of files) if (f.size > maxBytes) return { error: `"${f.name}" is larger than the ${ctx.settings.max_upload_mb} MB limit.` };

  const [jr, dt, al] = await Promise.all([
    supabase.from("job_roles").select("id, name").eq("org_id", orgId).eq("is_active", true).order("name"),
    supabase.from("document_types").select("id, name").eq("org_id", orgId).eq("is_active", true).order("name"),
    supabase.from("ai_name_aliases").select("entity_type, alias, target_id").eq("org_id", orgId),
  ]);
  const jobRoles = jr.data ?? [];
  const documentTypes = dt.data ?? [];
  const aliases = (al.data ?? []) as Alias[];

  const extracted: Awaited<ReturnType<typeof extractDocument>>[] = [];
  for (const f of files) extracted.push(await extractDocument(f));
  const unreadable = extracted.filter((e) => e.unreadable);
  if (unreadable.length) return { error: `"${unreadable.map((e) => e.filename).join('", "')}" doesn't look like a valid file of its type — check it opens correctly on your computer and re-upload it.` };
  const needsDocuments = extracted.some((e) => e.needsModelVision);
  const textParts = [pasted, ...extracted.filter((e) => e.text).map((e) => `## ${e.filename}\n${e.text}`)].filter(Boolean);
  const documentText = textParts.length ? textParts.join("\n\n") : null;

  // Filenames of everything the model actually sees as a visual page —
  // images, plus any PDF forwarded to vision because it has little/no
  // text layer (see extractDocument). A PDF the model can't see (real
  // text extracted instead) is left out — the model can't locate a
  // photo on a page it was never shown.
  const attachedVisualFilenames = extracted.filter((e) => e.needsModelVision).map((e) => e.filename);
  const prompt = intakePrompt({ masterData: { documentTypeNames: documentTypes.map((d) => d.name), jobRoleNames: jobRoles.map((j) => j.name) }, documentText, hasAttachedFiles: needsDocuments, attachedVisualFilenames });
  const fileParts = extracted
    .filter((e) => e.needsModelVision)
    .map((e) => ({ type: "file" as const, data: e.bytes, mediaType: e.mediaType, filename: e.filename }));
  const content: Exclude<ModelMessage, { role: "system" | "assistant" | "tool" }>["content"] = fileParts.length ? [{ type: "text", text: prompt }, ...fileParts] : prompt;
  const messages: ModelMessage[] = [{ role: "user", content }];

  const result = await runStructured(supabase, ctx, { task: "crew_intake", schema: crewIntakeSchema, system: SYSTEM_INTAKE, messages, needsDocuments, userId });
  if ("error" in result) return { error: result.error, attempts: result.attempts };

  const sourceFilenames = extracted.map((e) => e.filename);
  const { data: gen, error: genError } = await supabase
    .from("crew_intake_generations")
    .insert({
      org_id: orgId,
      status: "draft",
      provider: result.model.provider,
      model_id: result.model.model_id,
      prompt_version: INTAKE_PROMPT_VERSION,
      input_summary: `intake: ${sourceFilenames.join(", ") || "pasted text"}`,
      source_filenames: sourceFilenames,
      created_by: userId,
    })
    .select("id")
    .single();
  if (genError) return { error: genError.message };
  const generationId = gen!.id as string;

  if (ctx.settings.keep_source_documents && extracted.length) {
    const paths: string[] = [];
    for (const e of extracted) {
      const path = `${orgId}/${generationId}/${e.filename.replace(/[^\w.\-]+/g, "_")}`;
      const { error: upErr } = await supabase.storage.from("ai-source-documents").upload(path, e.bytes, { contentType: e.mediaType, upsert: true });
      if (!upErr) paths.push(path);
    }
    if (paths.length) await supabase.from("crew_intake_generations").update({ source_document_paths: paths }).eq("id", generationId);
  }

  // Auto-crop the headshot the model located in one of the attached
  // files. For an image file we crop directly with sharp. For a PDF
  // page — the common case, since most passport/ID scans are uploaded
  // as PDFs — sharp itself has no PDF input support in this build (no
  // bundled PDFium), so we first rasterize just that page to a PNG
  // using unpdf's pdf.js-based renderer (backed by @napi-rs/canvas, a
  // prebuilt-binary canvas implementation safe for serverless), then
  // crop that PNG with sharp exactly like an image. Failure anywhere in
  // this block is non-fatal — a bad render/crop shouldn't sink the
  // whole intake, it just means no photo gets proposed.
  let photoUrl: string | null = null;
  // Surfaced back to the reviewer via `assumptions` (rather than swallowed)
  // whenever the AI DID propose a photo but the crop/upload didn't end up
  // producing a usable photoUrl — a silent failure here just looks like
  // "AI missed the photo" to whoever's using the intake screen, when it's
  // actually a rendering/upload problem worth knowing about.
  let photoNote: string | null = null;
  const photoProposal = result.object.photo;
  if (photoProposal) {
    const source = extracted.find((e) => e.filename === photoProposal.source_filename && e.needsModelVision);
    if (!source) {
      const sentFilenames = extracted.filter((e) => e.needsModelVision).map((e) => e.filename).join(", ") || "none";
      photoNote = `Photo auto-detect: the AI named "${photoProposal.source_filename}" for the photo, but that filename wasn't among the files sent to it as an image (sent: ${sentFilenames}).`;
    } else {
      try {
        let raster: Buffer;
        if (source.mediaType === "application/pdf") {
          const { renderPageAsImage } = await import("unpdf");
          const pageNum = Math.max(1, photoProposal.source_page ?? 1);
          // width: 1600 normalizes render resolution regardless of the
          // scanned page's actual size, so memory/time stay predictable
          // for an oversized or unusually-shaped scan.
          const png = await renderPageAsImage(source.bytes.slice(), pageNum, { canvasImport: () => import("@napi-rs/canvas"), width: 1600 });
          raster = Buffer.from(png);
        } else {
          raster = Buffer.from(source.bytes);
        }
        const meta = await sharp(raster).metadata();
        const w = meta.width ?? 0;
        const h = meta.height ?? 0;
        if (w > 0 && h > 0) {
          const left = Math.min(w - 1, Math.max(0, Math.round(photoProposal.x * w)));
          const top = Math.min(h - 1, Math.max(0, Math.round(photoProposal.y * h)));
          const cropW = Math.max(1, Math.min(w - left, Math.round(photoProposal.width * w)));
          const cropH = Math.max(1, Math.min(h - top, Math.round(photoProposal.height * h)));
          const cropped = await sharp(raster)
            .extract({ left, top, width: cropW, height: cropH })
            .resize(480, 480, { fit: "inside", withoutEnlargement: true })
            .jpeg({ quality: 85 })
            .toBuffer();
          const photoPath = `${orgId}/${generationId}/photo.jpg`;
          const { error: photoUpErr } = await supabase.storage.from("crew-photos").upload(photoPath, cropped, { contentType: "image/jpeg", upsert: true });
          if (!photoUpErr) {
            const { data: pub } = supabase.storage.from("crew-photos").getPublicUrl(photoPath);
            photoUrl = pub.publicUrl;
          } else {
            const errDetail = "statusCode" in photoUpErr ? ` [status ${(photoUpErr as { status?: number }).status ?? "?"} / ${(photoUpErr as { statusCode?: string }).statusCode ?? "?"}]` : "";
            photoNote = `Photo auto-detect: cropped the photo but the upload to storage failed: ${photoUpErr.message}${errDetail} (path "${photoPath}")`;
          }
        } else {
          photoNote = `Photo auto-detect: rendered "${source.filename}"${photoProposal.source_page ? ` page ${photoProposal.source_page}` : ""} but got no usable image dimensions (${w}x${h}).`;
        }
      } catch (e) {
        photoNote = `Photo auto-detect: failed while rendering/cropping "${source.filename}"${photoProposal.source_page ? ` page ${photoProposal.source_page}` : ""} — ${e instanceof Error ? e.message : String(e)}`;
      }
    }
  }

  // Duplicate check — plain name-similarity against existing profiles in
  // this company, no extra AI call (per the user's confirmed scope).
  let duplicates: DuplicateCandidate[] = [];
  const extractedName = result.object.full_name;
  if (extractedName) {
    const { data: existing } = await supabase.from("crew_profiles").select("id, full_name, employee_code").eq("org_id", orgId);
    duplicates = (existing ?? [])
      .map((c) => ({ id: c.id as string, full_name: c.full_name as string, employee_code: (c.employee_code as string | null) ?? null, score: nameSimilarity(extractedName, c.full_name as string) }))
      .filter((c) => c.score >= 0.6)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }

  const jobRoleMapping = result.object.job_role_name ? mapName(result.object.job_role_name, "job_role", jobRoles, aliases) : null;
  const documents: MappedIntakeDocument[] = result.object.documents.map((d) => ({
    name: d.document_type_name,
    mapping: mapName(d.document_type_name, "document_type", documentTypes, aliases),
    document_number: d.document_number,
    issue_date: d.issue_date,
    expiry_date: d.expiry_date,
    confidence: d.confidence,
    source_excerpt: d.source_excerpt,
  }));

  return {
    proposal: {
      generationId,
      full_name: result.object.full_name,
      date_of_birth: result.object.date_of_birth,
      nationality: result.object.nationality,
      gender: result.object.gender,
      phone: result.object.phone,
      email: result.object.email,
      home_country: result.object.home_country,
      job_role: jobRoleMapping,
      documents,
      photoUrl,
      name_mismatch_warning: result.object.name_mismatch_warning,
      assumptions: photoNote ? [...result.object.assumptions, photoNote] : result.object.assumptions,
      duplicates,
      modelLabel: `${result.model.display_name} (${result.model.cost_tier})`,
      attempts: result.attempts,
      masterData: { jobRoles, documentTypes },
    },
  };
}

/* ================= Save the reviewed intake as a crew profile ================= */

type SaveIntakePayload = {
  fullName: string;
  employeeCode: string | null;
  employmentStatus: string;
  jobRoleId: string | null;
  newJobRoleName: string | null;
  jobRoleAlias: string | null;
  nationality: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  phone: string | null;
  email: string | null;
  homeCountry: string | null;
  photoUrl: string | null;
  documents: { documentTypeId: string | null; newName: string | null; alias: string | null; documentNumber: string | null; issueDate: string | null; expiryDate: string | null }[];
};

export async function saveCrewIntake(generationId: string, payloadJson: string) {
  const { supabase, access, userId, orgId } = await requireIntakeAccess();
  let payload: SaveIntakePayload;
  try {
    payload = JSON.parse(payloadJson);
  } catch {
    return { error: "Invalid payload." };
  }
  if (!payload.fullName?.trim()) return { error: "Full name is required." };
  if (payload.documents.length > 0 && !can(access, "crew.documents.manage")) {
    return { error: "You don't have permission to save documents — remove them from this intake or ask an admin for the crew documents permission." };
  }

  const { data: gen } = await supabase.from("crew_intake_generations").select("id, status").eq("id", generationId).single();
  if (!gen) return { error: "Could not find the AI intake generation to save." };
  if (gen.status === "saved") return { error: "This intake has already been saved." };

  const createdRoles = new Map<string, string>();
  const createdDocs = new Map<string, string>();
  const ensure = async (table: "job_roles" | "document_types", name: string, cache: Map<string, string>, extra: Record<string, unknown> = {}) => {
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
    const jobRoleId = payload.jobRoleId ?? (payload.newJobRoleName ? await ensure("job_roles", payload.newJobRoleName, createdRoles, { created_by: userId }) : null);
    if (payload.jobRoleAlias && payload.jobRoleId) aliasRows.push({ org_id: orgId, entity_type: "job_role", alias: payload.jobRoleAlias, target_id: payload.jobRoleId, created_by: userId });

    const { data: profile, error: profileError } = await supabase
      .from("crew_profiles")
      .insert({
        org_id: orgId,
        full_name: payload.fullName.trim(),
        employee_code: payload.employeeCode,
        photo_url: payload.photoUrl,
        primary_job_role_id: jobRoleId,
        nationality: payload.nationality,
        date_of_birth: payload.dateOfBirth,
        gender: payload.gender,
        phone: payload.phone,
        email: payload.email,
        home_country: payload.homeCountry,
        employment_status: payload.employmentStatus || "candidate",
        created_by: userId,
        updated_by: userId,
      })
      .select("id")
      .single();
    if (profileError) return { error: profileError.message };
    const crewId = profile!.id as string;

    for (const d of payload.documents) {
      const docTypeId = d.documentTypeId ?? (d.newName ? await ensure("document_types", d.newName, createdDocs, { category: "certificate", tracks_number: true, created_by: userId }) : null);
      if (!docTypeId) continue;
      if (d.alias && d.documentTypeId) aliasRows.push({ org_id: orgId, entity_type: "document_type", alias: d.alias, target_id: d.documentTypeId, created_by: userId });
      await supabase.from("crew_documents").insert({
        org_id: orgId,
        crew_id: crewId,
        document_type_id: docTypeId,
        document_number: d.documentNumber,
        issue_date: d.issueDate,
        expiry_date: d.expiryDate,
        created_by: userId,
        updated_by: userId,
      });
    }

    // The unique index is on lower(alias), so insert one at a time and
    // ignore duplicates rather than relying on ON CONFLICT column matching
    // (same reasoning as app/crew/matrices/ai-actions.ts).
    for (const row of aliasRows) await supabase.from("ai_name_aliases").insert(row);
    await supabase.from("crew_intake_generations").update({ status: "saved", crew_profile_id: crewId }).eq("id", generationId);

    revalidatePath("/crew/profiles");
    return { id: crewId };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function discardCrewIntake(generationId: string) {
  const { supabase } = await requireIntakeAccess();
  await supabase.from("crew_intake_generations").update({ status: "discarded" }).eq("id", generationId).eq("status", "draft");
  return {};
}
