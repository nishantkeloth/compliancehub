"use server";

// Phase 17 (revised) — Roster Change Requests: the mandatory-reason audit
// trail behind every assign/replace/unassign made while composing a NEW
// VERSION of a crew matrix. See
// supabase/migrations/0021_phase17_roster_change_requests.sql for the
// table design — this file is the mechanics.
//
//  - requestRosterChange: records the change and stages it — see "staged,
//    not applied" below. One call, no separate approval step: the client
//    asked for exactly this ("you just replace this in the new version,
//    and once all the changes are done you click Submit for approval from
//    the top again") — the review that matters is the existing whole-
//    matrix Draft -> Submitted -> Internal approval -> Client approval
//    pipeline (submitForApproval etc. in app/crew/matrices/actions.ts),
//    not a second approval on every individual crew swap. Only allowed
//    while the matrix is still a NEW VERSION'S draft (status draft,
//    version_number > 1, i.e. created via Create New Version) — once it's
//    submitted, no further crew changes until it's returned to draft or
//    goes live. Gated on crew.manage, same as a direct assign/unassign.
//  - applyApprovedRosterChanges: called once, from activateCrewMatrix
//    (app/crew/matrices/actions.ts), at the moment a new-version matrix
//    actually goes live. Applies every staged (status approved, not yet
//    applied) request for that matrix to the real crew_assignments rows,
//    in the same insert/soft-close shapes assignCandidateToMatrix /
//    unassignCandidateFromMatrix already use, stamping whichever row(s)
//    it touches with roster_change_request_id so the timeline can trace
//    the change back to its request.
//  - decideRosterChangeRequest: kept for a still-pending_approval row
//    (none are created by the current flow, but this stays as the one
//    place that transition is ever handled) — approve/reject, gated on
//    crew.matrix.approve_internal.
//  - cancelRosterChangeRequest: lets the original requester withdraw a
//    still-undecided/unapplied change — e.g. to undo a staged replace
//    made in error while still composing the new version.
//  - listRosterChangeRequests: every request for a matrix (any status),
//    newest first, with crew names resolved — feeds the expanding
//    timeline and (via page.tsx) the draft's own Staffing Plan preview.
//
// Staged, not applied on request: crew_assignments rows aren't scoped to
// a specific crew_matrix or version at all (crew_id + offshore_site_id
// only — see assignCandidateToMatrix in staffing-actions.ts). That means
// every version of a site's matrix shares the exact same live roster, so
// writing to crew_assignments the moment someone clicks Replace on a
// still-unsubmitted new-version draft would move the still-Active OLD
// version's Assigned tab too — before the new version has been reviewed
// at all. So requestRosterChange only ever records the change (status
// "approved" — self-recorded, there's no separate decision step in this
// flow) and never touches crew_assignments. app/crew/matrices/[id]/page.tsx
// overlays every staged, unapplied request for a matrix onto its own
// Staffing Plan preview (Assigned/Available), so the draft always shows
// what it would look like if activated as-is, all the way through
// internal/client review — but the real, shared crew_assignments rows
// only move once, at Activate (applyApprovedRosterChanges), together with
// whatever else that activation does (superseding the old version). The
// Active matrix itself is read-only (no Request Change, no direct
// assign/unassign at all) — see isLiveMatrix in staffing-plan.tsx.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveAccess, can } from "@/lib/rbac";
import { REASON_CODES, type ChangeType } from "./roster-change-shared";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function requirePermission(permission: string, message: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, permission)) throw new Error(message);
  if (!access.orgId) throw new Error("No company context.");
  return { supabase, access, userId: user.id, userEmail: user.email ?? null };
}

const revalidateMatrix = (crewMatrixId: string) => revalidatePath(`/crew/matrices/${crewMatrixId}`);

