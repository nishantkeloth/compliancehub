"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveAccess, can } from "@/lib/rbac";
import { loadAdhocContext, evaluateCandidateReadiness, type ReadinessEvaluation } from "@/lib/readiness";

type Supa = Awaited<ReturnType<typeof createClient>>;

async function requireAccess() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const access = await getEffectiveAccess(supabase, user.id);
  if (!access.orgId) throw new Error("No company context.");
  return { supabase, access, userId: user.id, orgId: access.orgId };
}

function str(formData: FormData, key: string) {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}
function optStr(formData: FormData, key: string) {
  const v = str(formData, key);
  return v || null;
}
function bool(formData: FormData, key: string) {
  return formData.get(key) === "on" || formData.get(key) === "true";
}

const revalidateAll = (crewId?: string, requestId?: string) => {
  revalidatePath("/rotations");
  revalidatePath("/crew/roster");
  revalidatePath("/readiness");
  if (crewId) revalidatePath(`/crew/profiles/${crewId}`);
  if (requestId) revalidatePath(`/mobilizations/${requestId}`);
};

async function getActiveAssignment(supabase: Supa, assignmentId: string) {
  const { data, error } = await supabase
    .from("crew_assignments")
    .select(
      "id, org_id, crew_id, offshore_site_id, project_id, mobilization_request_id, mobilization_position_id, rotation_template_id, start_date, end_date, planned_end_date, assignment_status, reliever_crew_id"
    )
    .eq("id", assignmentId)
    .single();
  if (error || !data) throw new Error("Could not find that assignment.");
  return data;
}

/* ================= Sign-off (demobilization) ================= */

// The ONLY thing that ends an active crew_assignment. A normal sign-off
// requires the demob checklist to be complete; an emergency sign-off
// (reason + mobilization.emergency_override) bypasses the checklist but
// is recorded as such.
export async function confirmSignoff(assignmentId: string, formData: FormData) {
  const { supabase, access, userId, orgId } = await requireAccess();
  const isEmergency = bool(formData, "isEmergency");
  if (!can(access, "mobilization.manage") && !(isEmergency && can(access, "mobilization.emergency_override"))) {
    return { error: "You don't have permission to record a sign-off." };
  }
  if (isEmergency && !can(access, "mobilization.emergency_override")) {
    return { error: "Emergency sign-off requires the emergency-override permission." };
  }

  const assignment = await getActiveAssignment(supabase, assignmentId);
  if (assignment.end_date) return { error: "This assignment is already signed off." };

  const actualSignoffAt = str(formData, "actualSignoffAt");
  if (!actualSignoffAt) return { error: "Actual sign-off date/time is required." };
  const emergencyReason = optStr(formData, "emergencyReason");
  if (isEmergency && !emergencyReason) return { error: "An emergency sign-off needs a reason." };

  const handoverCompleted = bool(formData, "handoverCompleted");
  const propertyReturned = bool(formData, "propertyReturned");
  const timesheetClosed = bool(formData, "timesheetClosed");
  const clearanceStatus = str(formData, "clearanceStatus") || "cleared";
  if (!["cleared", "pending", "flagged"].includes(clearanceStatus)) return { error: "Invalid clearance status." };

  if (!isEmergency) {
    const incomplete: string[] = [];
    if (!handoverCompleted) incomplete.push("handover not completed");
    if (!propertyReturned) incomplete.push("company property not returned");
    if (!timesheetClosed) incomplete.push("timesheet not closed");
    if (clearanceStatus === "flagged") incomplete.push("incident/disciplinary clearance is flagged");
    if (incomplete.length) {
      return { error: `Demobilization checklist incomplete: ${incomplete.join(", ")}. Complete these, or record an emergency sign-off with a reason.` };
    }
  }

  const ratingRaw = str(formData, "performanceRating");
  const performanceRating = ratingRaw ? Number(ratingRaw) : null;
  if (performanceRating != null && (!Number.isInteger(performanceRating) || performanceRating < 1 || performanceRating > 5)) {
    return { error: "Performance rating must be 1–5." };
  }
  const replacementCrewId = optStr(formData, "replacementCrewId");
  const returnToPoolDate = optStr(formData, "returnToPoolDate");

  const { data: signoff, error: signoffError } = await supabase
    .from("signoff_confirmations")
    .insert({
      org_id: orgId,
      crew_assignment_id: assignmentId,
      crew_id: assignment.crew_id,
      offshore_site_id: assignment.offshore_site_id,
      planned_signoff_date: assignment.planned_end_date,
      actual_signoff_at: actualSignoffAt,
      replacement_confirmed: bool(formData, "replacementConfirmed"),
      replacement_crew_id: replacementCrewId,
      handover_completed: handoverCompleted,
      handover_notes: optStr(formData, "handoverNotes"),
      return_travel_details: optStr(formData, "returnTravelDetails"),
      return_travel_departure_at: optStr(formData, "returnTravelDepartureAt"),
      return_travel_arrival_at: optStr(formData, "returnTravelArrivalAt"),
      property_returned: propertyReturned,
      timesheet_closed: timesheetClosed,
      clearance_status: clearanceStatus,
      clearance_notes: optStr(formData, "clearanceNotes"),
      performance_rating: performanceRating,
      performance_notes: optStr(formData, "performanceNotes"),
      return_to_pool_date: returnToPoolDate,
      is_emergency: isEmergency,
      emergency_reason: emergencyReason,
      authorized_by: isEmergency ? userId : null,
      confirmed_by: userId,
      remarks: optStr(formData, "remarks"),
    })
    .select("id")
    .single();
  if (signoffError) return { error: signoffError.message };

  const signoffDate = actualSignoffAt.slice(0, 10);
  const { error: closeError } = await supabase
    .from("crew_assignments")
    .update({
      end_date: signoffDate,
      actual_end_date: signoffDate,
      assignment_status: "signed_off",
      signoff_confirmation_id: signoff?.id,
      reliever_crew_id: replacementCrewId ?? assignment.reliever_crew_id,
      updated_by: userId,
    })
    .eq("id", assignmentId);
  if (closeError) return { error: closeError.message };

  // Crew status + availability update automatically.
  const crewUpdate: Record<string, unknown> = { deployment_status: "onshore" };
  if (returnToPoolDate) crewUpdate.availability_date = returnToPoolDate;
  await supabase.from("crew_profiles").update(crewUpdate).eq("id", assignment.crew_id);

  // Any approved crew change request on this assignment is now done.
  await supabase
    .from("crew_change_requests")
    .update({ status: "completed", updated_at: new Date().toISOString() })
    .eq("crew_assignment_id", assignmentId)
    .eq("status", "approved");

  revalidateAll(assignment.crew_id, assignment.mobilization_request_id ?? undefined);
  return {};
}

