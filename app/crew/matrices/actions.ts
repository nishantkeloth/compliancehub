"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveAccess, can } from "@/lib/rbac";

type Supa = Awaited<ReturnType<typeof createClient>>;

async function requirePermission(permission: string, message: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, permission)) throw new Error(message);
  if (!access.orgId) throw new Error("No company context.");
  return { supabase, access, userId: user.id };
}

const requireManage = () => requirePermission("crew.matrix.manage", "You don't have permission to manage crew matrices.");
const requireSubmit = () => requirePermission("crew.matrix.submit", "You don't have permission to submit crew matrices for approval.");
const requireApproveInternal = () => requirePermission("crew.matrix.approve_internal", "You don't have permission to give internal approval on crew matrices.");
const requireApproveClient = () => requirePermission("crew.matrix.approve_client", "You don't have permission to record client approval on crew matrices.");

function str(formData: FormData, key: string) {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}
function optStr(formData: FormData, key: string) {
  const v = str(formData, key);
  return v || null;
}
function optNum(formData: FormData, key: string) {
  const v = str(formData, key);
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const revalidateMatrix = (id?: string) => {
  revalidatePath("/crew/matrices");
  if (id) revalidatePath(`/crew/matrices/${id}`);
};

// Line/header content can only change while the matrix is still a
// draft — everything from "submit" onward moves status only, via
// the dedicated workflow actions below.
async function assertDraft(supabase: Supa, crewMatrixId: string) {
  const { data, error } = await supabase.from("crew_matrices").select("status").eq("id", crewMatrixId).single();
  if (error || !data) throw new Error("Could not find that crew matrix.");
  if (data.status !== "draft") {
    throw new Error(`This matrix is ${data.status.replace(/_/g, " ")} and can no longer be edited — create a new version instead.`);
  }
}

/* ================= Header ================= */

export async function createCrewMatrix(formData: FormData) {
  const { supabase, access, userId } = await requireManage();
  const projectId = str(formData, "projectId");
  if (!projectId) return { error: "Project is required." };
  const offshoreSiteId = str(formData, "offshoreSiteId");
  if (!offshoreSiteId) return { error: "Offshore site is required." };
  const title = str(formData, "title");
  if (!title) return { error: "Title is required." };

  const { data: code, error: codeError } = await supabase.rpc("next_number_range_code", {
    p_org_id: access.orgId,
    p_entity_type: "crew_matrix",
  });
  if (codeError) return { error: `Could not assign a matrix number: ${codeError.message}` };

  const { data: matrix, error } = await supabase
    .from("crew_matrices")
    .insert({
      org_id: access.orgId,
      project_id: projectId,
      offshore_site_id: offshoreSiteId,
      matrix_number: code,
      version_number: 1,
      title,
      effective_from: optStr(formData, "effectiveFrom"),
      effective_to: optStr(formData, "effectiveTo"),
      expected_pob: optNum(formData, "expectedPob"),
      notes: optStr(formData, "notes"),
      prepared_by: userId,
      created_by: userId,
      updated_by: userId,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  revalidateMatrix();
  return { id: matrix?.id };
}

export async function updateCrewMatrixHeader(id: string, formData: FormData) {
  const { supabase, userId } = await requireManage();
  await assertDraft(supabase, id);
  const title = str(formData, "title");
  if (!title) return { error: "Title is required." };

  const { error } = await supabase
    .from("crew_matrices")
    .update({
      title,
      effective_from: optStr(formData, "effectiveFrom"),
      effective_to: optStr(formData, "effectiveTo"),
      expected_pob: optNum(formData, "expectedPob"),
      notes: optStr(formData, "notes"),
      updated_by: userId,
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidateMatrix(id);
  return {};
}

export async function deleteCrewMatrix(id: string) {
  const { supabase } = await requireManage();
  await assertDraft(supabase, id);
  const { error } = await supabase.from("crew_matrices").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidateMatrix();
  return {};
}

/* ================= Lines ================= */

export async function createCrewMatrixLine(crewMatrixId: string, formData: FormData) {
  const { supabase, access, userId } = await requireManage();
  await assertDraft(supabase, crewMatrixId);
  const jobRoleId = str(formData, "jobRoleId");
  if (!jobRoleId) return { error: "Job role is required." };

  const { count } = await supabase
    .from("crew_matrix_lines")
    .select("id", { count: "exact", head: true })
    .eq("crew_matrix_id", crewMatrixId);

  const { data: line, error } = await supabase
    .from("crew_matrix_lines")
    .insert({
      org_id: access.orgId,
      crew_matrix_id: crewMatrixId,
      line_number: (count ?? 0) + 1,
      job_role_id: jobRoleId,
      required_headcount: optNum(formData, "requiredHeadcount") ?? 1,
      day_shift_quantity: optNum(formData, "dayShiftQuantity"),
      night_shift_quantity: optNum(formData, "nightShiftQuantity"),
      other_shift_quantity: optNum(formData, "otherShiftQuantity"),
      rotation_template_id: optStr(formData, "rotationTemplateId"),
      employment_type_preference: optStr(formData, "employmentTypePreference"),
      nationality_preference: optStr(formData, "nationalityPreference"),
      language_requirement: optStr(formData, "languageRequirement"),
      minimum_experience_years: optNum(formData, "minimumExperienceYears"),
      mobilization_lead_days: optNum(formData, "mobilizationLeadDays"),
      client_approval_required: formData.get("clientApprovalRequired") === "on",
      remarks: optStr(formData, "remarks"),
      sort_order: count ?? 0,
      created_by: userId,
      updated_by: userId,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  revalidateMatrix(crewMatrixId);
  return { id: line?.id };
}

export async function updateCrewMatrixLine(lineId: string, crewMatrixId: string, formData: FormData) {
  const { supabase, userId } = await requireManage();
  await assertDraft(supabase, crewMatrixId);
  const jobRoleId = str(formData, "jobRoleId");
  if (!jobRoleId) return { error: "Job role is required." };

  const { error } = await supabase
    .from("crew_matrix_lines")
    .update({
      job_role_id: jobRoleId,
      required_headcount: optNum(formData, "requiredHeadcount") ?? 1,
      day_shift_quantity: optNum(formData, "dayShiftQuantity"),
      night_shift_quantity: optNum(formData, "nightShiftQuantity"),
      other_shift_quantity: optNum(formData, "otherShiftQuantity"),
      rotation_template_id: optStr(formData, "rotationTemplateId"),
      employment_type_preference: optStr(formData, "employmentTypePreference"),
      nationality_preference: optStr(formData, "nationalityPreference"),
      language_requirement: optStr(formData, "languageRequirement"),
      minimum_experience_years: optNum(formData, "minimumExperienceYears"),
      mobilization_lead_days: optNum(formData, "mobilizationLeadDays"),
      client_approval_required: formData.get("clientApprovalRequired") === "on",
      remarks: optStr(formData, "remarks"),
      updated_by: userId,
    })
    .eq("id", lineId);
  if (error) return { error: error.message };
  revalidateMatrix(crewMatrixId);
  return {};
}

export async function deleteCrewMatrixLine(lineId: string, crewMatrixId: string) {
  const { supabase } = await requireManage();
  await assertDraft(supabase, crewMatrixId);
  const { error } = await supabase.from("crew_matrix_lines").delete().eq("id", lineId);
  if (error) return { error: error.message };
  revalidateMatrix(crewMatrixId);
  return {};
}

export async function reorderCrewMatrixLines(crewMatrixId: string, orderedLineIds: string[]) {
  const { supabase } = await requireManage();
  await assertDraft(supabase, crewMatrixId);
  // No bulk-update in supabase-js — one row at a time, but these are
  // small matrices (tens of lines, not thousands), so this is fine.
  for (let i = 0; i < orderedLineIds.length; i++) {
    const { error } = await supabase
      .from("crew_matrix_lines")
      .update({ sort_order: i, line_number: i + 1 })
      .eq("id", orderedLineIds[i])
      .eq("crew_matrix_id", crewMatrixId);
    if (error) return { error: error.message };
  }
  revalidateMatrix(crewMatrixId);
  return {};
}

export async function copyCrewMatrixLine(lineId: string, crewMatrixId: string) {
  const { supabase, access, userId } = await requireManage();
  await assertDraft(supabase, crewMatrixId);

  const { data: source, error: sourceError } = await supabase.from("crew_matrix_lines").select("*").eq("id", lineId).single();
  if (sourceError || !source) return { error: "Could not find that line." };

  const { count } = await supabase
    .from("crew_matrix_lines")
    .select("id", { count: "exact", head: true })
    .eq("crew_matrix_id", crewMatrixId);

  const { data: copy, error } = await supabase
    .from("crew_matrix_lines")
    .insert({
      org_id: access.orgId,
      crew_matrix_id: crewMatrixId,
      line_number: (count ?? 0) + 1,
      job_role_id: source.job_role_id,
      required_headcount: source.required_headcount,
      day_shift_quantity: source.day_shift_quantity,
      night_shift_quantity: source.night_shift_quantity,
      other_shift_quantity: source.other_shift_quantity,
      rotation_template_id: source.rotation_template_id,
      employment_type_preference: source.employment_type_preference,
      nationality_preference: source.nationality_preference,
      language_requirement: source.language_requirement,
      minimum_experience_years: source.minimum_experience_years,
      mobilization_lead_days: source.mobilization_lead_days,
      client_approval_required: source.client_approval_required,
      remarks: source.remarks,
      sort_order: count ?? 0,
      created_by: userId,
      updated_by: userId,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  const [skills, documents, competencies, clientReqs] = await Promise.all([
    supabase.from("crew_matrix_line_skills").select("skill_id").eq("line_id", lineId),
    supabase.from("crew_matrix_line_documents").select("document_type_id, minimum_remaining_validity_days, is_mandatory, waiver_permitted").eq("line_id", lineId),
    supabase.from("crew_matrix_line_competencies").select("competency_name, minimum_grade, notes").eq("line_id", lineId),
    supabase.from("crew_matrix_line_client_requirements").select("requirement_text, is_mandatory").eq("line_id", lineId),
  ]);

  const newLineId = copy!.id as string;
  await Promise.all([
    (skills.data ?? []).length
      ? supabase.from("crew_matrix_line_skills").insert((skills.data ?? []).map((s) => ({ org_id: access.orgId, line_id: newLineId, skill_id: s.skill_id })))
      : Promise.resolve(),
    (documents.data ?? []).length
      ? supabase.from("crew_matrix_line_documents").insert(
          (documents.data ?? []).map((d) => ({
            org_id: access.orgId,
            line_id: newLineId,
            document_type_id: d.document_type_id,
            minimum_remaining_validity_days: d.minimum_remaining_validity_days,
            is_mandatory: d.is_mandatory,
            waiver_permitted: d.waiver_permitted,
          }))
        )
      : Promise.resolve(),
    (competencies.data ?? []).length
      ? supabase.from("crew_matrix_line_competencies").insert(
          (competencies.data ?? []).map((c) => ({ org_id: access.orgId, line_id: newLineId, competency_name: c.competency_name, minimum_grade: c.minimum_grade, notes: c.notes }))
        )
      : Promise.resolve(),
    (clientReqs.data ?? []).length
      ? supabase.from("crew_matrix_line_client_requirements").insert(
          (clientReqs.data ?? []).map((r) => ({ org_id: access.orgId, line_id: newLineId, requirement_text: r.requirement_text, is_mandatory: r.is_mandatory }))
        )
      : Promise.resolve(),
  ]);

  revalidateMatrix(crewMatrixId);
  return { id: newLineId };
}

/* ================= Line requirements ================= */

export async function addLineSkill(lineId: string, crewMatrixId: string, skillId: string) {
  const { supabase, access } = await requireManage();
  await assertDraft(supabase, crewMatrixId);
  const { error } = await supabase.from("crew_matrix_line_skills").insert({ org_id: access.orgId, line_id: lineId, skill_id: skillId });
  if (error && !error.message.includes("duplicate")) return { error: error.message };
  revalidateMatrix(crewMatrixId);
  return {};
}

export async function removeLineSkill(id: string, crewMatrixId: string) {
  const { supabase } = await requireManage();
  await assertDraft(supabase, crewMatrixId);
  const { error } = await supabase.from("crew_matrix_line_skills").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidateMatrix(crewMatrixId);
  return {};
}

export async function addLineDocument(lineId: string, crewMatrixId: string, formData: FormData) {
  const { supabase, access } = await requireManage();
  await assertDraft(supabase, crewMatrixId);
  const documentTypeId = str(formData, "documentTypeId");
  if (!documentTypeId) return { error: "Document type is required." };
  const { error } = await supabase.from("crew_matrix_line_documents").insert({
    org_id: access.orgId,
    line_id: lineId,
    document_type_id: documentTypeId,
    minimum_remaining_validity_days: optNum(formData, "minimumRemainingValidityDays"),
    is_mandatory: formData.get("isMandatory") !== "off",
    waiver_permitted: formData.get("waiverPermitted") === "on",
  });
  if (error && !error.message.includes("duplicate")) return { error: error.message };
  revalidateMatrix(crewMatrixId);
  return {};
}

export async function updateLineDocument(id: string, crewMatrixId: string, formData: FormData) {
  const { supabase } = await requireManage();
  await assertDraft(supabase, crewMatrixId);
  const { error } = await supabase
    .from("crew_matrix_line_documents")
    .update({
      minimum_remaining_validity_days: optNum(formData, "minimumRemainingValidityDays"),
      is_mandatory: formData.get("isMandatory") !== "off",
      waiver_permitted: formData.get("waiverPermitted") === "on",
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidateMatrix(crewMatrixId);
  return {};
}

export async function removeLineDocument(id: string, crewMatrixId: string) {
  const { supabase } = await requireManage();
  await assertDraft(supabase, crewMatrixId);
  const { error } = await supabase.from("crew_matrix_line_documents").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidateMatrix(crewMatrixId);
  return {};
}

export async function addLineCompetency(lineId: string, crewMatrixId: string, formData: FormData) {
  const { supabase, access } = await requireManage();
  await assertDraft(supabase, crewMatrixId);
  const name = str(formData, "competencyName");
  if (!name) return { error: "Competency name is required." };
  const { error } = await supabase.from("crew_matrix_line_competencies").insert({
    org_id: access.orgId,
    line_id: lineId,
    competency_name: name,
    minimum_grade: optStr(formData, "minimumGrade"),
    notes: optStr(formData, "notes"),
  });
  if (error) return { error: error.message };
  revalidateMatrix(crewMatrixId);
  return {};
}

export async function removeLineCompetency(id: string, crewMatrixId: string) {
  const { supabase } = await requireManage();
  await assertDraft(supabase, crewMatrixId);
  const { error } = await supabase.from("crew_matrix_line_competencies").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidateMatrix(crewMatrixId);
  return {};
}

export async function addLineClientRequirement(lineId: string, crewMatrixId: string, formData: FormData) {
  const { supabase, access } = await requireManage();
  await assertDraft(supabase, crewMatrixId);
  const text = str(formData, "requirementText");
  if (!text) return { error: "Requirement text is required." };
  const { error } = await supabase.from("crew_matrix_line_client_requirements").insert({
    org_id: access.orgId,
    line_id: lineId,
    requirement_text: text,
    is_mandatory: formData.get("isMandatory") !== "off",
  });
  if (error) return { error: error.message };
  revalidateMatrix(crewMatrixId);
  return {};
}

export async function removeLineClientRequirement(id: string, crewMatrixId: string) {
  const { supabase } = await requireManage();
  await assertDraft(supabase, crewMatrixId);
  const { error } = await supabase.from("crew_matrix_line_client_requirements").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidateMatrix(crewMatrixId);
  return {};
}

/* ================= Workflow ================= */

export async function submitForApproval(id: string) {
  const { supabase, userId } = await requireSubmit();
  const { data: matrix, error: fetchError } = await supabase.from("crew_matrices").select("status").eq("id", id).single();
  if (fetchError || !matrix) return { error: "Could not find that crew matrix." };
  if (matrix.status !== "draft") return { error: `This matrix is ${matrix.status.replace(/_/g, " ")}, not draft — it can't be submitted again.` };

  const { error } = await supabase
    .from("crew_matrices")
    .update({ status: "pending_internal_approval", submitted_by: userId, updated_by: userId })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidateMatrix(id);
  return {};
}

export async function approveInternal(id: string, comment?: string) {
  const { supabase, userId } = await requireApproveInternal();
  const { data: matrix, error: fetchError } = await supabase.from("crew_matrices").select("status").eq("id", id).single();
  if (fetchError || !matrix) return { error: "Could not find that crew matrix." };
  if (matrix.status !== "pending_internal_approval") return { error: `This matrix is ${matrix.status.replace(/_/g, " ")}, not pending internal approval.` };

  const { count: clientReqCount } = await supabase
    .from("crew_matrix_lines")
    .select("id", { count: "exact", head: true })
    .eq("crew_matrix_id", id)
    .eq("client_approval_required", true);
  const nextStatus = (clientReqCount ?? 0) > 0 ? "pending_client_approval" : "approved";

  // rejection_reason doubles as "last transition comment" for the
  // status-history trigger, which logs it against every status
  // change — not only actual rejections — so an approval comment
  // ends up on the audit trail without overwriting the header's
  // own notes field.
  const { error } = await supabase
    .from("crew_matrices")
    .update({
      status: nextStatus,
      approved_by: nextStatus === "approved" ? userId : null,
      approved_at: nextStatus === "approved" ? new Date().toISOString() : null,
      rejection_reason: comment?.trim() || null,
      updated_by: userId,
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidateMatrix(id);
  return { nextStatus };
}

export async function rejectInternal(id: string, reason: string) {
  const { supabase, userId } = await requireApproveInternal();
  if (!reason.trim()) return { error: "A rejection reason is required." };
  const { data: matrix, error: fetchError } = await supabase.from("crew_matrices").select("status").eq("id", id).single();
  if (fetchError || !matrix) return { error: "Could not find that crew matrix." };
  if (matrix.status !== "pending_internal_approval") return { error: `This matrix is ${matrix.status.replace(/_/g, " ")}, not pending internal approval.` };

  const { error } = await supabase
    .from("crew_matrices")
    .update({ status: "rejected", rejection_reason: reason.trim(), updated_by: userId })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidateMatrix(id);
  return {};
}

export async function returnForCorrection(id: string, comment: string) {
  const { supabase, access, userId } = await requireApproveInternal();
  const { data: matrix, error: fetchError } = await supabase.from("crew_matrices").select("status").eq("id", id).single();
  if (fetchError || !matrix) return { error: "Could not find that crew matrix." };
  if (!["pending_internal_approval", "pending_client_approval"].includes(matrix.status)) {
    return { error: `This matrix is ${matrix.status.replace(/_/g, " ")} — only a matrix pending approval can be returned for correction.` };
  }
  if (matrix.status === "pending_client_approval" && !can(access, "crew.matrix.approve_client")) {
    return { error: "Only someone who can record client approval can return this matrix from the client-approval stage." };
  }

  const { error } = await supabase
    .from("crew_matrices")
    .update({ status: "draft", rejection_reason: comment.trim() || null, updated_by: userId })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidateMatrix(id);
  return {};
}

export async function approveClient(id: string, referenceNumber: string) {
  const { supabase, userId } = await requireApproveClient();
  const { data: matrix, error: fetchError } = await supabase.from("crew_matrices").select("status").eq("id", id).single();
  if (fetchError || !matrix) return { error: "Could not find that crew matrix." };
  if (matrix.status !== "pending_client_approval") return { error: `This matrix is ${matrix.status.replace(/_/g, " ")}, not pending client approval.` };

  const { error } = await supabase
    .from("crew_matrices")
    .update({
      status: "approved",
      client_approval_reference: referenceNumber.trim() || null,
      approved_by: userId,
      approved_at: new Date().toISOString(),
      updated_by: userId,
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidateMatrix(id);
  return {};
}

export async function rejectClient(id: string, reason: string) {
  const { supabase, userId } = await requireApproveClient();
  if (!reason.trim()) return { error: "A rejection reason is required." };
  const { data: matrix, error: fetchError } = await supabase.from("crew_matrices").select("status").eq("id", id).single();
  if (fetchError || !matrix) return { error: "Could not find that crew matrix." };
  if (matrix.status !== "pending_client_approval") return { error: `This matrix is ${matrix.status.replace(/_/g, " ")}, not pending client approval.` };

  const { error } = await supabase
    .from("crew_matrices")
    .update({ status: "rejected", rejection_reason: reason.trim(), updated_by: userId })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidateMatrix(id);
  return {};
}

export async function activateCrewMatrix(id: string) {
  const { supabase, userId } = await requireManage();
  const { data: matrix, error: fetchError } = await supabase.from("crew_matrices").select("status").eq("id", id).single();
  if (fetchError || !matrix) return { error: "Could not find that crew matrix." };
  if (matrix.status !== "approved") return { error: `This matrix is ${matrix.status.replace(/_/g, " ")}, not approved — it must be approved before it can be activated.` };

  const { error } = await supabase.from("crew_matrices").update({ status: "active", updated_by: userId }).eq("id", id);
  if (error) {
    if (error.message.includes("crew_matrices_one_active_period_per_site")) {
      return { error: "Another matrix is already active on this site for an overlapping period." };
    }
    return { error: error.message };
  }
  revalidateMatrix(id);
  return {};
}

export async function cancelCrewMatrix(id: string) {
  const { supabase, userId } = await requireManage();
  const { data: matrix, error: fetchError } = await supabase.from("crew_matrices").select("status").eq("id", id).single();
  if (fetchError || !matrix) return { error: "Could not find that crew matrix." };
  if (["active", "superseded", "cancelled"].includes(matrix.status)) {
    return { error: `This matrix is ${matrix.status} and can't be cancelled from here.` };
  }

  const { error } = await supabase.from("crew_matrices").update({ status: "cancelled", updated_by: userId }).eq("id", id);
  if (error) return { error: error.message };
  revalidateMatrix(id);
  return {};
}

/* ================= Versioning ================= */

export async function createNewVersion(sourceId: string) {
  const { supabase, access, userId } = await requireManage();
  const { data: source, error: sourceError } = await supabase.from("crew_matrices").select("*").eq("id", sourceId).single();
  if (sourceError || !source) return { error: "Could not find that crew matrix." };
  if (!["approved", "active", "superseded", "rejected"].includes(source.status)) {
    return { error: `A new version can't be created from a matrix that's still ${source.status.replace(/_/g, " ")}.` };
  }

  const { data: maxVersion } = await supabase
    .from("crew_matrices")
    .select("version_number")
    .eq("matrix_number", source.matrix_number)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: newMatrix, error } = await supabase
    .from("crew_matrices")
    .insert({
      org_id: access.orgId,
      project_id: source.project_id,
      offshore_site_id: source.offshore_site_id,
      matrix_number: source.matrix_number,
      version_number: (maxVersion?.version_number ?? source.version_number) + 1,
      title: source.title,
      effective_from: source.effective_from,
      effective_to: source.effective_to,
      expected_pob: source.expected_pob,
      notes: source.notes,
      status: "draft",
      prepared_by: userId,
      created_by: userId,
      updated_by: userId,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  const newId = newMatrix!.id as string;

  const { data: sourceLines } = await supabase.from("crew_matrix_lines").select("*").eq("crew_matrix_id", sourceId).order("sort_order");
  for (const line of sourceLines ?? []) {
    const { data: newLine, error: lineError } = await supabase
      .from("crew_matrix_lines")
      .insert({
        org_id: access.orgId,
        crew_matrix_id: newId,
        line_number: line.line_number,
        job_role_id: line.job_role_id,
        required_headcount: line.required_headcount,
        day_shift_quantity: line.day_shift_quantity,
        night_shift_quantity: line.night_shift_quantity,
        other_shift_quantity: line.other_shift_quantity,
        rotation_template_id: line.rotation_template_id,
        employment_type_preference: line.employment_type_preference,
        nationality_preference: line.nationality_preference,
        language_requirement: line.language_requirement,
        minimum_experience_years: line.minimum_experience_years,
        mobilization_lead_days: line.mobilization_lead_days,
        client_approval_required: line.client_approval_required,
        remarks: line.remarks,
        sort_order: line.sort_order,
        created_by: userId,
        updated_by: userId,
      })
      .select("id")
      .single();
    if (lineError || !newLine) continue;
    const newLineId = newLine.id as string;

    const [skills, documents, competencies, clientReqs] = await Promise.all([
      supabase.from("crew_matrix_line_skills").select("skill_id").eq("line_id", line.id),
      supabase.from("crew_matrix_line_documents").select("document_type_id, minimum_remaining_validity_days, is_mandatory, waiver_permitted").eq("line_id", line.id),
      supabase.from("crew_matrix_line_competencies").select("competency_name, minimum_grade, notes").eq("line_id", line.id),
      supabase.from("crew_matrix_line_client_requirements").select("requirement_text, is_mandatory").eq("line_id", line.id),
    ]);
    await Promise.all([
      (skills.data ?? []).length
        ? supabase.from("crew_matrix_line_skills").insert((skills.data ?? []).map((s) => ({ org_id: access.orgId, line_id: newLineId, skill_id: s.skill_id })))
        : Promise.resolve(),
      (documents.data ?? []).length
        ? supabase.from("crew_matrix_line_documents").insert(
            (documents.data ?? []).map((d) => ({
              org_id: access.orgId,
              line_id: newLineId,
              document_type_id: d.document_type_id,
              minimum_remaining_validity_days: d.minimum_remaining_validity_days,
              is_mandatory: d.is_mandatory,
              waiver_permitted: d.waiver_permitted,
            }))
          )
        : Promise.resolve(),
      (competencies.data ?? []).length
        ? supabase.from("crew_matrix_line_competencies").insert(
            (competencies.data ?? []).map((c) => ({ org_id: access.orgId, line_id: newLineId, competency_name: c.competency_name, minimum_grade: c.minimum_grade, notes: c.notes }))
          )
        : Promise.resolve(),
      (clientReqs.data ?? []).length
        ? supabase.from("crew_matrix_line_client_requirements").insert(
            (clientReqs.data ?? []).map((r) => ({ org_id: access.orgId, line_id: newLineId, requirement_text: r.requirement_text, is_mandatory: r.is_mandatory }))
          )
        : Promise.resolve(),
    ]);
  }

  revalidateMatrix();
  return { id: newId };
}

/* ================= Generate from existing manning requirements ================= */

export async function generateDraftFromManning(projectId: string, offshoreSiteId: string) {
  const { supabase, access, userId } = await requireManage();

  const { data: requirements, error: reqError } = await supabase
    .from("site_manning_requirements")
    .select("job_role_id, minimum_headcount")
    .eq("offshore_site_id", offshoreSiteId);
  if (reqError) return { error: reqError.message };
  if (!requirements || requirements.length === 0) {
    return { error: "This site has no existing manning requirements to generate from." };
  }

  const { data: site } = await supabase.from("offshore_sites").select("name").eq("id", offshoreSiteId).single();

  const { data: code, error: codeError } = await supabase.rpc("next_number_range_code", {
    p_org_id: access.orgId,
    p_entity_type: "crew_matrix",
  });
  if (codeError) return { error: `Could not assign a matrix number: ${codeError.message}` };

  const totalHeadcount = requirements.reduce((sum, r) => sum + (r.minimum_headcount ?? 0), 0);

  const { data: matrix, error } = await supabase
    .from("crew_matrices")
    .insert({
      org_id: access.orgId,
      project_id: projectId,
      offshore_site_id: offshoreSiteId,
      matrix_number: code,
      version_number: 1,
      title: `${site?.name ?? "Site"} — Crew Matrix (generated from manning requirements)`,
      expected_pob: totalHeadcount,
      status: "draft",
      prepared_by: userId,
      created_by: userId,
      updated_by: userId,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  const newId = matrix!.id as string;

  const lines = requirements.map((r, i) => ({
    org_id: access.orgId,
    crew_matrix_id: newId,
    line_number: i + 1,
    job_role_id: r.job_role_id,
    required_headcount: r.minimum_headcount ?? 1,
    sort_order: i,
    created_by: userId,
    updated_by: userId,
  }));
  const { error: linesError } = await supabase.from("crew_matrix_lines").insert(lines);
  if (linesError) return { error: linesError.message, id: newId };

  revalidateMatrix();
  return { id: newId };
}