export async function requestRosterChange(input: {
  crewMatrixId: string;
  crewMatrixLineId?: string | null;
  changeType: ChangeType;
  outgoingCrewId?: string | null;
  incomingCrewId?: string | null;
  effectiveDate: string;
  reasonCode: string;
  reasonNotes?: string | null;
}) {
  const { supabase, access, userId } = await requirePermission("crew.manage", "You don't have permission to change crew on this matrix.");

  if (!DATE_RE.test(input.effectiveDate)) return { error: "Effective date is required." };
  if (!REASON_CODES.some((r) => r.value === input.reasonCode)) return { error: "Please choose a reason." };
  if (input.changeType !== "assign" && !input.outgoingCrewId) return { error: "Outgoing crew member is required for a replace or unassign." };
  if (input.changeType !== "unassign" && !input.incomingCrewId) return { error: "Incoming crew member is required for an assign or replace." };

  const { data: matrix, error: matrixErr } = await supabase
    .from("crew_matrices")
    .select("id, status, version_number")
    .eq("id", input.crewMatrixId)
    .eq("org_id", access.orgId)
    .single();
  if (matrixErr || !matrix) return { error: "Matrix not found." };
  if (matrix.status !== "draft") {
    return { error: "Crew changes can only be made while this new version is still a draft — return it to draft first, or wait for it to go live." };
  }
  if ((matrix.version_number ?? 1) <= 1) {
    return { error: "Roster change requests are only for a new version of the matrix (Create New Version first)." };
  }

  // Self-recorded: there's no separate approval step in this flow (see
  // this file's top comment) — status goes straight to "approved" so
  // applyApprovedRosterChanges picks it up at Activate, decided_by/at
  // just note that it was recorded, not that anyone else signed off.
  const { data: request, error: insertErr } = await supabase
    .from("roster_change_requests")
    .insert({
      org_id: access.orgId,
      crew_matrix_id: input.crewMatrixId,
      crew_matrix_line_id: input.crewMatrixLineId ?? null,
      change_type: input.changeType,
      outgoing_crew_id: input.outgoingCrewId ?? null,
      incoming_crew_id: input.incomingCrewId ?? null,
      effective_date: input.effectiveDate,
      reason_code: input.reasonCode,
      reason_notes: input.reasonNotes?.trim() || null,
      requested_by: userId,
      status: "approved",
      decided_by: userId,
      decided_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (insertErr || !request) return { error: insertErr?.message ?? "Could not record the change." };

  revalidateMatrix(input.crewMatrixId);
  return { requestId: request.id as string };
}

export async function cancelRosterChangeRequest(requestId: string) {
  const { supabase, access, userId } = await requirePermission("crew.manage", "You don't have permission to withdraw this request.");

  const { data: request, error: fetchErr } = await supabase
    .from("roster_change_requests")
    .select("id, org_id, crew_matrix_id, status, requested_by, applied_assignment_id")
    .eq("id", requestId)
    .single();
  if (fetchErr || !request || request.org_id !== access.orgId) return { error: "Request not found." };
  // A request from the current flow is self-recorded straight to
  // "approved" and staged (see requestRosterChange) — it can still be
  // withdrawn right up until it's actually applied to crew_assignments
  // (Activate). "pending_approval" is kept here too in case one is ever
  // left in that state (decideRosterChangeRequest still exists for it).
  const withdrawable = request.status === "pending_approval" || (request.status === "approved" && !request.applied_assignment_id);
  if (!withdrawable) return { error: "This change can no longer be withdrawn." };
  if (request.requested_by !== userId && !can(access, "crew.matrix.approve_internal")) {
    return { error: "You can only withdraw a change you made yourself." };
  }

  const { error } = await supabase.from("roster_change_requests").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", requestId);
  if (error) return { error: error.message };

  revalidateMatrix(request.crew_matrix_id as string);
  return {};
}

export async function decideRosterChangeRequest(requestId: string, decision: "approved" | "rejected", comment?: string) {
  const { supabase, access, userId } = await requirePermission("crew.matrix.approve_internal", "You don't have permission to approve roster changes.");

  const { data: request, error: fetchErr } = await supabase
    .from("roster_change_requests")
    .select("*")
    .eq("id", requestId)
    .single();
  if (fetchErr || !request || request.org_id !== access.orgId) return { error: "Request not found." };
  if (request.status !== "pending_approval") return { error: "This request has already been decided." };

  // Approving no longer touches crew_assignments here — see this file's
  // top comment ("staged, not applied on approval"). It just records the
  // decision; applyApprovedRosterChanges (below) does the actual
  // crew_assignments write, once, when this matrix is Activated.
  const { error } = await supabase
    .from("roster_change_requests")
    .update({
      status: decision,
      decided_by: userId,
      decided_at: new Date().toISOString(),
      decision_comment: comment?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", requestId);
  if (error) return { error: error.message };

  revalidateMatrix(request.crew_matrix_id as string);
  return {};
}

// Called from activateCrewMatrix (app/crew/matrices/actions.ts) right
// after a new-version matrix's status flips to "active" — applies every
// approved-but-not-yet-applied roster change request for that matrix to
// the real, shared crew_assignments rows, in the same insert/soft-close
// shapes assignCandidateToMatrix / unassignCandidateFromMatrix use,
// stamping whichever row(s) it touches with roster_change_request_id.
// Deliberately takes the caller's own already-authenticated supabase
// client/access/userId rather than re-deriving them — this only ever runs
// as the last step of an activation that has already been permission-
// checked (crew.matrix.manage) and already committed the status change;
// re-authenticating here would just be a second, redundant check.
// Best-effort per request: one request failing (e.g. someone else already
// moved that crew member elsewhere in the meantime) is skipped, not
// thrown — it must never block or partially-undo the activation that
// already succeeded before this runs.
export async function applyApprovedRosterChanges(
  supabase: Awaited<ReturnType<typeof createClient>>,
  access: { orgId: string | null },
  userId: string,
  crewMatrixId: string
): Promise<{ applied: number; skipped: string[] }> {
  const { data: matrix } = await supabase.from("crew_matrices").select("id, offshore_site_id").eq("id", crewMatrixId).single();
  if (!matrix) return { applied: 0, skipped: [] };

  const { data: requests } = await supabase
    .from("roster_change_requests")
    .select("*")
    .eq("crew_matrix_id", crewMatrixId)
    .eq("status", "approved")
    .is("applied_assignment_id", null);

  let applied = 0;
  const skipped: string[] = [];

  for (const request of requests ?? []) {
    const effectiveDate = request.effective_date as string;
    let appliedAssignmentId: string | null = null;

    if (request.change_type === "unassign" || request.change_type === "replace") {
      const { data: assignment } = await supabase
        .from("crew_assignments")
        .select("id")
        .eq("crew_id", request.outgoing_crew_id)
        .is("end_date", null)
        .limit(1)
        .maybeSingle();
      if (!assignment) {
        skipped.push(request.id as string);
        continue;
      }
      await supabase
        .from("crew_assignments")
        .update({
          end_date: effectiveDate,
          planned_end_date: effectiveDate,
          assignment_status: "cancelled",
          roster_change_request_id: request.id,
          updated_by: userId,
        })
        .eq("id", assignment.id);
      await supabase.from("crew_profiles").update({ deployment_status: "onshore" }).eq("id", request.outgoing_crew_id);
      appliedAssignmentId = assignment.id as string;
    }

    if (request.change_type === "assign" || request.change_type === "replace") {
      const { data: stillActive } = await supabase.from("crew_assignments").select("id").eq("crew_id", request.incoming_crew_id).is("end_date", null).limit(1);
      if (stillActive && stillActive.length > 0) {
        skipped.push(request.id as string);
        continue;
      }
      const { data: newAssignment } = await supabase
        .from("crew_assignments")
        .insert({
          org_id: access.orgId,
          crew_id: request.incoming_crew_id,
          offshore_site_id: matrix.offshore_site_id,
          start_date: effectiveDate,
          planned_start_date: effectiveDate,
          actual_start_date: effectiveDate,
          assignment_status: "active",
          roster_change_request_id: request.id,
          notes: "Assigned when this crew matrix version was activated (approved roster change).",
          created_by: userId,
          updated_by: userId,
        })
        .select("id")
        .single();
      if (!newAssignment) {
        skipped.push(request.id as string);
        continue;
      }
      await supabase.from("crew_profiles").update({ deployment_status: "onboard" }).eq("id", request.incoming_crew_id);
      appliedAssignmentId = newAssignment.id as string;
    }

    await supabase
      .from("roster_change_requests")
      .update({ applied_assignment_id: appliedAssignmentId, updated_at: new Date().toISOString() })
      .eq("id", request.id);
    applied++;
  }

  return { applied, skipped };
}

// Phase 17 (timeline continuity) — accepts either one version's id (a
// single crew_matrix_id) or a whole matrix family's ids (every version's
// id, same matrix_number) so the expanding Roster Change History timeline
// (roster-timeline.tsx) can show every roster change ever recorded across
// every version, not just whichever one is currently open — matching this
// file's own "ever-growing ledger that never resets" design (see this
// file's top comment). crew_matrix_id is included in the select so the
// caller can label each row by which version it belongs to when it's
// showing more than one.
export async function listRosterChangeRequests(crewMatrixId: string | string[]) {
  const { supabase, access } = await requirePermission("crew.manage", "You don't have permission to view roster changes.");

  let query = supabase
    .from("roster_change_requests")
    .select(
      "id, crew_matrix_id, change_type, outgoing_crew_id, incoming_crew_id, effective_date, reason_code, reason_notes, status, requested_by, requested_at, decided_by, decided_at, decision_comment, applied_assignment_id, crew_matrix_line_id, " +
        "outgoing:crew_profiles!outgoing_crew_id(full_name), incoming:crew_profiles!incoming_crew_id(full_name)"
    )
    .eq("org_id", access.orgId);
  query = Array.isArray(crewMatrixId) ? query.in("crew_matrix_id", crewMatrixId) : query.eq("crew_matrix_id", crewMatrixId);
  const { data, error } = await query.order("requested_at", { ascending: false });
  if (error) return { error: error.message, requests: [] as any[] };
  return { requests: data ?? [] };
}