/* ================= Rotation extension ================= */

export async function extendRotation(assignmentId: string, formData: FormData) {
  const { supabase, access, userId, orgId } = await requireAccess();
  if (!can(access, "mobilization.manage")) return { error: "You don't have permission to extend a rotation." };
  const assignment = await getActiveAssignment(supabase, assignmentId);
  if (assignment.end_date) return { error: "This assignment is already signed off." };

  const newPlannedEndDate = str(formData, "newPlannedEndDate");
  const reason = str(formData, "reason");
  if (!newPlannedEndDate) return { error: "New planned end date is required." };
  if (!reason) return { error: "A reason is required to extend a rotation." };
  if (assignment.planned_end_date && newPlannedEndDate <= assignment.planned_end_date) {
    return { error: "The new planned end date must be after the current planned end date." };
  }

  const { error: extError } = await supabase.from("rotation_extensions").insert({
    org_id: orgId,
    crew_assignment_id: assignmentId,
    previous_planned_end_date: assignment.planned_end_date,
    new_planned_end_date: newPlannedEndDate,
    reason,
    created_by: userId,
  });
  if (extError) return { error: extError.message };

  const { error } = await supabase
    .from("crew_assignments")
    .update({ planned_end_date: newPlannedEndDate, assignment_status: "extended", updated_by: userId })
    .eq("id", assignmentId);
  if (error) return { error: error.message };

  revalidateAll(assignment.crew_id);
  return {};
}

/* ================= Crew change requests ================= */

async function relieverContext(supabase: Supa, orgId: string, assignment: Awaited<ReturnType<typeof getActiveAssignment>>, plannedChangeDate: string) {
  let jobRoleId: string | null = null;
  let crewMatrixLineId: string | null = null;
  if (assignment.mobilization_position_id) {
    const { data: position } = await supabase.from("mobilization_positions").select("job_role_id, crew_matrix_line_id").eq("id", assignment.mobilization_position_id).single();
    jobRoleId = position?.job_role_id ?? null;
    crewMatrixLineId = position?.crew_matrix_line_id ?? null;
  }
  if (!jobRoleId) {
    const { data: crew } = await supabase.from("crew_profiles").select("primary_job_role_id").eq("id", assignment.crew_id).single();
    jobRoleId = crew?.primary_job_role_id ?? null;
  }
  if (!jobRoleId) return null;
  return loadAdhocContext(supabase, orgId, { jobRoleId, effectiveOnboardDate: plannedChangeDate, crewMatrixLineId });
}

