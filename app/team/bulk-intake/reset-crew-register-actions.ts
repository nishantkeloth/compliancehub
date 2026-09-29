"use server";

// Bulk Data Migration — full reset of the crew register itself: every crew
// profile and every crew document, org-wide. This is deliberately separate
// from resetCrewMatrixSiteProjectContractData() (../reset-actions.ts), which
// explicitly never touches crew profiles — that tool clears the Matrix/Site/
// Project/Contract side only and says so in its own UI copy.
//
// This tool goes the other direction: it clears the people (crew_profiles)
// and their documents (crew_documents), plus everything that has to go with
// them because it blocks the delete — crew matrices/lines, crew assignments,
// mobilizations, and the handful of workflow tables that sit between them.
// Contractors, Clients, Projects, Contracts, and Offshore Sites are never
// touched; ops/billing history that happens to reference a crew member has
// its crew reference cleared rather than being deleted outright, so billing
// records survive the wipe.
//
// Every foreign key referencing crew_profiles, crew_documents,
// crew_assignments, and crew_matrix_lines was enumerated against the LIVE
// schema (via pg_constraint/pg_attribute in the Supabase SQL Editor, not
// just the tracked migration files — crew_documents and crew_assignments
// were both created directly in Supabase and never went through a
// supabase/migrations/*.sql file, same gap the original reset tool's
// comments already flagged) before writing this. 43 referencing
// columns were found; the ones that matter to the order below:
//
//   Restrict ("no action") FKs that would block a delete unless cleared
//   first: crew_documents.reliever_crew_id; crew_assignments.reliever_
//   crew_id; mobilization_positions.{reliever_for_crew_id,selected_crew_id};
//   mobilization_position_history.{new_crew_id,previous_crew_id};
//   readiness_snapshots.crew_id (NOT NULL); compliance_waivers.crew_id (NOT
//   NULL); manual_assignment_overrides.{crew_id,crew_assignment_id};
//   boarding_confirmations.crew_id; signoff_confirmations.{crew_id,
//   replacement_crew_id,crew_assignment_id}; crew_change_requests.{current_
//   crew_id,proposed_reliever_crew_id,crew_assignment_id}; ops_cost_entries.
//   crew_id (nullable); crew_document_versions.crew_id; roster_change_
//   requests.{outgoing_crew_id,incoming_crew_id,applied_assignment_id};
//   mobilization_positions.crew_matrix_line_id.
//
//   Cascade ("on delete cascade") FKs that clean themselves up once the
//   parent row goes, no action needed: crew_skills.crew_id; crew_secondary_
//   roles.crew_id; crew_documents.crew_id; crew_assignments.crew_id;
//   crew_document_upload_links.crew_id; candidate_resource_profile_links.
//   {crew_id,crew_matrix_line_id}; crew_matrix_line_reservations.{crew_id,
//   crew_matrix_line_id}; document_notifications.{crew_id,crew_document_id};
//   crew_document_versions.crew_document_id; rotation_extensions.crew_
//   assignment_id; crew_matrix_line_{skills,documents,competencies,client_
//   requirements}.line_id.
//
//   Set-null FKs, already safe: crew_intake_generations.crew_profile_id;
//   crew_matrix_share_staff.crew_id; roster_change_requests.crew_matrix_
//   line_id.
//
// Deletion order:
//   1. crew_matrices — reuses deleteAllCrewMatrices() wholesale (same as
//      the Matrix/Site/Project/Contract reset), which cascades crew_matrix_
//      lines and everything under a line, unlinks/clears roster_change_
//      requests and matrix-linked mobilizations, and handles the boarding_
//      confirmations rows a mobilization forces along with it.
//   2. crew_change_requests, manual_assignment_overrides, signoff_
//      confirmations, boarding_confirmations — any left after step 1 (e.g.
//      never linked to a crew_matrix_id) — plain deletes, clears every
//      restrict FK these four hold into crew_assignments/crew_profiles.
//   3. crew_assignments — every remaining row, org-wide. No "release to
//      onshore" step first (unlike deleteAllCrewMatrices) — the crew
//      profile being released is about to be deleted outright anyway.
//   4. mobilization_requests — any left after step 1. Cascades mobilization_
//      positions and everything under it (compliance_waivers, readiness_
//      snapshots — both NOT NULL on crew_id, only safe because they're
//      gone via this cascade before crew_profiles is ever touched —
//      checklist items, history, comments, status history) automatically.
//   5. ops_cost_entries — crew_id set to null (not deleted; this is ops/
//      billing history, not crew-register data, and the column is
//      nullable) for any row still pointing at a crew member.
//   6. crew_documents — every remaining row, org-wide. Cascades crew_
//      document_versions and document_notifications via crew_document_id
//      automatically, and removes crew_documents.reliever_crew_id's
//      restrict FK from the picture before step 7.
//   7. crew_profiles — every row, org-wide. Cascades crew_skills, crew_
//      secondary_roles, crew_document_upload_links, candidate_resource_
//      profile_links, crew_matrix_line_reservations, document_notifications
//      (all already empty by this point from earlier steps); sets null
//      crew_intake_generations.crew_profile_id and crew_matrix_share_staff.
//      crew_id.
//
// Runs entirely through the service-role client (bypasses RLS) — requireCrewRegisterResetAccess()
// below gates who can call this at all.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEffectiveAccess, can } from "@/lib/rbac";
import { deleteAllCrewMatrices } from "@/app/crew/matrices/actions";

