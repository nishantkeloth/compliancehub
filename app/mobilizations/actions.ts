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

const requireView = () => requirePermission("mobilization.view", "You don't have permission to view mobilization requests.");
const requireManage = () => requirePermission("mobilization.manage", "You don't have permission to manage mobilization requests.");
const requireComplianceReview = () => requirePermission("mobilization.compliance_review", "You don't have permission to run compliance review on mobilizations.");
const requireApprove = () => requirePermission("mobilization.approve", "You don't have permission to approve mobilization requests.");
const requireCancel = () => requirePermission("mobilization.cancel", "You don't have permission to cancel mobilization requests.");
const requireEmergencyOverride = () => requirePermission("mobilization.emergency_override", "You don't have permission to fast-track a mobilization.");

function str(formData: FormData, key: string) {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}
function optStr(formData: FormData, key: string) {
  const v = str(formData, key);
  return v || null;
}

const TERMINAL_STATUSES = ["completed", "partially_completed", "cancelled"];

const revalidateMobilization = (id?: string) => {
  revalidatePath("/mobilizations");
  if (id) revalidatePath(`/mobilizations/${id}`);
};

async function getRequest(supabase: Supa, id: string) {
  const { data, error } = await supabase
    .from("mobilization_requests")
    .select("id, org_id, status, crew_matrix_id, offshore_site_id, required_onboard_date, mobilization_number, client_approval_required")
    .eq("id", id)
    .single();
  if (error || !data) throw new Error("Could not find that mobilization request.");
  return data;
}

async function assertNotTerminal(supabase: Supa, id: string) {
  const req = await getRequest(supabase, id);
  if (TERMINAL_STATUSES.includes(req.status)) {
    throw new Error(`This mobilization request is ${req.status.replace(/_/g, " ")} and can no longer be changed.`);
  }
  return req;
}

async function postSystemComment(supabase: Supa, orgId: string | null, requestId: string, body: string) {
  await supabase.from("mobilization_comments").insert({
    org_id: orgId,
    mobilization_request_id: requestId,
    user_id: null,
    body,
    is_system: true,
  });
}

/* ================= Header ================= */

