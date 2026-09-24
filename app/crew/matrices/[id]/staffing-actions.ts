"use server";

// Staffing Plan tab actions:
//  - assignCandidateToMatrix: a lightweight, direct crew_assignments write
//    for a candidate already surfaced as "available" on this matrix's
//    Staffing Plan. Deliberately mirrors the successful insert shape in
//    app/crew/profiles/actions.ts's assignCrewToSite (same table, same
//    one-active-assignment constraint handling), but WITHOUT that
//    function's extra mobilization.emergency_override gate, reason
//    prompt, or manual_assignment_overrides audit row — those exist
//    specifically for out-of-band overrides of an assigned crew member,
//    which doesn't apply here (this crew member has no assignment at
//    all yet). Gated on crew.manage, the same permission that already
//    protects every other crew_assignments write in the app, so it
//    succeeds under RLS for anyone who could already assign crew
//    elsewhere in ComplianceHub. Accepts an optional assign date
//    (defaults to today) — AHM calculates on-board day counts and payroll
//    from this date, so it has to be caller-supplied, not hardcoded. Also
//    accepts an optional planned end date, entered by the assigner rather
//    than computed from a rotation template, purely so the Assigned tab
//    has something to show right away instead of an end date that stays
//    empty until the person is actually unassigned/signed off.
//  - unassignCandidateFromMatrix: the direct counterpart to
//    assignCandidateToMatrix. Used to delete the crew_assignments row
//    outright; now soft-closes it instead (sets end_date/planned_end_date
//    to the given date and assignment_status to "cancelled") so the
//    assign/unassign date pair AHM needs for day-count and payroll survives
//    the unassign, and there's a history to look back on. Still distinct
//    from the formal sign-off/demob flow in endCrewAssignment — that flow
//    is for a real offshore rotation ending (assignment_status
//    "signed_off", with a signoff_confirmations audit row); this one is
//    for undoing a quick Staffing Plan assignment that was never a real
//    mobilization, so it uses "cancelled" instead. Gated on crew.manage,
//    same as deleteCrewAssignment, so it succeeds under RLS the same way.
//    Accepts an optional unassign date (defaults to today), same reasoning
//    as the assign date above.
//  - createResourceProfileLink: generates a token-based public link (see
//    migration 0017 + app/resource-profile/[token]) that a client can
//    open without a ComplianceHub account to see one candidate's status
//    against the document types required for one specific rank on this
//    matrix — the same row already shown on screen, nothing more.
//  - reserveCandidateForLine / unreserveCandidate: "soft lock" a
//    currently-visible Available/Other Location candidate for a specific
//    rank on this matrix (see migration 0026 + reserve-candidate-sample.html
//    for the approved mockup), without moving them off that list the way
//    Assign does. One active reservation per crew member org-wide at a
//    time — reserving someone who already holds one just moves it over
//    (see the migration's own comment for why), so this never errors out
//    from a stale click the way a hard uniqueness conflict would.
//    Unreserve soft-releases it (released_at/released_by), same pattern
//    as unassignCandidateFromMatrix's soft-close. Gated on crew.manage,
//    same as Assign/Unassign.

import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveAccess, can } from "@/lib/rbac";

const RESOURCE_PROFILE_LINK_DAYS = 30;

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

function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString("base64url");
}

async function appOrigin() {
  const hdrs = await headers();
  const host = hdrs.get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  return `${protocol}://${host}`;
}

const revalidateMatrix = (crewMatrixId: string) => revalidatePath(`/crew/matrices/${crewMatrixId}`);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function resolveDate(input: string | undefined | null) {
  if (input && DATE_RE.test(input)) return input;
  return new Date().toISOString().slice(0, 10);
}