// Live readiness preview for a proposed reliever before the request is
// submitted — same engine as everything else.
export async function previewRelieverReadiness(assignmentId: string, relieverCrewId: string, plannedChangeDate: string): Promise<{ evaluation: ReadinessEvaluation } | { error: string }> {
  const { supabase, access, orgId } = await requireAccess();
  if (!can(access, "mobilization.view") && !can(access, "crew.view")) return { error: "No permission." };
  const assignment = await getActiveAssignment(supabase, assignmentId);
  const ctx = await relieverContext(supabase, orgId, assignment, plannedChangeDate || new Date().toISOString().slice(0, 10));
  if (!ctx) return { error: "The current crew member has no job role to evaluate a reliever against." };
  const evaluation = await evaluateCandidateReadiness(supabase, ctx, relieverCrewId);
  if ("error" in evaluation) return evaluation;
  return { evaluation };
}

export async function createCrewChangeRequest(formData: FormData) {
  const { supabase, access, userId, orgId } = await requireAccess();
  if (!can(access, "mobilization.manage")) return { error: "You don't have permission to request a crew change." };

  const assignmentId = str(formData, "assignmentId");
  const plannedChangeDate = str(formData, "plannedChangeDate");
  const reason = str(formData, "reason");
  if (!assignmentId) return { error: "Select the assignment being changed." };
  if (!plannedChangeDate) return { error: "Planned change date is required." };
  if (!reason) return { error: "A reason is required." };
  const proposedRelieverCrewId = optStr(formData, "proposedRelieverCrewId");

  const assignment = await getActiveAssignment(supabase, assignmentId);
  if (assignment.end_date) return { error: "That assignment is already signed off." };
  if (proposedRelieverCrewId === assignment.crew_id) return { error: "The reliever can't be the same person being relieved." };

  const { data: open } = await supabase
    .from("crew_change_requests")
    .select("id")
    .eq("crew_assignment_id", assignmentId)
    .in("status", ["pending_approval", "approved"])
    .limit(1);
  if (open && open.length) return { error: "There is already an open crew change request for this assignment." };

  let readinessOutcome: string | null = null;
  let readinessChecks: unknown = null;
  if (proposedRelieverCrewId) {
    const ctx = await relieverContext(supabase, orgId, assignment, plannedChangeDate);
    if (ctx) {
      const evaluation = await evaluateCandidateReadiness(supabase, ctx, proposedRelieverCrewId);
      if (!("error" in evaluation)) {
        readinessOutcome = evaluation.overallOutcome;
        readinessChecks = evaluation.checks;
      }
    }
  }

  const { data: created, error } = await supabase
    .from("crew_change_requests")
    .insert({
      org_id: orgId,
      crew_assignment_id: assignmentId,
      current_crew_id: assignment.crew_id,
      proposed_reliever_crew_id: proposedRelieverCrewId,
      offshore_site_id: assignment.offshore_site_id,
      reason,
      planned_change_date: plannedChangeDate,
      is_emergency: bool(formData, "isEmergency"),
      status: "pending_approval",
      reliever_readiness_outcome: readinessOutcome,
      reliever_readiness_checks: readinessChecks,
      requested_by: userId,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  revalidateAll(assignment.crew_id);
  return { id: created?.id };
}

// Approving a crew change creates the reliever's mobilization request
// (type replacement / rotation_change) from the same crew matrix the
// original tour came from, with a single position already pointing at
// the proposed reliever and marked as relieving the current crew member.
// The reliever then boards through the normal gated path — the crew
// change is only "completed" when the current crew member's sign-off is
// confirmed, never merely because a replacement was selected.
export async function decideCrewChangeRequest(id: string, approve: boolean, formData: FormData) {
  const { supabase, access, userId, orgId } = await requireAccess();
  if (!can(access, "mobilization.approve")) return { error: "You don't have permission to decide a crew change request." };

  const { data: ccr, error: fetchError } = await supabase
    .from("crew_change_requests")
    .select("id, status, crew_assignment_id, current_crew_id, proposed_reliever_crew_id, planned_change_date, is_emergency, reason")
    .eq("id", id)
    .single();
  if (fetchError || !ccr) return { error: "Could not find that crew change request." };
  if (ccr.status !== "pending_approval") return { error: `This request is already ${ccr.status.replace(/_/g, " ")}.` };

  const decisionNote = optStr(formData, "decisionNote");
  if (!approve) {
    if (!decisionNote) return { error: "A note is required when rejecting." };
    const { error } = await supabase
      .from("crew_change_requests")
      .update({ status: "rejected", decided_by: userId, decided_at: new Date().toISOString(), decision_note: decisionNote, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return { error: error.message };
    revalidateAll(ccr.current_crew_id);
    return {};
  }

  const assignment = await getActiveAssignment(supabase, ccr.crew_assignment_id);
  let mobilizationRequestId: string | null = null;
  let warning: string | undefined;

  if (assignment.mobilization_request_id && assignment.mobilization_position_id) {
    const { data: source } = await supabase
      .from("mobilization_requests")
      .select("crew_matrix_id, project_id, offshore_site_id, crew_change_location, travel_origin")
      .eq("id", assignment.mobilization_request_id)
      .single();
    const { data: sourcePosition } = await supabase
      .from("mobilization_positions")
      .select("job_role_id, crew_matrix_line_id, client_approval_status")
      .eq("id", assignment.mobilization_position_id)
      .single();

    if (source && sourcePosition) {
      const { data: code, error: codeError } = await supabase.rpc("next_number_range_code", { p_org_id: orgId, p_entity_type: "mobilization" });
      if (codeError) return { error: `Could not assign a mobilization number: ${codeError.message}` };

      const { data: newReq, error: reqError } = await supabase
        .from("mobilization_requests")
        .insert({
          org_id: orgId,
          mobilization_number: code,
          project_id: source.project_id,
          offshore_site_id: source.offshore_site_id,
          crew_matrix_id: source.crew_matrix_id,
          mobilization_type: ccr.is_emergency ? "replacement" : "rotation_change",
          required_onboard_date: ccr.planned_change_date,
          crew_change_location: source.crew_change_location,
          travel_origin: source.travel_origin,
          special_instructions: `Crew change for ${ccr.current_crew_id} — ${ccr.reason}`,
          priority: ccr.is_emergency ? "emergency" : "normal",
          client_approval_required: sourcePosition.client_approval_status !== "not_required",
          requested_by: userId,
          status: "planning",
          created_by: userId,
          updated_by: userId,
        })
        .select("id")
        .single();
      if (reqError) return { error: reqError.message };
      mobilizationRequestId = newReq?.id ?? null;

      const { error: posError } = await supabase.from("mobilization_positions").insert({
        org_id: orgId,
        mobilization_request_id: mobilizationRequestId,
        crew_matrix_line_id: sourcePosition.crew_matrix_line_id,
        job_role_id: sourcePosition.job_role_id,
        position_sequence: 1,
        required_onboard_date: ccr.planned_change_date,
        selected_crew_id: ccr.proposed_reliever_crew_id,
        reliever_for_crew_id: ccr.current_crew_id,
        readiness_status: ccr.proposed_reliever_crew_id ? "selected" : "open",
        client_approval_status: sourcePosition.client_approval_status === "not_required" ? "not_required" : "pending",
        created_by: userId,
        updated_by: userId,
      });
      if (posError) {
        if (posError.message.includes("mobilization_positions_one_active_reservation")) {
          return { error: "The proposed reliever is already reserved on another pending mobilization — choose someone else or clear that reservation first." };
        }
        return { error: posError.message };
      }
    }
  } else {
    warning = "This assignment didn't originate from a mobilization, so no reliever mobilization was created — plan the reliever's mobilization manually.";
  }

  const { error } = await supabase
    .from("crew_change_requests")
    .update({
      status: "approved",
      decided_by: userId,
      decided_at: new Date().toISOString(),
      decision_note: decisionNote,
      mobilization_request_id: mobilizationRequestId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidateAll(ccr.current_crew_id, mobilizationRequestId ?? undefined);
  revalidatePath("/mobilizations");
  return warning ? { warning, mobilizationRequestId } : { mobilizationRequestId };
}

export async function cancelCrewChangeRequest(id: string) {
  const { supabase, access, userId } = await requireAccess();
  if (!can(access, "mobilization.manage")) return { error: "You don't have permission to cancel a crew change request." };
  const { data: ccr } = await supabase.from("crew_change_requests").select("status, current_crew_id").eq("id", id).single();
  if (!ccr) return { error: "Could not find that crew change request." };
  if (!["pending_approval", "approved"].includes(ccr.status)) return { error: `This request is already ${ccr.status.replace(/_/g, " ")}.` };
  const { error } = await supabase
    .from("crew_change_requests")
    .update({ status: "cancelled", decided_by: userId, decided_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidateAll(ccr.current_crew_id);
  return {};
}
