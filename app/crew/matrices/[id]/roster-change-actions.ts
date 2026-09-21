"use server";

// Phase 17 — Roster Change Requests: the approval step + audit trail
// behind every assign/replace/unassign on a crew matrix that's already
// Active and has been sent to the client at least once. See
// supabase/migrations/0021_phase17_roster_change_requests.sql for the
// full design rationale (why this is a new table rather than reusing
// Phase 6's crew_change_requests, why the permissions are what they
// are, etc.) — this file is the mechanics.
//
//  - requestRosterChange: raises a pending_approval row and emails
//    everyone in the org who holds crew.matrix.approve_internal, with a
//    deep link back into the matrix (an ordinary authenticated
//    ComplianceHub link, not a public token page — approving a live
//    offshore roster is higher-stakes than the client-facing share
//    links elsewhere in this module, so it reuses the app's own
//    sign-in + RBAC instead of inventing an unauthenticated write
//    surface for it). Gated on crew.manage, same as a direct
//    assign/unassign today.
//  - decideRosterChangeRequest: approve or reject a pending request.
//    Approve applies the change in the same shapes assignCandidateTo
//    Matrix / unassignCandidateFromMatrix already use (soft-close via
//    end_date/planned_end_date/assignment_status, insert with
//    start_date/planned_start_date/actual_start_date), stamping
//    whichever crew_assignments row(s) it touches with
//    roster_change_request_id so the timeline can trace the change back
//    to its request. Gated on crew.matrix.approve_internal, the same
//    permission that already decides internal approval on the matrix
//    itself.
//  - cancelRosterChangeRequest: lets the original requester withdraw
//    their own still-pending request.
//  - listRosterChangeRequests: every request for a matrix (any status),
//    newest first, with crew names resolved — feeds both the pending-
//    approvals panel and the expanding timeline.

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEffectiveAccess, can } from "@/lib/rbac";
import { sendEmail, companyFromAddress } from "@/lib/email";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const REASON_CODES: { value: string; label: string }[] = [
  { value: "rotation_ended", label: "Rotation ended (6-on/1-off)" },
  { value: "sick_leave", label: "Sick leave" },
  { value: "performance_conduct", label: "Performance / conduct" },
  { value: "client_request", label: "Client request" },
  { value: "headcount_change", label: "Headcount change" },
  { value: "other", label: "Other" },
];

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

async function appOrigin() {
  const hdrs = await headers();
  const host = hdrs.get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  return `${protocol}://${host}`;
}

const revalidateMatrix = (crewMatrixId: string) => revalidatePath(`/crew/matrices/${crewMatrixId}`);

// Every profile in this org holding crew.matrix.approve_internal, with
// their sign-in email resolved via the admin client — mirrors
// getEscalationRecipients() in app/api/cron/send-reminders/route.ts
// exactly (role_permissions -> profiles -> auth.admin.getUserById).
async function getApprovalRecipients(admin: ReturnType<typeof createAdminClient>, orgId: string): Promise<{ id: string; email: string }[]> {
  const { data: roleRows } = await admin
    .from("roles")
    .select("id, role_permissions!inner(permission_key)")
    .eq("org_id", orgId)
    .eq("role_permissions.permission_key", "crew.matrix.approve_internal");
  const roleIds = (roleRows ?? []).map((r: any) => r.id);
  if (roleIds.length === 0) return [];

  const { data: profileRows } = await admin.from("profiles").select("id").eq("org_id", orgId).in("role_id", roleIds);

  const recipients: { id: string; email: string }[] = [];
  for (const p of profileRows ?? []) {
    const { data: userResult } = await admin.auth.admin.getUserById((p as any).id);
    const email = userResult?.user?.email;
    if (email) recipients.push({ id: (p as any).id, email });
  }
  return recipients;
}