export async function assignCandidateToMatrix(crewId: string, crewMatrixId: string, assignDate?: string, plannedEndDate?: string) {
  const { supabase, access, userId } = await requirePermission("crew.manage", "You don't have permission to assign crew.");

  const { data: matrix, error: matrixErr } = await supabase
    .from("crew_matrices")
    .select("id, offshore_site_id")
    .eq("id", crewMatrixId)
    .eq("org_id", access.orgId)
    .single();
  if (matrixErr || !matrix) return { error: "Matrix not found." };

  // Phase 6 control: only one open (end_date is null) assignment per
  // crew_id, enforced by the DB (crew_assignments_one_active_idx) — check
  // first for a clean message, and still handle the constraint below in
  // case of a race.
  const { data: stillActive } = await supabase
    .from("crew_assignments")
    .select("id, offshore_sites(name)")
    .eq("crew_id", crewId)
    .is("end_date", null)
    .limit(1);
  if (stillActive && stillActive.length > 0) {
    const site = (Array.isArray(stillActive[0].offshore_sites) ? stillActive[0].offshore_sites[0] : stillActive[0].offshore_sites) as { name?: string } | null;
    return { error: `This crew member already has an active assignment on ${site?.name ?? "another site"}.` };
  }

  const date = resolveDate(assignDate);
  // Planned end date — optional, entered by the assigner at Assign time (not
  // computed from a rotation template) so the Assigned tab can show it
  // right away instead of it staying null until someone actually
  // unassigns/signs the person off. Purely informational at this point: it
  // doesn't drive any reminder or auto-unassign, and the actual end_date is
  // still only set when the assignment is closed (see
  // unassignCandidateFromMatrix / the formal sign-off flow).
  const plannedEnd = plannedEndDate && DATE_RE.test(plannedEndDate) ? plannedEndDate : null;
  if (plannedEnd && plannedEnd < date) {
    return { error: `Planned end date can't be before the assign date (${date}).` };
  }
  const { error } = await supabase.from("crew_assignments").insert({
    org_id: access.orgId,
    crew_id: crewId,
    offshore_site_id: matrix.offshore_site_id,
    start_date: date,
    planned_start_date: date,
    actual_start_date: date,
    planned_end_date: plannedEnd,
    assignment_status: "active",
    notes: "Assigned directly from the crew matrix Staffing Plan.",
    created_by: userId,
    updated_by: userId,
  });
  if (error) {
    if (error.message.includes("crew_assignments_one_active_idx")) {
      return { error: "This crew member already has an active assignment — refresh and try again." };
    }
    return { error: error.message };
  }

  await supabase.from("crew_profiles").update({ deployment_status: "onboard" }).eq("id", crewId);

  // A reserved candidate who's now actually being assigned no longer
  // needs the soft lock — release it automatically (whichever matrix
  // reserved them, this one or another) so nobody has to remember to
  // Unreserve separately once someone's confirmed. Best-effort: this
  // isn't worth failing the assignment over if it doesn't find a row.
  await supabase
    .from("crew_matrix_line_reservations")
    .update({ released_at: new Date().toISOString(), released_by: userId, updated_at: new Date().toISOString() })
    .eq("crew_id", crewId)
    .is("released_at", null);

  revalidateMatrix(crewMatrixId);
  return {};
}

export async function unassignCandidateFromMatrix(crewId: string, crewMatrixId: string, unassignDate?: string) {
  const { supabase, access, userId } = await requirePermission("crew.manage", "You don't have permission to unassign crew.");

  const { data: matrix, error: matrixErr } = await supabase
    .from("crew_matrices")
    .select("id, offshore_site_id")
    .eq("id", crewMatrixId)
    .eq("org_id", access.orgId)
    .single();
  if (matrixErr || !matrix) return { error: "Matrix not found." };

  const { data: assignment, error: findErr } = await supabase
    .from("crew_assignments")
    .select("id, offshore_site_id, start_date")
    .eq("crew_id", crewId)
    .is("end_date", null)
    .limit(1)
    .maybeSingle();
  if (findErr) return { error: findErr.message };
  if (!assignment) return { error: "This crew member has no active assignment — refresh and try again." };
  if (assignment.offshore_site_id !== matrix.offshore_site_id) {
    return { error: "This crew member's active assignment isn't for this matrix's site — manage it from their profile instead." };
  }

  const date = resolveDate(unassignDate);
  if (assignment.start_date && date < (assignment.start_date as string)) {
    return { error: `Unassign date can't be before the assign date (${assignment.start_date}).` };
  }

  const { error } = await supabase
    .from("crew_assignments")
    .update({
      end_date: date,
      planned_end_date: date,
      assignment_status: "cancelled",
      updated_by: userId,
    })
    .eq("id", assignment.id);
  if (error) return { error: error.message };

  await supabase.from("crew_profiles").update({ deployment_status: "onshore" }).eq("id", crewId);

  revalidateMatrix(crewMatrixId);
  return {};
}