export async function createMobilizationRequest(formData: FormData) {
  const { supabase, access, userId } = await requireManage();
  const crewMatrixId = str(formData, "crewMatrixId");
  if (!crewMatrixId) return { error: "Select a crew matrix." };
  const mobilizationType = str(formData, "mobilizationType");
  if (!mobilizationType) return { error: "Mobilization type is required." };
  const requiredOnboardDate = str(formData, "requiredOnboardDate");
  if (!requiredOnboardDate) return { error: "Required onboard date is required." };

  const { data: matrix, error: matrixError } = await supabase
    .from("crew_matrices")
    .select("status, project_id, offshore_site_id")
    .eq("id", crewMatrixId)
    .single();
  if (matrixError || !matrix) return { error: "Could not find that crew matrix." };
  if (!["approved", "active"].includes(matrix.status)) {
    return { error: `This crew matrix is ${matrix.status.replace(/_/g, " ")} — only an approved or active matrix can be mobilized from.` };
  }

  const { data: code, error: codeError } = await supabase.rpc("next_number_range_code", {
    p_org_id: access.orgId,
    p_entity_type: "mobilization",
  });
  if (codeError) return { error: `Could not assign a mobilization number: ${codeError.message}` };

  const { data: mobilization, error } = await supabase
    .from("mobilization_requests")
    .insert({
      org_id: access.orgId,
      mobilization_number: code,
      project_id: matrix.project_id,
      offshore_site_id: matrix.offshore_site_id,
      crew_matrix_id: crewMatrixId,
      mobilization_type: mobilizationType,
      required_onboard_date: requiredOnboardDate,
      crew_change_location: optStr(formData, "crewChangeLocation"),
      travel_origin: optStr(formData, "travelOrigin"),
      special_instructions: optStr(formData, "specialInstructions"),
      priority: str(formData, "priority") || "normal",
      coordinator_user_id: optStr(formData, "coordinatorUserId"),
      requested_by: userId,
      status: "draft",
      created_by: userId,
      updated_by: userId,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  revalidateMobilization();
  return { id: mobilization?.id };
}

export async function updateMobilizationHeader(id: string, formData: FormData) {
  const { supabase, userId } = await requireManage();
  const req = await getRequest(supabase, id);
  if (!["draft", "planning"].includes(req.status)) {
    return { error: `This request is ${req.status.replace(/_/g, " ")} — header details can only be edited while it's in draft or planning.` };
  }
  const requiredOnboardDate = str(formData, "requiredOnboardDate");
  if (!requiredOnboardDate) return { error: "Required onboard date is required." };

  const { error } = await supabase
    .from("mobilization_requests")
    .update({
      mobilization_type: str(formData, "mobilizationType") || undefined,
      required_onboard_date: requiredOnboardDate,
      crew_change_location: optStr(formData, "crewChangeLocation"),
      travel_origin: optStr(formData, "travelOrigin"),
      special_instructions: optStr(formData, "specialInstructions"),
      priority: str(formData, "priority") || "normal",
      coordinator_user_id: optStr(formData, "coordinatorUserId"),
      updated_by: userId,
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidateMobilization(id);
  return {};
}

export async function deleteMobilizationRequest(id: string) {
  const { supabase } = await requireManage();
  const req = await getRequest(supabase, id);
  if (req.status !== "draft") return { error: "Only a draft mobilization request can be deleted." };
  const { error } = await supabase.from("mobilization_requests").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidateMobilization();
  return {};
}

/* ================= Positions: generate + additional ================= */

export async function generatePositionsFromMatrix(requestId: string) {
  const { supabase, access, userId } = await requireManage();
  const req = await getRequest(supabase, requestId);

  const { count: existingCount } = await supabase
    .from("mobilization_positions")
    .select("id", { count: "exact", head: true })
    .eq("mobilization_request_id", requestId);
  if ((existingCount ?? 0) > 0) {
    return { error: "Positions have already been generated for this request — use “Add position” for anything extra." };
  }

  const { data: lines, error: linesError } = await supabase
    .from("crew_matrix_lines")
    .select("id, job_role_id, required_headcount, client_approval_required")
    .eq("crew_matrix_id", req.crew_matrix_id)
    .order("sort_order", { ascending: true });
  if (linesError) return { error: linesError.message };
  if (!lines || lines.length === 0) {
    return { error: "The selected crew matrix has no lines to generate positions from." };
  }

  const rows: Record<string, unknown>[] = [];
  for (const line of lines) {
    const headcount = Math.max(1, line.required_headcount ?? 1);
    for (let seq = 1; seq <= headcount; seq++) {
      rows.push({
        org_id: access.orgId,
        mobilization_request_id: requestId,
        crew_matrix_line_id: line.id,
        job_role_id: line.job_role_id,
        position_sequence: seq,
        client_approval_status: line.client_approval_required ? "pending" : "not_required",
        created_by: userId,
        updated_by: userId,
      });
    }
  }
  const { error: insertError } = await supabase.from("mobilization_positions").insert(rows);
  if (insertError) return { error: insertError.message };

  const anyClientApproval = lines.some((l) => l.client_approval_required);
  if (anyClientApproval !== req.client_approval_required) {
    await supabase.from("mobilization_requests").update({ client_approval_required: anyClientApproval }).eq("id", requestId);
  }

  revalidateMobilization(requestId);
  return { count: rows.length };
}

export async function addAdditionalPosition(requestId: string, formData: FormData) {
  const { supabase, access, userId } = await requireManage();
  await assertNotTerminal(supabase, requestId);
  const jobRoleId = str(formData, "jobRoleId");
  if (!jobRoleId) return { error: "Job role is required." };
  const reason = str(formData, "reason");
  if (!reason) return { error: "A reason is required for a position outside the crew matrix." };

  const { count } = await supabase
    .from("mobilization_positions")
    .select("id", { count: "exact", head: true })
    .eq("mobilization_request_id", requestId)
    .eq("job_role_id", jobRoleId);

  const { data: position, error } = await supabase
    .from("mobilization_positions")
    .insert({
      org_id: access.orgId,
      mobilization_request_id: requestId,
      job_role_id: jobRoleId,
      position_sequence: (count ?? 0) + 1,
      required_onboard_date: optStr(formData, "requiredOnboardDate"),
      is_additional: true,
      additional_reason: reason,
      client_approval_status: "not_required",
      created_by: userId,
      updated_by: userId,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  revalidateMobilization(requestId);
  return { id: position?.id };
}

export async function deleteAdditionalPosition(positionId: string, requestId: string) {
  const { supabase } = await requireManage();
  await assertNotTerminal(supabase, requestId);
  const { data: position, error: fetchError } = await supabase
    .from("mobilization_positions")
    .select("is_additional")
    .eq("id", positionId)
    .single();
  if (fetchError || !position) return { error: "Could not find that position." };
  if (!position.is_additional) return { error: "Only a position added outside the crew matrix can be removed here." };
  const { error } = await supabase.from("mobilization_positions").delete().eq("id", positionId);
  if (error) return { error: error.message };
  revalidateMobilization(requestId);
  return {};
}

/* ================= Candidate eligibility (deterministic — no AI) ================= */

export type CandidateTier = "eligible" | "partial" | "ineligible";
export type Candidate = {
  id: string;
  employee_code: string | null;
  full_name: string;
  tier: CandidateTier;
  reasons: string[];
  availability_date: string | null;
  current_vessel: string | null;
  current_rotation: string | null;
  skill_match: string;
  day_rate: number | null;
  currency: string | null;
};

export async function listCandidates(positionId: string): Promise<{ candidates: Candidate[] } | { error: string }> {
  const { supabase, access } = await requireView();
  const canViewCost = can(access, "crew.view_cost");

  const { data: position, error: positionError } = await supabase
    .from("mobilization_positions")
    .select("id, mobilization_request_id, job_role_id, required_onboard_date, crew_matrix_line_id")
    .eq("id", positionId)
    .single();
  if (positionError || !position) return { error: "Could not find that position." };

  const { data: request, error: requestError } = await supabase
    .from("mobilization_requests")
    .select("required_onboard_date")
    .eq("id", position.mobilization_request_id)
    .single();
  if (requestError || !request) return { error: "Could not find the parent mobilization request." };

  const effectiveDate = position.required_onboard_date ?? request.required_onboard_date;

  const [requiredSkillsRes, requiredDocsRes] = await Promise.all([
    position.crew_matrix_line_id
      ? supabase.from("crew_matrix_line_skills").select("skill_id, skills(name)").eq("line_id", position.crew_matrix_line_id)
      : Promise.resolve({ data: [] as { skill_id: string; skills: { name?: string } | { name?: string }[] | null }[] }),
    position.crew_matrix_line_id
      ? supabase
          .from("crew_matrix_line_documents")
          .select("document_type_id, minimum_remaining_validity_days, is_mandatory, waiver_permitted, document_types(name)")
          .eq("line_id", position.crew_matrix_line_id)
      : Promise.resolve({
          data: [] as {
            document_type_id: string;
            minimum_remaining_validity_days: number | null;
            is_mandatory: boolean;
            waiver_permitted: boolean;
            document_types: { name?: string } | { name?: string }[] | null;
          }[],
        }),
  ]);
  const requiredSkills = requiredSkillsRes.data ?? [];
  const requiredDocs = requiredDocsRes.data ?? [];

  // day_rate/currency are always selected here (this data never leaves
  // the server — Candidate strips them out below unless the caller
  // holds crew.view_cost) rather than built into a dynamic select
  // string, which supabase-js can't type-check.
  const CREW_FIELDS = "id, employee_code, full_name, availability_date, default_rotation_template_id, rotation_templates(name), day_rate, currency";

  const [primaryRes, secondaryLinkRes] = await Promise.all([
    supabase.from("crew_profiles").select(CREW_FIELDS).eq("org_id", access.orgId).eq("employment_status", "active").eq("primary_job_role_id", position.job_role_id),
    supabase.from("crew_secondary_roles").select("crew_id").eq("job_role_id", position.job_role_id),
  ]);
  const primary = primaryRes.data ?? [];
  const secondaryCrewIds = (secondaryLinkRes.data ?? [])
    .map((r) => r.crew_id as string)
    .filter((id) => !primary.some((p) => p.id === id));
  const secondaryRes = secondaryCrewIds.length
    ? await supabase.from("crew_profiles").select(CREW_FIELDS).eq("org_id", access.orgId).eq("employment_status", "active").in("id", secondaryCrewIds)
    : { data: [] };
  const pool = [...primary, ...(secondaryRes.data ?? [])];

  if (pool.length === 0) return { candidates: [] as Candidate[] };
  const crewIds = pool.map((c) => c.id);

  const [skillsRes, docsRes, assignmentsRes, reservationsRes] = await Promise.all([
    supabase.from("crew_skills").select("crew_id, skill_id").in("crew_id", crewIds),
    supabase.from("crew_documents").select("crew_id, document_type_id, expiry_date").in("crew_id", crewIds),
    supabase.from("crew_assignments").select("crew_id, offshore_sites(name)").in("crew_id", crewIds).is("end_date", null),
    supabase.from("mobilization_positions").select("id, selected_crew_id").in("selected_crew_id", crewIds).eq("final_status", "pending"),
  ]);
  const crewSkills = skillsRes.data ?? [];
  const crewDocs = docsRes.data ?? [];
  const openAssignments = assignmentsRes.data ?? [];
  const reservations = (reservationsRes.data ?? []).filter((r) => r.id !== positionId);

  const candidates: Candidate[] = pool.map((c) => {
    const reasons: string[] = [];
    let tier: CandidateTier = "eligible";

    const reservedElsewhere = reservations.find((r) => r.selected_crew_id === c.id);
    if (reservedElsewhere) {
      tier = "ineligible";
      reasons.push("Already reserved on another mobilization request.");
    }

    if (c.availability_date && c.availability_date > effectiveDate) {
      tier = "ineligible";
      reasons.push(`Not available until ${c.availability_date}.`);
    }

    const mySkillIds = new Set(crewSkills.filter((s) => s.crew_id === c.id).map((s) => s.skill_id));
    const missingSkills = requiredSkills.filter((rs) => !mySkillIds.has(rs.skill_id));
    if (requiredSkills.length > 0 && missingSkills.length > 0 && tier !== "ineligible") tier = "partial";
    if (missingSkills.length > 0) {
      const names = missingSkills.map((s) => {
        const rel = Array.isArray(s.skills) ? s.skills[0] : s.skills;
        return rel?.name ?? "skill";
      });
      reasons.push(`Missing skill${missingSkills.length > 1 ? "s" : ""}: ${names.join(", ")}.`);
    }

    const myDocs = crewDocs.filter((d) => d.crew_id === c.id);
    for (const rd of requiredDocs) {
      const doc = myDocs.find((d) => d.document_type_id === rd.document_type_id);
      const docName = (() => {
        const rel = Array.isArray(rd.document_types) ? rd.document_types[0] : rd.document_types;
        return rel?.name ?? "document";
      })();
      const minValidDate = rd.minimum_remaining_validity_days
        ? addDays(effectiveDate, rd.minimum_remaining_validity_days)
        : effectiveDate;
      const expired = !doc?.expiry_date || doc.expiry_date < minValidDate;
      if (expired) {
        if (rd.is_mandatory && !rd.waiver_permitted) {
          tier = "ineligible";
          reasons.push(`Missing/expired mandatory document: ${docName}.`);
        } else if (rd.is_mandatory && rd.waiver_permitted) {
          if (tier !== "ineligible") tier = "partial";
          reasons.push(`Missing/expired document (waiver possible): ${docName}.`);
        } else {
          reasons.push(`Missing/expired optional document: ${docName}.`);
        }
      }
    }

    const currentAssignment = openAssignments.find((a) => a.crew_id === c.id);
    const currentVesselName = currentAssignment
      ? ((Array.isArray(currentAssignment.offshore_sites) ? currentAssignment.offshore_sites[0] : currentAssignment.offshore_sites) as { name?: string } | null)?.name ?? null
      : null;
    if (currentVesselName && tier !== "ineligible") {
      tier = "partial";
      reasons.push(`Currently deployed on ${currentVesselName}.`);
    }

    const rotationRel = Array.isArray(c.rotation_templates) ? c.rotation_templates[0] : c.rotation_templates;

    return {
      id: c.id,
      employee_code: c.employee_code,
      full_name: c.full_name,
      tier,
      reasons,
      availability_date: c.availability_date,
      current_vessel: currentVesselName,
      current_rotation: rotationRel?.name ?? null,
      skill_match: requiredSkills.length > 0 ? `${requiredSkills.length - missingSkills.length}/${requiredSkills.length}` : "—",
      day_rate: canViewCost ? c.day_rate ?? null : null,
      currency: canViewCost ? c.currency ?? null : null,
    };
  });

  const order: Record<CandidateTier, number> = { eligible: 0, partial: 1, ineligible: 2 };
  candidates.sort((a, b) => order[a.tier] - order[b.tier] || a.full_name.localeCompare(b.full_name));

  return { candidates };
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/* ================= Selection / reservation / replacement ================= */

function isReservationConflict(message: string) {
  return message.includes("mobilization_positions_one_active_reservation");
}

export async function selectCandidate(positionId: string, requestId: string, crewId: string) {
  const { supabase, access, userId } = await requireManage();
  await assertNotTerminal(supabase, requestId);
  const { data: position, error: fetchError } = await supabase
    .from("mobilization_positions")
    .select("id, selected_crew_id")
    .eq("id", positionId)
    .single();
  if (fetchError || !position) return { error: "Could not find that position." };
  if (position.selected_crew_id) return { error: "This position already has a candidate selected — use Replace instead." };

  const { error } = await supabase
    .from("mobilization_positions")
    .update({ selected_crew_id: crewId, readiness_status: "selected", updated_by: userId })
    .eq("id", positionId);
  if (error) {
    if (isReservationConflict(error.message)) return { error: "This crew member is already reserved on another mobilization request." };
    return { error: error.message };
  }

  await supabase.from("mobilization_position_history").insert({
    org_id: access.orgId,
    mobilization_position_id: positionId,
    previous_crew_id: null,
    new_crew_id: crewId,
    reason: "Initial selection",
    changed_by: userId,
  });

  revalidateMobilization(requestId);
  return {};
}

export async function replaceCandidate(positionId: string, requestId: string, crewId: string, reason: string) {
  const { supabase, access, userId } = await requireManage();
  await assertNotTerminal(supabase, requestId);
  if (!reason.trim()) return { error: "A reason is required to replace a selected candidate." };
  const { data: position, error: fetchError } = await supabase
    .from("mobilization_positions")
    .select("id, selected_crew_id, client_approval_status, crew_matrix_line_id")
    .eq("id", positionId)
    .single();
  if (fetchError || !position) return { error: "Could not find that position." };
  if (!position.selected_crew_id) return { error: "No candidate is selected yet — use Select instead." };
  if (position.selected_crew_id === crewId) return { error: "That candidate is already selected for this position." };

  // A new candidate hasn't been through compliance/approval yet, even if
  // the person they're replacing had — reset readiness so they're
  // re-vetted rather than inheriting someone else's clearance.
  const { error } = await supabase
    .from("mobilization_positions")
    .update({
      selected_crew_id: crewId,
      readiness_status: "selected",
      client_approval_status: position.client_approval_status === "not_required" ? "not_required" : "pending",
      updated_by: userId,
    })
    .eq("id", positionId);
  if (error) {
    if (isReservationConflict(error.message)) return { error: "This crew member is already reserved on another mobilization request." };
    return { error: error.message };
  }

  await supabase.from("mobilization_position_history").insert({
    org_id: access.orgId,
    mobilization_position_id: positionId,
    previous_crew_id: position.selected_crew_id,
    new_crew_id: crewId,
    reason: reason.trim(),
    changed_by: userId,
  });

  revalidateMobilization(requestId);
  return {};
}

export async function clearCandidate(positionId: string, requestId: string) {
  const { supabase, access, userId } = await requireManage();
  await assertNotTerminal(supabase, requestId);
  const { data: position, error: fetchError } = await supabase
    .from("mobilization_positions")
    .select("selected_crew_id")
    .eq("id", positionId)
    .single();
  if (fetchError || !position) return { error: "Could not find that position." };
  if (!position.selected_crew_id) return {};

  const { error } = await supabase
    .from("mobilization_positions")
    .update({ selected_crew_id: null, readiness_status: "open", updated_by: userId })
    .eq("id", positionId);
  if (error) return { error: error.message };

  await supabase.from("mobilization_position_history").insert({
    org_id: access.orgId,
    mobilization_position_id: positionId,
    previous_crew_id: position.selected_crew_id,
    new_crew_id: null,
    reason: "Cleared",
    changed_by: userId,
  });

  revalidateMobilization(requestId);
  return {};
}

export async function markPositionCompliance(positionId: string, requestId: string, cleared: boolean, note?: string) {
  const { supabase, access, userId } = await requireComplianceReview();
  const req = await getRequest(supabase, requestId);
  if (req.status !== "compliance_review") return { error: "Compliance can only be recorded while the request is in compliance review." };
  const { data: position, error: fetchError } = await supabase
    .from("mobilization_positions")
    .select("selected_crew_id, job_role_id")
    .eq("id", positionId)
    .single();
  if (fetchError || !position) return { error: "Could not find that position." };
  if (!position.selected_crew_id) return { error: "Select a candidate for this position before recording compliance." };

  const { error } = await supabase
    .from("mobilization_positions")
    .update({ readiness_status: cleared ? "compliance_cleared" : "compliance_issue", updated_by: userId })
    .eq("id", positionId);
  if (error) return { error: error.message };
  if (note?.trim()) {
    await postSystemComment(supabase, access.orgId, requestId, `Compliance ${cleared ? "cleared" : "issue"} — ${note.trim()}`);
  }
  revalidateMobilization(requestId);
  return {};
}

export async function approvePosition(positionId: string, requestId: string, approved: boolean, note?: string) {
  const { supabase, access, userId } = await requireApprove();
  const req = await getRequest(supabase, requestId);
  if (req.status !== "client_approval") return { error: "Position-level client approval can only be recorded during the client approval stage." };
  const { data: position, error: fetchError } = await supabase
    .from("mobilization_positions")
    .select("client_approval_status")
    .eq("id", positionId)
    .single();
  if (fetchError || !position) return { error: "Could not find that position." };
  if (position.client_approval_status === "not_required") return { error: "This position doesn't require client approval." };

  const { error } = await supabase
    .from("mobilization_positions")
    .update({ client_approval_status: approved ? "approved" : "rejected", updated_by: userId })
    .eq("id", positionId);
  if (error) return { error: error.message };
  if (note?.trim()) {
    await postSystemComment(supabase, access.orgId, requestId, `Client ${approved ? "approved" : "rejected"} a position — ${note.trim()}`);
  }
  revalidateMobilization(requestId);
  return {};
}

export async function markPositionVacant(positionId: string, requestId: string, reason: string) {
  const { supabase, access, userId } = await requireManage();
  if (!reason.trim()) return { error: "A reason is required to mark a position vacant." };
  const { error } = await supabase
    .from("mobilization_positions")
    .update({ final_status: "vacant", updated_by: userId })
    .eq("id", positionId);
  if (error) return { error: error.message };
  await postSystemComment(supabase, access.orgId, requestId, `Position marked vacant — ${reason.trim()}`);
  revalidateMobilization(requestId);
  return {};
}

export async function confirmBoarding(positionId: string, requestId: string) {
  const { supabase, userId } = await requireManage();
  const req = await getRequest(supabase, requestId);
  if (!["ready_to_mobilize", "in_transit"].includes(req.status)) {
    return { error: "Boarding can only be confirmed once the request is ready to mobilize or in transit." };
  }
  const { data: position, error: fetchError } = await supabase
    .from("mobilization_positions")
    .select("selected_crew_id, required_onboard_date, final_status")
    .eq("id", positionId)
    .single();
  if (fetchError || !position) return { error: "Could not find that position." };
  if (!position.selected_crew_id) return { error: "Select a candidate before confirming boarding." };
  if (position.final_status === "filled") return { error: "This position is already marked as boarded." };

  const startDate = position.required_onboard_date ?? req.required_onboard_date;

  // Same close-old/open-new sequencing the roster board already uses
  // for crew_assignments — this is the one place in Phase 3 that
  // touches that table, and only once boarding is actually confirmed.
  const { error: closeError } = await supabase
    .from("crew_assignments")
    .update({ end_date: startDate, updated_by: userId })
    .eq("crew_id", position.selected_crew_id)
    .is("end_date", null);
  if (closeError) return { error: closeError.message };

  const { error: assignError } = await supabase.from("crew_assignments").insert({
    org_id: req.org_id,
    crew_id: position.selected_crew_id,
    offshore_site_id: req.offshore_site_id,
    start_date: startDate,
    notes: `Boarded via mobilization ${req.mobilization_number ?? requestId}`,
    created_by: userId,
    updated_by: userId,
  });
  if (assignError) return { error: assignError.message };

  const { error } = await supabase
    .from("mobilization_positions")
    .update({ final_status: "filled", readiness_status: "boarded", updated_by: userId })
    .eq("id", positionId);
  if (error) return { error: error.message };

  revalidateMobilization(requestId);
  return {};
}

/* ================= Comments ================= */

export async function postComment(requestId: string, body: string) {
  const { supabase, access, userId } = await requireView();
  if (!body.trim()) return { error: "Comment can't be empty." };
  const { error } = await supabase.from("mobilization_comments").insert({
    org_id: access.orgId,
    mobilization_request_id: requestId,
    user_id: userId,
    body: body.trim(),
    is_system: false,
  });
  if (error) return { error: error.message };
  revalidateMobilization(requestId);
  return {};
}

/* ================= Workflow ================= */

export async function advanceToPlanning(id: string) {
  const { supabase, userId } = await requireManage();
  const req = await getRequest(supabase, id);
  if (req.status !== "draft") return { error: `This request is ${req.status.replace(/_/g, " ")}, not draft.` };
  const { count } = await supabase.from("mobilization_positions").select("id", { count: "exact", head: true }).eq("mobilization_request_id", id);
  if (!count) return { error: "Generate positions from the crew matrix before moving to planning." };

  const { error } = await supabase.from("mobilization_requests").update({ status: "planning", updated_by: userId }).eq("id", id);
  if (error) return { error: error.message };
  revalidateMobilization(id);
  return {};
}

export async function advanceToComplianceReview(id: string) {
  const { supabase, userId } = await requireManage();
  const req = await getRequest(supabase, id);
  if (req.status !== "planning") return { error: `This request is ${req.status.replace(/_/g, " ")}, not planning.` };
  const { count } = await supabase
    .from("mobilization_positions")
    .select("id", { count: "exact", head: true })
    .eq("mobilization_request_id", id)
    .not("selected_crew_id", "is", null);
  if (!count) return { error: "Select at least one candidate before moving to compliance review." };

  const { error } = await supabase.from("mobilization_requests").update({ status: "compliance_review", updated_by: userId }).eq("id", id);
  if (error) return { error: error.message };
  revalidateMobilization(id);
  return {};
}

export async function returnToPlanning(id: string, comment: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "mobilization.manage") && !can(access, "mobilization.compliance_review") && !can(access, "mobilization.approve")) {
    return { error: "You don't have permission to return this request for correction." };
  }
  if (!access.orgId) return { error: "No company context." };
  const userId = user.id;

  if (!comment.trim()) return { error: "A comment is required when returning a request for correction." };
  const req = await getRequest(supabase, id);
  if (!["compliance_review", "internal_approval", "client_approval"].includes(req.status)) {
    return { error: `This request is ${req.status.replace(/_/g, " ")} — only a request pending review or approval can be returned.` };
  }

  const { error } = await supabase.from("mobilization_requests").update({ status: "planning", updated_by: userId }).eq("id", id);
  if (error) return { error: error.message };
  await postSystemComment(supabase, access.orgId, id, `Returned to planning from ${req.status.replace(/_/g, " ")} — ${comment.trim()}`);
  revalidateMobilization(id);
  return {};
}

export async function advanceToInternalApproval(id: string) {
  const { supabase, userId } = await requireComplianceReview();
  const req = await getRequest(supabase, id);
  if (req.status !== "compliance_review") return { error: `This request is ${req.status.replace(/_/g, " ")}, not in compliance review.` };

  const { count: unresolvedCount } = await supabase
    .from("mobilization_positions")
    .select("id", { count: "exact", head: true })
    .eq("mobilization_request_id", id)
    .in("readiness_status", ["open", "compliance_issue"]);

  const { error } = await supabase.from("mobilization_requests").update({ status: "internal_approval", updated_by: userId }).eq("id", id);
  if (error) return { error: error.message };
  revalidateMobilization(id);
  return unresolvedCount ? { warning: `${unresolvedCount} position(s) are still unselected or flagged with a compliance issue.` } : {};
}

export async function approveInternal(id: string, comment?: string) {
  const { supabase, access, userId } = await requireApprove();
  const req = await getRequest(supabase, id);
  if (req.status !== "internal_approval") return { error: `This request is ${req.status.replace(/_/g, " ")}, not pending internal approval.` };

  const nextStatus = req.client_approval_required ? "client_approval" : "travel_arrangement";
  const update: Record<string, unknown> = { status: nextStatus, updated_by: userId };
  if (nextStatus === "travel_arrangement") {
    update.approved_by = userId;
    update.approved_at = new Date().toISOString();
  }
  const { error } = await supabase.from("mobilization_requests").update(update).eq("id", id);
  if (error) return { error: error.message };
  if (comment?.trim()) await postSystemComment(supabase, access.orgId, id, `Internal approval — ${comment.trim()}`);
  revalidateMobilization(id);
  return { nextStatus };
}

export async function approveClient(id: string, referenceOrComment?: string) {
  const { supabase, access, userId } = await requireApprove();
  const req = await getRequest(supabase, id);
  if (req.status !== "client_approval") return { error: `This request is ${req.status.replace(/_/g, " ")}, not pending client approval.` };

  const { count: pendingCount } = await supabase
    .from("mobilization_positions")
    .select("id", { count: "exact", head: true })
    .eq("mobilization_request_id", id)
    .eq("client_approval_status", "pending");
  if (pendingCount) return { error: `${pendingCount} position(s) are still awaiting client approval — resolve them first.` };

  const { error } = await supabase
    .from("mobilization_requests")
    .update({ status: "travel_arrangement", approved_by: userId, approved_at: new Date().toISOString(), updated_by: userId })
    .eq("id", id);
  if (error) return { error: error.message };
  if (referenceOrComment?.trim()) await postSystemComment(supabase, access.orgId, id, `Client approval — ${referenceOrComment.trim()}`);
  revalidateMobilization(id);
  return {};
}

export async function markTravelArranged(id: string) {
  const { supabase, userId } = await requireManage();
  const req = await getRequest(supabase, id);
  if (req.status !== "travel_arrangement") return { error: `This request is ${req.status.replace(/_/g, " ")}, not in travel arrangement.` };
  const { error } = await supabase.from("mobilization_requests").update({ status: "ready_to_mobilize", updated_by: userId }).eq("id", id);
  if (error) return { error: error.message };
  revalidateMobilization(id);
  return {};
}

export async function markInTransit(id: string) {
  const { supabase, userId } = await requireManage();
  const req = await getRequest(supabase, id);
  if (req.status !== "ready_to_mobilize") return { error: `This request is ${req.status.replace(/_/g, " ")}, not ready to mobilize.` };
  const { error } = await supabase.from("mobilization_requests").update({ status: "in_transit", updated_by: userId }).eq("id", id);
  if (error) return { error: error.message };
  revalidateMobilization(id);
  return {};
}

export async function completeMobilization(id: string) {
  const { supabase, userId } = await requireManage();
  const req = await getRequest(supabase, id);
  if (req.status !== "in_transit") return { error: `This request is ${req.status.replace(/_/g, " ")}, not in transit.` };

  const { data: positions, error: positionsError } = await supabase
    .from("mobilization_positions")
    .select("final_status")
    .eq("mobilization_request_id", id)
    .neq("final_status", "cancelled");
  if (positionsError) return { error: positionsError.message };
  if ((positions ?? []).some((p) => p.final_status === "pending")) {
    return { error: "Some positions are still pending — confirm boarding or mark them vacant before completing." };
  }
  const anyVacant = (positions ?? []).some((p) => p.final_status === "vacant");

  const { error } = await supabase
    .from("mobilization_requests")
    .update({ status: anyVacant ? "partially_completed" : "completed", updated_by: userId })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidateMobilization(id);
  return { status: anyVacant ? "partially_completed" : "completed" };
}

export async function cancelMobilization(id: string, reason: string) {
  const { supabase, access, userId } = await requireCancel();
  if (!reason.trim()) return { error: "A reason is required to cancel a mobilization request." };
  const req = await getRequest(supabase, id);
  if (TERMINAL_STATUSES.includes(req.status)) return { error: `This request is already ${req.status.replace(/_/g, " ")}.` };

  const { error } = await supabase.from("mobilization_requests").update({ status: "cancelled", updated_by: userId }).eq("id", id);
  if (error) return { error: error.message };

  // Free up any pending reservations this request was holding.
  await supabase.from("mobilization_positions").update({ final_status: "cancelled", updated_by: userId }).eq("mobilization_request_id", id).eq("final_status", "pending");

  await postSystemComment(supabase, access.orgId, id, `Cancelled — ${reason.trim()}`);
  revalidateMobilization(id);
  return {};
}

export async function emergencyFastTrack(id: string) {
  const { supabase, access, userId } = await requireEmergencyOverride();
  const req = await getRequest(supabase, id);
  if (TERMINAL_STATUSES.includes(req.status) || ["ready_to_mobilize", "in_transit"].includes(req.status)) {
    return { error: `This request is ${req.status.replace(/_/g, " ")} — there's no approval sequence left to skip.` };
  }

  const { data: fullReq } = await supabase.from("mobilization_requests").select("priority").eq("id", id).single();
  if (fullReq?.priority !== "emergency") {
    return { error: "Only a request with priority “Emergency” can be fast-tracked." };
  }

  const { error } = await supabase
    .from("mobilization_requests")
    .update({ status: "ready_to_mobilize", approved_by: userId, approved_at: new Date().toISOString(), updated_by: userId })
    .eq("id", id);
  if (error) return { error: error.message };
  await postSystemComment(supabase, access.orgId, id, "Emergency override used — normal approval sequence was skipped.");
  revalidateMobilization(id);
  return {};
}
