"use server";

import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveAccess, can } from "@/lib/rbac";
import { loadPositionContext, evaluateCandidateReadiness, evaluateCandidatesReadiness, snapshotSelectedPositions, writeReadinessSnapshot } from "@/lib/readiness";

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
    .select("id, org_id, status, crew_matrix_id, offshore_site_id, project_id, required_onboard_date, mobilization_number, client_approval_required")
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

// Phase 4: evaluates every selected position's readiness and returns a
// human-readable explanation of any that are blocked (not_ready) —
// null when everything is clear to proceed. Used to gate the workflow
// transitions the acceptance criteria call "final approval" (internal
// approval, client approval, marking ready to mobilize, and boarding);
// entering compliance/internal review itself stays a soft warning (see
// advanceToInternalApproval) since the crew is still being worked out
// at that point. An approved compliance waiver moves a check to
// "overridden" rather than "fail", so a waived position is not blocked
// here — that's the whole point of the waiver mechanism.
async function checkBlockingReadiness(supabase: Supa, orgId: string, requestId: string): Promise<string | null> {
  const { data: positions } = await supabase
    .from("mobilization_positions")
    .select("id, selected_crew_id, crew_profiles(full_name)")
    .eq("mobilization_request_id", requestId)
    .not("selected_crew_id", "is", null);

  const problems: string[] = [];
  for (const p of positions ?? []) {
    if (!p.selected_crew_id) continue;
    const ctx = await loadPositionContext(supabase, orgId, p.id);
    if ("error" in ctx) continue;
    const evaluation = await evaluateCandidateReadiness(supabase, ctx, p.selected_crew_id);
    if ("error" in evaluation) continue;
    if (evaluation.overallOutcome === "not_ready") {
      const crewProfile = Array.isArray(p.crew_profiles) ? p.crew_profiles[0] : p.crew_profiles;
      const crewName = (crewProfile as { full_name?: string } | null)?.full_name ?? "Crew member";
      const failing = evaluation.checks.filter((c) => c.blocking && c.result === "fail").map((c) => c.description);
      problems.push(`${crewName} — ${failing.join("; ")}`);
    }
  }
  if (problems.length === 0) return null;
  return `Not every position is ready: ${problems.join(" | ")}. Resolve these or request a compliance waiver before proceeding.`;
}