export async function createResourceProfileLink(crewId: string, crewMatrixLineId: string) {
  const { supabase, access, userId } = await requirePermission("crew.matrix.manage", "You don't have permission to share candidate profiles.");

  const { data: line, error: lineErr } = await supabase
    .from("crew_matrix_lines")
    .select("id, crew_matrix_id, crew_matrices!inner(org_id)")
    .eq("id", crewMatrixLineId)
    .single();
  const matrixOrgId = (Array.isArray(line?.crew_matrices) ? line?.crew_matrices[0]?.org_id : (line?.crew_matrices as { org_id?: string } | undefined)?.org_id) as string | undefined;
  if (lineErr || !line || matrixOrgId !== access.orgId) return { error: "Manning line not found." };

  const { data: crew, error: crewErr } = await supabase.from("crew_profiles").select("id").eq("id", crewId).eq("org_id", access.orgId).single();
  if (crewErr || !crew) return { error: "Crew member not found." };

  const token = randomToken();
  const expiresAt = new Date(Date.now() + RESOURCE_PROFILE_LINK_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { error: insertErr } = await supabase.from("candidate_resource_profile_links").insert({
    org_id: access.orgId,
    crew_id: crewId,
    crew_matrix_line_id: crewMatrixLineId,
    token,
    created_by: userId,
    expires_at: expiresAt,
  });
  if (insertErr) return { error: insertErr.message };

  const origin = await appOrigin();
  return { url: `${origin}/resource-profile/${token}`, expiresAt };
}

export async function reserveCandidateForLine(crewId: string, crewMatrixId: string, crewMatrixLineId: string, notes?: string, expectedReadyDate?: string) {
  const { supabase, access, userId } = await requirePermission("crew.manage", "You don't have permission to reserve crew.");

  const { data: matrix, error: matrixErr } = await supabase
    .from("crew_matrices")
    .select("id")
    .eq("id", crewMatrixId)
    .eq("org_id", access.orgId)
    .single();
  if (matrixErr || !matrix) return { error: "Matrix not found." };

  const { data: line, error: lineErr } = await supabase
    .from("crew_matrix_lines")
    .select("id")
    .eq("id", crewMatrixLineId)
    .eq("crew_matrix_id", crewMatrixId)
    .single();
  if (lineErr || !line) return { error: "Manning line not found." };

  const { data: crewRow, error: crewErr } = await supabase.from("crew_profiles").select("id").eq("id", crewId).eq("org_id", access.orgId).single();
  if (crewErr || !crewRow) return { error: "Crew member not found." };

  const readyDate = expectedReadyDate && DATE_RE.test(expectedReadyDate) ? expectedReadyDate : null;
  const trimmedNotes = notes?.trim() || null;
  const nowIso = new Date().toISOString();

  // One active reservation per crew member, org-wide (see migration
  // 0026) — if they already hold one, move it onto this line/matrix
  // instead of erroring, so clicking Reserve always "just works" from
  // wherever it's clicked, including taking over a reservation held for
  // a different matrix (the explicit "override" case from the mockup).
  const { data: existing } = await supabase.from("crew_matrix_line_reservations").select("id").eq("crew_id", crewId).is("released_at", null).maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("crew_matrix_line_reservations")
      .update({
        org_id: access.orgId,
        crew_matrix_id: crewMatrixId,
        crew_matrix_line_id: crewMatrixLineId,
        notes: trimmedNotes,
        expected_ready_date: readyDate,
        reserved_by: userId,
        reserved_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", existing.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from("crew_matrix_line_reservations").insert({
      org_id: access.orgId,
      crew_id: crewId,
      crew_matrix_id: crewMatrixId,
      crew_matrix_line_id: crewMatrixLineId,
      notes: trimmedNotes,
      expected_ready_date: readyDate,
      reserved_by: userId,
    });
    if (error) {
      if (error.message.includes("crew_matrix_line_reservations_one_active_idx")) {
        return { error: "This crew member was just reserved elsewhere — refresh and try again." };
      }
      return { error: error.message };
    }
  }

  revalidateMatrix(crewMatrixId);
  return {};
}

export async function unreserveCandidate(reservationId: string, crewMatrixId: string) {
  const { supabase, access, userId } = await requirePermission("crew.manage", "You don't have permission to unreserve crew.");

  const { error } = await supabase
    .from("crew_matrix_line_reservations")
    .update({ released_at: new Date().toISOString(), released_by: userId, updated_at: new Date().toISOString() })
    .eq("id", reservationId)
    .eq("org_id", access.orgId)
    .is("released_at", null);
  if (error) return { error: error.message };

  revalidateMatrix(crewMatrixId);
  return {};
}