export type ChangeType = "assign" | "replace" | "unassign";

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
  const { supabase, access, userId, userEmail } = await requirePermission("crew.manage", "You don't have permission to request a roster change.");

  if (!DATE_RE.test(input.effectiveDate)) return { error: "Effective date is required." };
  if (!REASON_CODES.some((r) => r.value === input.reasonCode)) return { error: "Please choose a reason." };
  if (input.changeType !== "assign" && !input.outgoingCrewId) return { error: "Outgoing crew member is required for a replace or unassign." };
  if (input.changeType !== "unassign" && !input.incomingCrewId) return { error: "Incoming crew member is required for an assign or replace." };

  const { data: matrix, error: matrixErr } = await supabase
    .from("crew_matrices")
    .select("id, title, matrix_number, offshore_site_id, offshore_sites(name)")
    .eq("id", input.crewMatrixId)
    .eq("org_id", access.orgId)
    .single();
  if (matrixErr || !matrix) return { error: "Matrix not found." };

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
    })
    .select("id")
    .single();
  if (insertErr || !request) return { error: insertErr?.message ?? "Could not create the request." };

  // Notify every internal approver — best-effort; a failed/unconfigured
  // email must never block the request itself from having been raised.
  try {
    const admin = createAdminClient();
    const recipients = await getApprovalRecipients(admin, access.orgId!);
    if (recipients.length > 0) {
      const { data: company } = await supabase.from("companies").select("name, notify_prefix").eq("id", access.orgId).single();
      const companyDisplayName = company?.name ?? access.companyName ?? "ComplianceHub";
      const from = companyFromAddress(companyDisplayName, company?.notify_prefix ?? null);
      const origin = await appOrigin();
      const site = (Array.isArray(matrix.offshore_sites) ? matrix.offshore_sites[0] : matrix.offshore_sites) as { name?: string } | null;
      const matrixLabel = `${matrix.matrix_number ?? matrix.title}${site?.name ? ` — ${site.name}` : ""}`;
      const changeLabel = input.changeType === "assign" ? "New assignment" : input.changeType === "unassign" ? "Unassign" : "Crew replacement";
      const reasonLabel = REASON_CODES.find((r) => r.value === input.reasonCode)?.label ?? input.reasonCode;
      const url = `${origin}/crew/matrices/${input.crewMatrixId}`;
      const subject = `Roster change awaiting your approval — ${matrixLabel}`;
      const html = `
        <p>A roster change on <strong>${matrixLabel}</strong> needs your approval before it takes effect.</p>
        <p><strong>${changeLabel}</strong> — effective ${input.effectiveDate}<br/>Reason: ${reasonLabel}${input.reasonNotes ? `<br/>Notes: ${input.reasonNotes}` : ""}</p>
        <p>Requested by ${access.fullName ?? userEmail ?? "a ComplianceHub user"}.</p>
        <p><a href="${url}">Review and confirm in ComplianceHub</a></p>
      `.trim();
      const text = `A roster change on ${matrixLabel} needs your approval.\n\n${changeLabel} — effective ${input.effectiveDate}\nReason: ${reasonLabel}${input.reasonNotes ? `\nNotes: ${input.reasonNotes}` : ""}\n\nRequested by ${access.fullName ?? userEmail ?? "a ComplianceHub user"}.\n\nReview and confirm: ${url}`;
      await Promise.all(recipients.map((r) => sendEmail({ from, to: r.email, subject, html, text, replyTo: userEmail ?? undefined })));
    }
  } catch {
    // Notification is best-effort — the request itself already succeeded.
  }

  revalidateMatrix(input.crewMatrixId);
  return { requestId: request.id as string };
}