// Phase 6: a crew member flagged in_transit whose trip is cancelled or
// whose position is vacated goes back to onshore (unless they're onboard
// somewhere already).
async function resetTransitStatus(supabase: Supa, crewIds: (string | null)[]) {
  const ids = crewIds.filter((id): id is string => !!id);
  if (!ids.length) return;
  const { data: active } = await supabase.from("crew_assignments").select("crew_id").in("crew_id", ids).is("end_date", null);
  const onboard = new Set((active ?? []).map((a) => a.crew_id));
  const toReset = ids.filter((id) => !onboard.has(id));
  if (toReset.length) await supabase.from("crew_profiles").update({ deployment_status: "onshore" }).in("id", toReset).eq("deployment_status", "in_transit");
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
    return { error: "The selected crew matrix has no manning lines to generate positions from." };
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
  const { data: inserted, error: insertError } = await supabase
    .from("mobilization_positions")
    .insert(rows)
    .select("id, crew_matrix_line_id, position_sequence");
  if (insertError) return { error: insertError.message };

  const anyClientApproval = lines.some((l) => l.client_approval_required);
  if (anyClientApproval !== req.client_approval_required) {
    await supabase.from("mobilization_requests").update({ client_approval_required: anyClientApproval }).eq("id", requestId);
  }

  // Pre-fill positions from whoever is already assigned to this matrix's
  // site on the Staffing Plan, matched to a line the same way the
  // Staffing Plan itself matches them (crew_assignments at this site, by
  // primary_job_role_id) — so a freshly generated mobilization doesn't
  // start every position "Open" when the matrix already shows real
  // people staffed. Deliberately a second pass of individual updates
  // (not folded into the bulk insert above): each fill goes through the
  // same reservation-lock path as a manual "Select candidate" so a crew
  // member already pending on another mobilization is silently skipped
  // (left Open here) instead of failing position generation outright.
  let prefilled = 0;
  if (req.offshore_site_id) {
    const lineJobRoleIds = Array.from(new Set(lines.map((l) => l.job_role_id as string)));
    const { data: siteAssignments } = await supabase
      .from("crew_assignments")
      .select("crew_id")
      .eq("org_id", access.orgId)
      .eq("offshore_site_id", req.offshore_site_id)
      .is("end_date", null);
    const assignedCrewIds = Array.from(new Set((siteAssignments ?? []).map((a) => a.crew_id as string)));

    if (assignedCrewIds.length && lineJobRoleIds.length) {
      const { data: assignedCrew } = await supabase
        .from("crew_profiles")
        .select("id, primary_job_role_id")
        .eq("org_id", access.orgId)
        .eq("employment_status", "active")
        .in("id", assignedCrewIds)
        .in("primary_job_role_id", lineJobRoleIds);

      // Candidates queued per role, shared (and drained via shift()) across
      // every line that shares that role — so two lines both requiring
      // "Cook" split the assigned Cooks between them instead of the same
      // person filling a slot on both.
      const candidatesByRole = new Map<string, string[]>();
      for (const c of assignedCrew ?? []) {
        const roleId = c.primary_job_role_id as string;
        const list = candidatesByRole.get(roleId) ?? [];
        list.push(c.id as string);
        candidatesByRole.set(roleId, list);
      }

      const positionsByLine = new Map<string, { id: string; position_sequence: number }[]>();
      for (const p of inserted ?? []) {
        const lineId = p.crew_matrix_line_id as string;
        const list = positionsByLine.get(lineId) ?? [];
        list.push({ id: p.id as string, position_sequence: p.position_sequence as number });
        positionsByLine.set(lineId, list);
      }

      for (const line of lines) {
        const positions = (positionsByLine.get(line.id as string) ?? []).sort((a, b) => a.position_sequence - b.position_sequence);
        const candidates = candidatesByRole.get(line.job_role_id as string) ?? [];
        for (const pos of positions) {
          const crewId = candidates.shift();
          if (!crewId) break;
          const { error: fillError } = await supabase
            .from("mobilization_positions")
            .update({ selected_crew_id: crewId, readiness_status: "selected", updated_by: userId })
            .eq("id", pos.id);
          if (!fillError) {
            prefilled++;
            await supabase.from("mobilization_position_history").insert({
              org_id: access.orgId,
              mobilization_position_id: pos.id,
              previous_crew_id: null,
              new_crew_id: crewId,
              reason: "Pre-filled from the crew matrix's Staffing Plan assignment",
              changed_by: userId,
            });
          }
          // Any error (most likely the one-active-reservation conflict if
          // this crew member is already pending elsewhere) just leaves
          // this position Open — never fails the overall generate step.
        }
      }
    }
  }

  revalidateMobilization(requestId);
  return { count: rows.length, prefilled };
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

// Candidate tiering is derived from the Phase 4 readiness engine's
// overall outcome rather than a second, parallel eligibility
// implementation — "not_ready" (an unwaived blocking check failed) maps
// to ineligible, "ready_with_warning"/"overridden" to partial, and a
// clean "ready" to eligible.
const OUTCOME_TO_TIER: Record<string, CandidateTier> = {
  not_ready: "ineligible",
  ready_with_warning: "partial",
  overridden: "partial",
  ready: "eligible",
};

export async function listCandidates(positionId: string): Promise<{ candidates: Candidate[] } | { error: string }> {
  const { supabase, access } = await requireView();
  const canViewCost = can(access, "crew.view_cost");

  const ctx = await loadPositionContext(supabase, access.orgId!, positionId);
  if ("error" in ctx) return ctx;

  // day_rate/currency are always selected here (this data never leaves
  // the server — Candidate strips them out below unless the caller
  // holds crew.view_cost) rather than built into a dynamic select
  // string, which supabase-js can't type-check.
  const CREW_FIELDS = "id, employee_code, full_name, availability_date, default_rotation_template_id, rotation_templates(name), day_rate, currency";

  const [primaryRes, secondaryLinkRes] = await Promise.all([
    supabase.from("crew_profiles").select(CREW_FIELDS).eq("org_id", access.orgId).eq("employment_status", "active").eq("primary_job_role_id", ctx.jobRoleId),
    supabase.from("crew_secondary_roles").select("crew_id").eq("job_role_id", ctx.jobRoleId),
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

  const evaluations = await evaluateCandidatesReadiness(supabase, ctx, crewIds);

  const candidates: Candidate[] = pool.map((c) => {
    const evaluation = evaluations[c.id];
    const checks = evaluation?.checks ?? [];
    const tier = evaluation ? OUTCOME_TO_TIER[evaluation.overallOutcome] ?? "partial" : "partial";
    const reasons = checks
      .filter((chk) => chk.result === "fail" || chk.result === "warning" || chk.result === "overridden")
      .map((chk) => chk.recommendedAction ?? chk.description);

    const vesselCheck = checks.find((chk) => chk.code === "VESSEL_ASSIGNMENT");
    const skillsCheck = checks.find((chk) => chk.code === "REQUIRED_SKILLS");
    const rotationRel = Array.isArray(c.rotation_templates) ? c.rotation_templates[0] : c.rotation_templates;

    return {
      id: c.id,
      employee_code: c.employee_code,
      full_name: c.full_name,
      tier,
      reasons,
      availability_date: c.availability_date,
      current_vessel: vesselCheck?.actualValue && vesselCheck.result === "warning" ? vesselCheck.actualValue : null,
      current_rotation: rotationRel?.name ?? null,
      skill_match: skillsCheck?.actualValue ?? "—",
      day_rate: canViewCost ? c.day_rate ?? null : null,
      currency: canViewCost ? c.currency ?? null : null,
    };
  });

  const order: Record<CandidateTier, number> = { eligible: 0, partial: 1, ineligible: 2 };
  candidates.sort((a, b) => order[a.tier] - order[b.tier] || a.full_name.localeCompare(b.full_name));

  return { candidates };
}

export type StaffingProposal = {
  positionId: string;
  positionSequence: number;
  jobRoleId: string;
  jobRoleName: string;
  crewId: string | null;
  crewName: string | null;
  employeeCode: string | null;
  tier: CandidateTier | null;
  reasons: string[];
  note: string | null;
};

// "Propose staffing" — runs the exact same Phase 3/4 candidate + readiness
// engine used by "Select candidate" (listCandidates) on every open
// position at once, and greedily proposes one name per slot: eligible
// tier preferred over partial, ties broken by whoever has been free
// longest (earliest availability_date) for a fairer rotation spread, and
// the same person is never proposed twice in one batch — the DB
// reservation lock only prevents that once a proposal is actually
// applied via selectCandidate, so this dedupes ahead of time rather than
// proposing something that would fail on apply. No model call happens
// here — "propose" is the same deterministic engine, just batched and
// ranked — and nothing is written until the caller confirms specific
// proposals via applyStaffingProposals, matching the "AI proposes,
// people approve" principle already used for AI-assisted crew matrices
// (Phase 9).
export async function proposeStaffing(requestId: string): Promise<{ proposals: StaffingProposal[] } | { error: string }> {
  const { supabase } = await requireManage();
  await assertNotTerminal(supabase, requestId);

  const { data: positions, error } = await supabase
    .from("mobilization_positions")
    .select("id, position_sequence, job_role_id, job_roles(name)")
    .eq("mobilization_request_id", requestId)
    .eq("final_status", "pending")
    .is("selected_crew_id", null)
    .order("position_sequence", { ascending: true });
  if (error) return { error: error.message };
  if (!positions || positions.length === 0) return { proposals: [] };

  const usedCrewIds = new Set<string>();
  const proposals: StaffingProposal[] = [];
  const byAvailability = (a: Candidate, b: Candidate) => (a.availability_date ?? "").localeCompare(b.availability_date ?? "") || a.full_name.localeCompare(b.full_name);

  for (const p of positions) {
    const roleRel = Array.isArray(p.job_roles) ? p.job_roles[0] : p.job_roles;
    const jobRoleName = (roleRel as { name?: string } | null)?.name ?? "—";
    const base = { positionId: p.id as string, positionSequence: p.position_sequence as number, jobRoleId: p.job_role_id as string, jobRoleName };

    const result = await listCandidates(p.id as string);
    if ("error" in result) {
      proposals.push({ ...base, crewId: null, crewName: null, employeeCode: null, tier: null, reasons: [], note: result.error });
      continue;
    }

    const pool = result.candidates.filter((c) => !usedCrewIds.has(c.id) && c.tier !== "ineligible");
    const eligible = pool.filter((c) => c.tier === "eligible").sort(byAvailability);
    const partial = pool.filter((c) => c.tier === "partial").sort(byAvailability);
    const pick = eligible[0] ?? partial[0];

    if (!pick) {
      proposals.push({
        ...base,
        crewId: null,
        crewName: null,
        employeeCode: null,
        tier: null,
        reasons: [],
        note: "No eligible or partial candidate available — every match is either ineligible or already proposed for another slot.",
      });
      continue;
    }

    usedCrewIds.add(pick.id);
    proposals.push({
      ...base,
      crewId: pick.id,
      crewName: pick.full_name,
      employeeCode: pick.employee_code,
      tier: pick.tier,
      reasons: pick.reasons,
      note: pick.tier === "partial" ? "Best available match has warnings below — review before confirming." : null,
    });
  }

  return { proposals };
}

// Confirms a subset of the proposals from proposeStaffing by reserving
// each one through the normal selectCandidate path — same reservation
// lock, same audit trail, nothing bypassed. Applied one at a time so an
// early failure (e.g. someone else reserved the same person in the
// meantime) doesn't abort the rest of the batch.
export async function applyStaffingProposals(
  requestId: string,
  selections: { positionId: string; crewId: string }[]
): Promise<{ applied: string[]; failed: { positionId: string; error: string }[] }> {
  const applied: string[] = [];
  const failed: { positionId: string; error: string }[] = [];
  for (const sel of selections) {
    const res = await selectCandidate(sel.positionId, requestId, sel.crewId);
    if (res?.error) failed.push({ positionId: sel.positionId, error: res.error });
    else applied.push(sel.positionId);
  }
  revalidateMobilization(requestId);
  return { applied, failed };
}

// Live per-check readiness for the position's currently selected
// candidate — what the position detail UI uses to explain exactly why
// a person is/isn't ready (Phase 4 acceptance criteria), and what
// feeds the "which requirement failed" picker when requesting a
// waiver. Recomputed on demand rather than read from the last
// snapshot, since master data (documents, skills, assignments) can
// change between snapshot points.
export async function getPositionReadiness(positionId: string) {
  const { supabase, access } = await requireView();
  const ctx = await loadPositionContext(supabase, access.orgId!, positionId);
  if ("error" in ctx) return ctx;
  const { data: position, error: positionError } = await supabase.from("mobilization_positions").select("selected_crew_id").eq("id", positionId).single();
  if (positionError || !position) return { error: "Could not find that position." };
  if (!position.selected_crew_id) return { error: "No candidate is selected for this position yet." };
  const evaluation = await evaluateCandidateReadiness(supabase, ctx, position.selected_crew_id);
  if ("error" in evaluation) return evaluation;
  return { evaluation };
}

export async function listWaiversForPosition(positionId: string) {
  const { supabase, access } = await requireView();
  const { data, error } = await supabase
    .from("compliance_waivers")
    .select("id, check_code, requirement_description, justification, attachment_url, status, requested_by, requested_at, decided_by, decided_at, decision_note, expires_at")
    .eq("mobilization_position_id", positionId)
    .order("requested_at", { ascending: false });
  if (error) return { error: error.message };

  const userIds = Array.from(new Set((data ?? []).flatMap((w) => [w.requested_by, w.decided_by]).filter((id): id is string => !!id)));
  const nameById: Record<string, string> = {};
  if (userIds.length) {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name").eq("org_id", access.orgId).in("id", userIds);
    for (const p of profiles ?? []) nameById[p.id] = p.full_name;
  }

  const waivers = (data ?? []).map((w) => ({
    ...w,
    requested_by_name: w.requested_by ? nameById[w.requested_by] ?? "—" : "—",
    decided_by_name: w.decided_by ? nameById[w.decided_by] ?? "—" : null,
  }));
  return { waivers };
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
  const { data: before } = await supabase.from("mobilization_positions").select("selected_crew_id").eq("id", positionId).single();
  const { error } = await supabase
    .from("mobilization_positions")
    .update({ final_status: "vacant", updated_by: userId })
    .eq("id", positionId);
  if (error) return { error: error.message };
  await resetTransitStatus(supabase, [before?.selected_crew_id ?? null]);
  await postSystemComment(supabase, access.orgId, requestId, `Position marked vacant — ${reason.trim()}`);
  revalidateMobilization(requestId);
  return {};
}

// Phase 6: boarding confirmation is a captured event (boarding_confirmations)
// and the ONLY thing that creates an active crew_assignment from a
// mobilization. It no longer auto-closes a crew member's previous
// assignment — per the Phase 6 controls an assignment ends only on an
// actual sign-off confirmation, so boarding refuses if they're still
// active elsewhere.
export async function confirmBoarding(positionId: string, requestId: string, formData: FormData) {
  const { supabase, access, userId } = await requireManage();
  const req = await getRequest(supabase, requestId);
  if (!["ready_to_mobilize", "in_transit"].includes(req.status)) {
    return { error: "Boarding can only be confirmed once the request is ready to mobilize or in transit." };
  }
  const { data: position, error: fetchError } = await supabase
    .from("mobilization_positions")
    .select("selected_crew_id, required_onboard_date, final_status, crew_matrix_line_id, reliever_for_crew_id")
    .eq("id", positionId)
    .single();
  if (fetchError || !position) return { error: "Could not find that position." };
  if (!position.selected_crew_id) return { error: "Select a candidate before confirming boarding." };
  if (position.final_status === "filled") return { error: "This position is already marked as boarded." };

  const actualOnboardAt = str(formData, "actualOnboardAt");
  if (!actualOnboardAt) return { error: "Actual onboard date/time is required." };
  const actualOnboardDate = actualOnboardAt.slice(0, 10);

  // Control: no two simultaneous active vessel assignments — and no
  // silent close-out either. The previous tour must be signed off first.
  const { data: stillActive } = await supabase
    .from("crew_assignments")
    .select("id, offshore_sites(name)")
    .eq("crew_id", position.selected_crew_id)
    .is("end_date", null)
    .limit(1);
  if (stillActive && stillActive.length > 0) {
    const site = (Array.isArray(stillActive[0].offshore_sites) ? stillActive[0].offshore_sites[0] : stillActive[0].offshore_sites) as { name?: string } | null;
    return { error: `This crew member is still active on ${site?.name ?? "another vessel"} — record their sign-off under Rotations before confirming boarding here.` };
  }

  // Last gate before an active crew_assignment is created — evaluate
  // this one position's readiness right now (not the stale value from
  // the last snapshot) and block if anything unwaived is still blocking.
  const ctx = await loadPositionContext(supabase, access.orgId!, positionId);
  if (!("error" in ctx)) {
    const evaluation = await evaluateCandidateReadiness(supabase, ctx, position.selected_crew_id);
    if (!("error" in evaluation) && evaluation.overallOutcome === "not_ready") {
      const failing = evaluation.checks.filter((c) => c.blocking && c.result === "fail").map((c) => c.description);
      return { error: `This crew member isn't ready to board: ${failing.join("; ")}. Resolve these or request a compliance waiver first.` };
    }
  }

  // Rotation: the matrix line's template, else the crew member's own default.
  let rotationTemplateId: string | null = null;
  if (position.crew_matrix_line_id) {
    const { data: line } = await supabase.from("crew_matrix_lines").select("rotation_template_id").eq("id", position.crew_matrix_line_id).single();
    rotationTemplateId = line?.rotation_template_id ?? null;
  }
  if (!rotationTemplateId) {
    const { data: crew } = await supabase.from("crew_profiles").select("default_rotation_template_id").eq("id", position.selected_crew_id).single();
    rotationTemplateId = crew?.default_rotation_template_id ?? null;
  }
  let plannedEndDate: string | null = null;
  if (rotationTemplateId) {
    const { data: rot } = await supabase.from("rotation_templates").select("days_on").eq("id", rotationTemplateId).single();
    if (rot?.days_on) {
      const d = new Date(actualOnboardDate + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + rot.days_on);
      plannedEndDate = d.toISOString().slice(0, 10);
    }
  }

  const { data: boarding, error: boardingError } = await supabase
    .from("boarding_confirmations")
    .insert({
      org_id: req.org_id,
      mobilization_request_id: requestId,
      mobilization_position_id: positionId,
      crew_id: position.selected_crew_id,
      offshore_site_id: req.offshore_site_id,
      actual_departure_at: optStr(formData, "actualDepartureAt"),
      actual_arrival_at: optStr(formData, "actualArrivalAt"),
      actual_onboard_at: actualOnboardAt,
      confirmed_by: userId,
      vessel_acknowledged: formData.get("vesselAcknowledged") === "on",
      vessel_acknowledged_by: optStr(formData, "vesselAcknowledgedBy"),
      boarding_reference: optStr(formData, "boardingReference"),
      remarks: optStr(formData, "remarks"),
      supporting_document_url: optStr(formData, "supportingDocumentUrl"),
      join_method: optStr(formData, "joinMethod"),
    })
    .select("id")
    .single();
  if (boardingError) return { error: boardingError.message };

  const { count: priorTours } = await supabase
    .from("crew_assignments")
    .select("id", { count: "exact", head: true })
    .eq("crew_id", position.selected_crew_id)
    .eq("offshore_site_id", req.offshore_site_id);
  const cycleRaw = str(formData, "rotationCycleNumber");
  const rotationCycleNumber = cycleRaw ? Number(cycleRaw) : (priorTours ?? 0) + 1;

  const { data: assignment, error: assignError } = await supabase
    .from("crew_assignments")
    .insert({
      org_id: req.org_id,
      crew_id: position.selected_crew_id,
      offshore_site_id: req.offshore_site_id,
      project_id: req.project_id,
      mobilization_request_id: requestId,
      mobilization_position_id: positionId,
      rotation_template_id: rotationTemplateId,
      start_date: actualOnboardDate,
      planned_start_date: position.required_onboard_date ?? req.required_onboard_date,
      planned_end_date: plannedEndDate,
      actual_start_date: actualOnboardDate,
      assignment_status: "active",
      shift: optStr(formData, "shift"),
      rotation_cycle_number: Number.isFinite(rotationCycleNumber) ? rotationCycleNumber : null,
      boarding_confirmation_id: boarding?.id,
      notes: `Boarded via mobilization ${req.mobilization_number ?? requestId}`,
      created_by: userId,
      updated_by: userId,
    })
    .select("id")
    .single();
  if (assignError) {
    if (assignError.message.includes("crew_assignments_one_active_idx")) {
      return { error: "This crew member already has an active vessel assignment — record their sign-off first." };
    }
    return { error: assignError.message };
  }

  // Reliever traceability: if this position relieves someone, link the
  // boarded crew member as reliever on the relieved person's active tour.
  if (position.reliever_for_crew_id) {
    await supabase
      .from("crew_assignments")
      .update({ reliever_crew_id: position.selected_crew_id, updated_by: userId })
      .eq("crew_id", position.reliever_for_crew_id)
      .is("end_date", null);
  }

  await supabase.from("crew_profiles").update({ deployment_status: "onboard" }).eq("id", position.selected_crew_id);

  const { error } = await supabase
    .from("mobilization_positions")
    .update({ final_status: "filled", readiness_status: "boarded", updated_by: userId })
    .eq("id", positionId);
  if (error) return { error: error.message };

  // Phase 4 snapshot trigger 4/4: "boarding confirmed" — re-evaluate
  // fresh (readiness_status/final_status just changed) rather than
  // reusing the evaluation computed above for the gate.
  if (!("error" in ctx)) {
    const finalEvaluation = await evaluateCandidateReadiness(supabase, ctx, position.selected_crew_id);
    if (!("error" in finalEvaluation)) {
      await writeReadinessSnapshot(supabase, ctx, "boarding_confirmed", finalEvaluation, userId);
    }
  }

  revalidateMobilization(requestId);
  revalidatePath("/rotations");
  revalidatePath("/crew/roster");
  return { assignmentId: assignment?.id };
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
  const { supabase, access, userId } = await requireComplianceReview();
  const req = await getRequest(supabase, id);
  if (req.status !== "compliance_review") return { error: `This request is ${req.status.replace(/_/g, " ")}, not in compliance review.` };

  const { count: unresolvedCount } = await supabase
    .from("mobilization_positions")
    .select("id", { count: "exact", head: true })
    .eq("mobilization_request_id", id)
    .in("readiness_status", ["open", "compliance_issue"]);

  const { error } = await supabase.from("mobilization_requests").update({ status: "internal_approval", updated_by: userId }).eq("id", id);
  if (error) return { error: error.message };

  // Phase 4 snapshot trigger 1/4: "sent for internal approval". This
  // stage stays a soft warning rather than a hard block — the whole
  // point of internal approval is to catch and work through readiness
  // gaps, so blocking here would be premature; approveInternal below is
  // where blocking checks actually stop the request.
  await snapshotSelectedPositions(supabase, access.orgId!, id, "internal_approval_sent", userId);

  revalidateMobilization(id);
  return unresolvedCount ? { warning: `${unresolvedCount} position(s) are still unselected or flagged with a compliance issue.` } : {};
}

export async function approveInternal(id: string, comment?: string) {
  const { supabase, access, userId } = await requireApprove();
  const req = await getRequest(supabase, id);
  if (req.status !== "internal_approval") return { error: `This request is ${req.status.replace(/_/g, " ")}, not pending internal approval.` };

  // Phase 4 acceptance criteria: blocking checks must prevent final
  // approval. Internal approval is the first real "approval" action, so
  // it's gated here — a position with an unwaived blocking failure can't
  // be approved past this point.
  const blocked = await checkBlockingReadiness(supabase, access.orgId!, id);
  if (blocked) return { error: blocked };

  const nextStatus = req.client_approval_required ? "client_approval" : "travel_arrangement";
  const update: Record<string, unknown> = { status: nextStatus, updated_by: userId };
  if (nextStatus === "travel_arrangement") {
    update.approved_by = userId;
    update.approved_at = new Date().toISOString();
  }
  const { error } = await supabase.from("mobilization_requests").update(update).eq("id", id);
  if (error) return { error: error.message };
  if (comment?.trim()) await postSystemComment(supabase, access.orgId, id, `Internal approval — ${comment.trim()}`);

  // Phase 4 snapshot trigger 2/4: "sent to client" — only fires when
  // this approval actually moves the request into the client-approval
  // stage. When no client approval is required, the next relevant
  // snapshot trigger is "marked ready to mobilize" (markTravelArranged).
  if (nextStatus === "client_approval") {
    await snapshotSelectedPositions(supabase, access.orgId!, id, "client_approval_sent", userId);
  }

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

  const blocked = await checkBlockingReadiness(supabase, access.orgId!, id);
  if (blocked) return { error: blocked };

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
  const { supabase, access, userId } = await requireManage();
  const req = await getRequest(supabase, id);
  if (req.status !== "travel_arrangement") return { error: `This request is ${req.status.replace(/_/g, " ")}, not in travel arrangement.` };

  const blocked = await checkBlockingReadiness(supabase, access.orgId!, id);
  if (blocked) return { error: blocked };

  const { error } = await supabase.from("mobilization_requests").update({ status: "ready_to_mobilize", updated_by: userId }).eq("id", id);
  if (error) return { error: error.message };

  // Phase 4 snapshot trigger 3/4: "marked ready to mobilize".
  await snapshotSelectedPositions(supabase, access.orgId!, id, "ready_to_mobilize", userId);

  revalidateMobilization(id);
  return {};
}

export async function markInTransit(id: string) {
  const { supabase, userId } = await requireManage();
  const req = await getRequest(supabase, id);
  if (req.status !== "ready_to_mobilize") return { error: `This request is ${req.status.replace(/_/g, " ")}, not ready to mobilize.` };
  const { error } = await supabase.from("mobilization_requests").update({ status: "in_transit", updated_by: userId }).eq("id", id);
  if (error) return { error: error.message };

  // Phase 6: everyone selected on a still-pending position is now travelling.
  const { data: travelling } = await supabase
    .from("mobilization_positions")
    .select("selected_crew_id")
    .eq("mobilization_request_id", id)
    .eq("final_status", "pending")
    .not("selected_crew_id", "is", null);
  const travellingIds = (travelling ?? []).map((p) => p.selected_crew_id as string);
  if (travellingIds.length) {
    await supabase.from("crew_profiles").update({ deployment_status: "in_transit" }).in("id", travellingIds).eq("deployment_status", "onshore");
  }

  revalidateMobilization(id);
  revalidatePath("/rotations");
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
  const { data: pendingBefore } = await supabase.from("mobilization_positions").select("selected_crew_id").eq("mobilization_request_id", id).eq("final_status", "pending");
  await supabase.from("mobilization_positions").update({ final_status: "cancelled", updated_by: userId }).eq("mobilization_request_id", id).eq("final_status", "pending");
  await resetTransitStatus(supabase, (pendingBefore ?? []).map((p) => p.selected_crew_id));

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

/* ================= Phase 12: mobilization tracks & checklist ================= */

// Assigns a track (a client's configured onboarding pathway — e.g. "New
// Joiner" vs "Returning Crew", entirely admin-defined, see
// tracks-actions.ts) to a position, and instantiates a COPY of that
// track's template checklist items for this position. Copying rather
// than referencing the template live means editing a client's template
// later never silently changes a checklist already in progress for
// someone currently mobilizing. Deliberately one-way: once a track is
// set it can't be changed here, since that would mean deciding what to
// do with any checklist progress already made against the old track.
export async function setPositionTrack(positionId: string, requestId: string, trackId: string) {
  const { supabase, access, userId } = await requireManage();
  await assertNotTerminal(supabase, requestId);

  const { data: position, error: posErr } = await supabase
    .from("mobilization_positions")
    .select("id, mobilization_track_id")
    .eq("id", positionId)
    .single();
  if (posErr || !position) return { error: "Could not find that position." };
  if (position.mobilization_track_id) return { error: "This position already has a track assigned." };

  const { data: track, error: trackErr } = await supabase.from("mobilization_tracks").select("id").eq("id", trackId).eq("org_id", access.orgId).single();
  if (trackErr || !track) return { error: "Could not find that track." };

  const { data: reqRow, error: reqErr } = await supabase.from("mobilization_requests").select("created_at, required_onboard_date").eq("id", requestId).single();
  if (reqErr || !reqRow) return { error: "Could not find that mobilization request." };

  const { data: templateItems, error: itemsErr } = await supabase
    .from("mobilization_checklist_items")
    .select("id, sequence, title, description, is_parallel, due_basis, due_offset_days, due_relative_item_id, linked_document_type_id")
    .eq("track_id", trackId)
    .order("sequence", { ascending: true });
  if (itemsErr) return { error: itemsErr.message };

  const { error: assignError } = await supabase.from("mobilization_positions").update({ mobilization_track_id: trackId, updated_by: userId }).eq("id", positionId);
  if (assignError) return { error: assignError.message };

  if (!templateItems || templateItems.length === 0) {
    // Track has no steps configured yet — assigning it is still valid,
    // there's just nothing to instantiate.
    revalidateMobilization(requestId);
    return { count: 0 };
  }

  const requestCreatedDate = (reqRow.created_at as string).slice(0, 10);
  const requiredOnboardDate = reqRow.required_onboard_date as string | null;
  const addDays = (dateStr: string, days: number) => {
    const d = new Date(dateStr + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  // Pre-generate instance ids so due_relative_item_id can point at
  // another INSTANCE row (not the template item) within the same insert.
  const idByTemplateId = new Map<string, string>();
  for (const item of templateItems) idByTemplateId.set(item.id as string, crypto.randomUUID());

  const rows = templateItems.map((item) => {
    const basis = item.due_basis as string;
    let dueDate: string | null = null;
    if (basis === "request_created") dueDate = addDays(requestCreatedDate, item.due_offset_days as number);
    else if (basis === "required_onboard_date" && requiredOnboardDate) dueDate = addDays(requiredOnboardDate, item.due_offset_days as number);
    // relative_to_item stays null until the item it depends on is marked done.
    return {
      id: idByTemplateId.get(item.id as string),
      org_id: access.orgId,
      mobilization_position_id: positionId,
      source_item_id: item.id,
      sequence: item.sequence,
      title: item.title,
      description: item.description,
      is_parallel: item.is_parallel,
      due_basis: basis,
      due_offset_days: item.due_offset_days,
      due_relative_item_id: item.due_relative_item_id ? idByTemplateId.get(item.due_relative_item_id as string) ?? null : null,
      due_date: dueDate,
      linked_document_type_id: item.linked_document_type_id,
      updated_by: userId,
    };
  });

  const { error: insertErr } = await supabase.from("mobilization_position_checklist_items").insert(rows);
  if (insertErr) return { error: insertErr.message };

  revalidateMobilization(requestId);
  return { count: rows.length };
}

// Marking a step "done" resolves the due date of any sibling step (same
// position) whose due date is relative to this one finishing — this is
// what reproduces "10 days after the exam step" without a fixed enum of
// named business milestones anywhere in the schema.
export async function updateChecklistItemStatus(itemId: string, requestId: string, status: "pending" | "in_progress" | "done" | "blocked") {
  const { supabase, access, userId } = await requireManage();

  const { data: item, error: itemErr } = await supabase
    .from("mobilization_position_checklist_items")
    .select("id, mobilization_position_id")
    .eq("id", itemId)
    .eq("org_id", access.orgId)
    .single();
  if (itemErr || !item) return { error: "Could not find that checklist item." };

  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from("mobilization_position_checklist_items")
    .update({
      status,
      completed_at: status === "done" ? nowIso : null,
      completed_by: status === "done" ? userId : null,
      updated_by: userId,
    })
    .eq("id", itemId);
  if (error) return { error: error.message };

  if (status === "done") {
    const { data: dependents } = await supabase
      .from("mobilization_position_checklist_items")
      .select("id, due_offset_days")
      .eq("mobilization_position_id", item.mobilization_position_id)
      .eq("due_relative_item_id", itemId)
      .eq("due_basis", "relative_to_item");
    const completedDate = nowIso.slice(0, 10);
    for (const dep of dependents ?? []) {
      const d = new Date(completedDate + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + (dep.due_offset_days as number));
      await supabase.from("mobilization_position_checklist_items").update({ due_date: d.toISOString().slice(0, 10), updated_by: userId }).eq("id", dep.id);
    }
  }

  revalidateMobilization(requestId);
  return {};
}
