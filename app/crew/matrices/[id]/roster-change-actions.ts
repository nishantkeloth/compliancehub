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
//    assign/unassign today. Only allowed on a matrix that's a NEW
//    VERSION (status draft, version_number > 1, i.e. created via Create
//    New Version) and not yet Active — see the revised design note
//    below.
//  - decideRosterChangeRequest: approve or reject a pending request.
//    Approving no longer writes to crew_assignments at all — it just
//    records the decision. See "staged, not applied" below for why.
//    Gated on crew.matrix.approve_internal, the same permission that
//    already decides internal approval on the matrix itself.
//  - applyApprovedRosterChanges: called once, from activateCrewMatrix
//    (app/crew/matrices/actions.ts), at the moment a new-version matrix
//    actually goes live. Applies every approved-but-not-yet-applied
//    request for that matrix to the real crew_assignments rows, in the
//    same insert/soft-close shapes assignCandidateToMatrix /
//    unassignCandidateFromMatrix already use, stamping whichever row(s)
//    it touches with roster_change_request_id so the timeline can trace
//    the change back to its request.
//  - cancelRosterChangeRequest: lets the original requester withdraw
//    their own still-pending request.
//  - listRosterChangeRequests: every request for a matrix (any status),
//    newest first, with crew names resolved — feeds both the pending-
//    approvals panel and the expanding timeline.
//
// Revised design — staged, not applied on approval: crew_assignments rows
// aren't scoped to a specific crew_matrix or version at all (crew_id +
// offshore_site_id only — see assignCandidateToMatrix in
// staffing-actions.ts). That means every version of a site's matrix shares
// the exact same live roster. Originally (first Phase 17 build) Request
// Change lived on the Active matrix and applied immediately on approval.
// That's wrong: editing "the active matrix" was really always editing the
// one shared, client-facing roster with no review step actually
// protecting it, and a still-Active OLD version's Assigned tab would
// change the instant a request was approved on some other matrix touching
// the same site. So the flow moved: Request Change now only exists on a
// NEW VERSION (a draft created via Create New Version, before it's been
// activated) — see staffing-plan.tsx's isNewVersion/requiresApproval — and
// approving one stages the change instead of applying it. The staged
// changes are only applied, all together, when that new version is
// Activated (the same moment it supersedes the previously-active
// version), so the live roster the client sees never moves until the new
// version has gone through its own full approval pipeline. The currently
// Active matrix itself is read-only (no Request Change, no direct
// assign/unassign) — see isLiveMatrix in staffing-plan.tsx.

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEffectiveAccess, can } from "@/lib/rbac";
import { sendEmail, companyFromAddress } from "@/lib/email";
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
    .select("id, title, matrix_number, status, version_number, offshore_site_id, offshore_sites(name)")
    .eq("id", input.crewMatrixId)
    .eq("org_id", access.orgId)
    .single();
  if (matrixErr || !matrix) return { error: "Matrix not found." };
  if (matrix.status === "active") {
    return { error: "This matrix is live and read-only. Use Create New Version to change crew." };
  }
  if ((matrix.version_number ?? 1) <= 1) {
    return { error: "Roster change requests are only for a new version of the matrix (Create New Version first)." };
  }

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

export async function listRosterChangeRequests(crewMatrixId: string) {
  const { supabase, access } = await requirePermission("crew.manage", "You don't have permission to view roster changes.");

  const { data, error } = await supabase
    .from("roster_change_requests")
    .select(
      "id, change_type, outgoing_crew_id, incoming_crew_id, effective_date, reason_code, reason_notes, status, requested_by, requested_at, decided_by, decided_at, decision_comment, applied_assignment_id, crew_matrix_line_id, " +
        "outgoing:crew_profiles!outgoing_crew_id(full_name), incoming:crew_profiles!incoming_crew_id(full_name)"
    )
    .eq("crew_matrix_id", crewMatrixId)
    .eq("org_id", access.orgId)
    .order("requested_at", { ascending: false });
  if (error) return { error: error.message, requests: [] as any[] };
  return { requests: data ?? [] };
}