export async function cancelRosterChangeRequest(requestId: string) {
  const { supabase, access, userId } = await requirePermission("crew.manage", "You don't have permission to withdraw this request.");

  const { data: request, error: fetchErr } = await supabase
    .from("roster_change_requests")
    .select("id, org_id, crew_matrix_id, status, requested_by")
    .eq("id", requestId)
    .single();
  if (fetchErr || !request || request.org_id !== access.orgId) return { error: "Request not found." };
  if (request.status !== "pending_approval") return { error: "Only a pending request can be withdrawn." };
  if (request.requested_by !== userId && !can(access, "crew.matrix.approve_internal")) {
    return { error: "You can only withdraw a request you raised yourself." };
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

  const { data: matrix, error: matrixErr } = await supabase
    .from("crew_matrices")
    .select("id, offshore_site_id")
    .eq("id", request.crew_matrix_id)
    .single();
  if (matrixErr || !matrix) return { error: "Matrix not found." };

  if (decision === "rejected") {
    const { error } = await supabase
      .from("roster_change_requests")
      .update({ status: "rejected", decided_by: userId, decided_at: new Date().toISOString(), decision_comment: comment?.trim() || null, updated_at: new Date().toISOString() })
      .eq("id", requestId);
    if (error) return { error: error.message };
    revalidateMatrix(request.crew_matrix_id as string);
    return {};
  }

  // Approved — apply the change using the same insert/soft-close shapes
  // as assignCandidateToMatrix / unassignCandidateFromMatrix in
  // staffing-actions.ts, stamped with roster_change_request_id.
  const effectiveDate = request.effective_date as string;
  let appliedAssignmentId: string | null = null;

  if (request.change_type === "unassign" || request.change_type === "replace") {
    const { data: assignment, error: findErr } = await supabase
      .from("crew_assignments")
      .select("id, offshore_site_id, start_date")
      .eq("crew_id", request.outgoing_crew_id)
      .is("end_date", null)
      .limit(1)
      .maybeSingle();
    if (findErr) return { error: findErr.message };
    if (!assignment) return { error: "The outgoing crew member no longer has an active assignment — refresh and try again." };

    const { error: closeErr } = await supabase
      .from("crew_assignments")
      .update({
        end_date: effectiveDate,
        planned_end_date: effectiveDate,
        assignment_status: "cancelled",
        roster_change_request_id: requestId,
        updated_by: userId,
      })
      .eq("id", assignment.id);
    if (closeErr) return { error: closeErr.message };
    await supabase.from("crew_profiles").update({ deployment_status: "onshore" }).eq("id", request.outgoing_crew_id);
    appliedAssignmentId = assignment.id as string;
  }

  if (request.change_type === "assign" || request.change_type === "replace") {
    const { data: stillActive } = await supabase.from("crew_assignments").select("id").eq("crew_id", request.incoming_crew_id).is("end_date", null).limit(1);
    if (stillActive && stillActive.length > 0) {
      return { error: "The incoming crew member already has another active assignment — refresh and try again." };
    }
    const { data: newAssignment, error: insertErr } = await supabase
      .from("crew_assignments")
      .insert({
        org_id: access.orgId,
        crew_id: request.incoming_crew_id,
        offshore_site_id: matrix.offshore_site_id,
        start_date: effectiveDate,
        planned_start_date: effectiveDate,
        actual_start_date: effectiveDate,
        assignment_status: "active",
        roster_change_request_id: requestId,
        notes: "Assigned via an approved roster change request.",
        created_by: userId,
        updated_by: userId,
      })
      .select("id")
      .single();
    if (insertErr || !newAssignment) return { error: insertErr?.message ?? "Could not create the new assignment." };
    await supabase.from("crew_profiles").update({ deployment_status: "onboard" }).eq("id", request.incoming_crew_id);
    appliedAssignmentId = newAssignment.id as string;
  }

  const { error: decideErr } = await supabase
    .from("roster_change_requests")
    .update({
      status: "approved",
      decided_by: userId,
      decided_at: new Date().toISOString(),
      decision_comment: comment?.trim() || null,
      applied_assignment_id: appliedAssignmentId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", requestId);
  if (decideErr) return { error: decideErr.message };

  revalidateMatrix(request.crew_matrix_id as string);
  return {};
}

export async function listRosterChangeRequests(crewMatrixId: string) {
  const { supabase, access } = await requirePermission("crew.manage", "You don't have permission to view roster changes.");

  const { data, error } = await supabase
    .from("roster_change_requests")
    .select(
      "id, change_type, outgoing_crew_id, incoming_crew_id, effective_date, reason_code, reason_notes, status, requested_by, requested_at, decided_by, decided_at, decision_comment, crew_matrix_line_id, " +
        "outgoing:crew_profiles!outgoing_crew_id(full_name), incoming:crew_profiles!incoming_crew_id(full_name)"
    )
    .eq("crew_matrix_id", crewMatrixId)
    .eq("org_id", access.orgId)
    .order("requested_at", { ascending: false });
  if (error) return { error: error.message, requests: [] as any[] };
  return { requests: data ?? [] };
}