async function requireCrewRegisterResetAccess() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "crew.bulk_intake.manage")) throw new Error("This reset is restricted to company admins.");
  for (const perm of ["crew.manage", "crew.documents.manage", "crew.matrix.manage"] as const) {
    if (!can(access, perm)) {
      throw new Error("You need Crew Setup, Crew Documents, and Crew Matrix management permission to run this reset.");
    }
  }
  if (!access.orgId) throw new Error("No company context.");
  return { supabase, access, userId: user.id };
}

export async function getCrewRegisterResetPreviewCounts() {
  const { supabase, access } = await requireCrewRegisterResetAccess();
  const orgId = access.orgId!;
  const [{ count: crewProfiles }, { count: crewDocuments }, { count: crewMatrices }, { count: crewAssignments }] = await Promise.all([
    supabase.from("crew_profiles").select("id", { count: "exact", head: true }).eq("org_id", orgId),
    supabase.from("crew_documents").select("id", { count: "exact", head: true }).eq("org_id", orgId),
    supabase.from("crew_matrices").select("id", { count: "exact", head: true }).eq("org_id", orgId),
    supabase.from("crew_assignments").select("id", { count: "exact", head: true }).eq("org_id", orgId),
  ]);
  return {
    crewProfiles: crewProfiles ?? 0,
    crewDocuments: crewDocuments ?? 0,
    crewMatrices: crewMatrices ?? 0,
    crewAssignments: crewAssignments ?? 0,
  };
}

export async function resetCrewRegisterData(): Promise<
  | { error: string }
  | {
      deletedCrewProfiles: number;
      deletedCrewDocuments: number;
      deletedCrewMatrices: number;
      deletedCrewAssignments: number;
    }
> {
  const { access } = await requireCrewRegisterResetAccess();
  const orgId = access.orgId!;
  const admin = createAdminClient();

  // Step 1 — crew matrices (see deleteAllCrewMatrices for what this covers:
  // lines and everything under a line, roster-change/mobilization unlinking,
  // the boarding_confirmations rows a mobilization forces along with it).
  const matrixResult = await deleteAllCrewMatrices();
  if (matrixResult.error) return { error: matrixResult.error };

  // Step 2 — anything left with a plain FK into crew_assignments or
  // crew_profiles that step 1 didn't already clear.
  for (const table of ["crew_change_requests", "manual_assignment_overrides", "signoff_confirmations", "boarding_confirmations"]) {
    const { error } = await admin.from(table).delete().eq("org_id", orgId);
    if (error) return { error: `Couldn't clear ${table}: ${error.message}` };
  }

  // Step 3 — crew_assignments, every remaining row. No release-to-onshore
  // step first — the crew_profiles rows these point at are about to be
  // deleted outright in step 7.
  const { count: assignmentCount } = await admin.from("crew_assignments").select("id", { count: "exact", head: true }).eq("org_id", orgId);
  const { error: assignErr } = await admin.from("crew_assignments").delete().eq("org_id", orgId);
  if (assignErr) return { error: `Couldn't clear crew_assignments: ${assignErr.message}` };

  // Step 4 — any mobilization_requests step 1 didn't already remove.
  // Cascades positions, history, compliance_waivers, readiness_snapshots.
  const { error: mobErr } = await admin.from("mobilization_requests").delete().eq("org_id", orgId);
  if (mobErr) return { error: `Couldn't clear mobilization_requests: ${mobErr.message}` };

  // Step 5 — ops_cost_entries.crew_id is nullable and this is ops/billing
  // history, not crew-register data, so the reference is cleared rather
  // than the row deleted.
  const { error: opsErr } = await admin.from("ops_cost_entries").update({ crew_id: null }).eq("org_id", orgId).not("crew_id", "is", null);
  if (opsErr) return { error: `Couldn't clear crew references on ops_cost_entries: ${opsErr.message}` };

  // Step 6 — crew_documents, every remaining row. Cascades crew_document_
  // versions and document_notifications via crew_document_id.
  const { count: documentCount } = await admin.from("crew_documents").select("id", { count: "exact", head: true }).eq("org_id", orgId);
  const { error: docsErr } = await admin.from("crew_documents").delete().eq("org_id", orgId);
  if (docsErr) return { error: `Couldn't clear crew_documents: ${docsErr.message}` };

  // Step 7 — crew_profiles, every row. Cascades crew_skills, crew_secondary_
  // roles, crew_document_upload_links, candidate_resource_profile_links,
  // crew_matrix_line_reservations, document_notifications (all already
  // empty); sets null crew_intake_generations.crew_profile_id and
  // crew_matrix_share_staff.crew_id.
  const { count: profileCount } = await admin.from("crew_profiles").select("id", { count: "exact", head: true }).eq("org_id", orgId);
  const { error: profilesErr } = await admin.from("crew_profiles").delete().eq("org_id", orgId);
  if (profilesErr) return { error: `Couldn't clear crew_profiles: ${profilesErr.message}` };

  revalidatePath("/crew/profiles");
  revalidatePath("/crew/matrices");
  revalidatePath("/team");
  revalidatePath("/team/bulk-intake");
  revalidatePath("/team/bulk-intake/reset-crew-register");

  return {
    deletedCrewProfiles: profileCount ?? 0,
    deletedCrewDocuments: documentCount ?? 0,
    deletedCrewMatrices: matrixResult.deletedMatrices,
    deletedCrewAssignments: assignmentCount ?? 0,
  };
}
