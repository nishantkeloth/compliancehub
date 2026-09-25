"use server";

// Bulk Data Migration — full reset of crew matrices, offshore sites,
// projects, and contracts. Requested to clear test/demo data before
// go-live. Deliberately never touches Contractors, Clients, or crew
// profiles (the roster of people) — nothing below references those
// tables.
//
// This reaches far deeper than the crew-matrix-only "Delete all crew
// matrices" tool (deleteAllCrewMatrices in app/crew/matrices/actions.ts)
// because offshore_sites, projects, and contracts all sit underneath
// crew matrices in the foreign-key graph — deleting them forces
// everything that references a site or project to go too: crew
// assignment HISTORY (not just the "current" assignments
// deleteAllCrewMatrices releases — the actual crew_assignments rows),
// mobilizations end-to-end, boarding/sign-off/change-request records,
// manual overrides, and site/project-scoped containers and operations
// records. None of that is optional — those tables have plain
// (non-cascading) foreign keys into offshore_sites/projects, confirmed
// against the LIVE schema (via information_schema, not just the tracked
// migration files — a few of these tables were created directly in
// Supabase and never went through a supabase/migrations/*.sql file)
// before writing this. Leaving any of them in place would just make the
// site/project delete fail with a foreign-key error.
//
// Deletion order, each edge verified against the live schema:
//   1. crew_matrices — reuses deleteAllCrewMatrices's own cleanup
//      wholesale (lines, shares, reservations, workflow instances,
//      roster_change_requests cascade, matrix-linked mobilizations)
//      rather than duplicating it.
//   2. boarding_confirmations, crew_change_requests,
//      manual_assignment_overrides, signoff_confirmations — each blocks
//      either crew_assignments or offshore_sites (or both) with a plain
//      FK, and nothing else references any of these four, so they're
//      simple deletes, in any order relative to each other.
//   3. crew_assignments — every remaining row, org-wide. The one
//      genuinely irreversible side effect worth calling out on its own:
//      this erases crew deployment HISTORY (who was assigned where and
//      when), not just current assignments. crew_profiles (the people)
//      are never touched — only their assignment records.
//   4. container_movements, ops_daily_logs, ops_cost_entries — site/
//      project-scoped operational records; their own children
//      (container_incidents/container_load_items) cascade or null out
//      automatically.
//   5. mobilization_requests — any left after step 1's matrix-scoped
//      cleanup (e.g. one never linked to a crew_matrix_id). Cascades
//      mobilization_positions and everything under it (checklist items,
//      history, compliance waivers, readiness snapshots, comments,
//      status history) automatically, now that nothing with a plain FK
//      still points at them (steps 2/3 cleared those).
//   6. offshore_sites — now safe; site_manning_requirements cascades,
//      ai_generations.offshore_site_id gets set null.
//   7. projects — now safe; billing_terms/ops_billing_adjustments/
//      ops_cost_entries/ops_daily_logs/ops_periods cascade,
//      ai_generations.project_id gets set null.
//   8. contracts — now safe; billing_terms/contract_documents/
//      contract_services/contract_status_history cascade.
//
// Runs entirely through the service-role client (bypasses RLS), same as
// deleteAllCrewMatrices — requireResetAccess() below is what actually
// gates who can call this at all.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEffectiveAccess, can } from "@/lib/rbac";
import { deleteAllCrewMatrices } from "@/app/crew/matrices/actions";

async function requireResetAccess() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "crew.bulk_intake.manage")) throw new Error("This reset is restricted to company admins.");
  for (const perm of ["crew.matrix.manage", "crew.manage", "projects.manage", "contracts.manage"] as const) {
    if (!can(access, perm)) {
      throw new Error("You need Crew Matrix, Crew Setup, Projects, and Contracts management permission to run this reset.");
    }
  }
  if (!access.orgId) throw new Error("No company context.");
  return { supabase, access, userId: user.id };
}

export async function getResetPreviewCounts() {
  const { supabase, access } = await requireResetAccess();
  const orgId = access.orgId!;
  const [{ count: matrices }, { count: sites }, { count: projects }, { count: contracts }] = await Promise.all([
    supabase.from("crew_matrices").select("id", { count: "exact", head: true }).eq("org_id", orgId),
    supabase.from("offshore_sites").select("id", { count: "exact", head: true }).eq("org_id", orgId),
    supabase.from("projects").select("id", { count: "exact", head: true }).eq("org_id", orgId),
    supabase.from("contracts").select("id", { count: "exact", head: true }).eq("org_id", orgId),
  ]);
  return {
    crewMatrices: matrices ?? 0,
    offshoreSites: sites ?? 0,
    projects: projects ?? 0,
    contracts: contracts ?? 0,
  };
}

export async function resetCrewMatrixSiteProjectContractData(): Promise<
  | { error: string }
  | {
      deletedMatrices: number;
      deletedSites: number;
      deletedProjects: number;
      deletedContracts: number;
      deletedCrewAssignments: number;
    }
> {
  const { access } = await requireResetAccess();
  const orgId = access.orgId!;
  const admin = createAdminClient();

  // Step 1 — crew matrices (see deleteAllCrewMatrices for what this covers).
  const matrixResult = await deleteAllCrewMatrices();
  if (matrixResult.error) return { error: matrixResult.error };

  // Step 2 — clear everything with a plain FK into crew_assignments or
  // offshore_sites that isn't already gone.
  for (const table of ["boarding_confirmations", "crew_change_requests", "manual_assignment_overrides", "signoff_confirmations"]) {
    const { error } = await admin.from(table).delete().eq("org_id", orgId);
    if (error) return { error: `Couldn't clear ${table}: ${error.message}` };
  }

  // Step 3 — crew_assignments. Release anyone still shown "onboard" whose
  // assignment row is about to disappear first — covers an assignment
  // made directly against a site rather than through a matrix, which step
  // 1's matrix-scoped release wouldn't have touched.
  const { data: stillOnboard } = await admin.from("crew_assignments").select("crew_id").eq("org_id", orgId).is("end_date", null);
  const onboardCrewIds = Array.from(new Set((stillOnboard ?? []).map((r) => r.crew_id as string)));
  if (onboardCrewIds.length > 0) {
    const { error } = await admin.from("crew_profiles").update({ deployment_status: "onshore" }).in("id", onboardCrewIds);
    if (error) return { error: `Couldn't release crew before wiping assignments: ${error.message}` };
  }
  const { count: assignmentCount } = await admin.from("crew_assignments").select("id", { count: "exact", head: true }).eq("org_id", orgId);
  const { error: assignErr } = await admin.from("crew_assignments").delete().eq("org_id", orgId);
  if (assignErr) return { error: `Couldn't clear crew_assignments: ${assignErr.message}` };

  // Step 4 — site/project-scoped operational records.
  for (const table of ["container_movements", "ops_daily_logs", "ops_cost_entries"]) {
    const { error } = await admin.from(table).delete().eq("org_id", orgId);
    if (error) return { error: `Couldn't clear ${table}: ${error.message}` };
  }

  // Step 5 — any mobilization_requests step 1 didn't already remove.
  const { error: mobErr } = await admin.from("mobilization_requests").delete().eq("org_id", orgId);
  if (mobErr) return { error: `Couldn't clear mobilization_requests: ${mobErr.message}` };

  // Step 6 — offshore sites.
  const { count: siteCount } = await admin.from("offshore_sites").select("id", { count: "exact", head: true }).eq("org_id", orgId);
  const { error: sitesErr } = await admin.from("offshore_sites").delete().eq("org_id", orgId);
  if (sitesErr) return { error: `Couldn't clear offshore_sites: ${sitesErr.message}` };

  // Step 7 — projects.
  const { count: projectCount } = await admin.from("projects").select("id", { count: "exact", head: true }).eq("org_id", orgId);
  const { error: projectsErr } = await admin.from("projects").delete().eq("org_id", orgId);
  if (projectsErr) return { error: `Couldn't clear projects: ${projectsErr.message}` };

  // Step 8 — contracts. Contractors and Clients are never touched by any
  // step above.
  const { count: contractCount } = await admin.from("contracts").select("id", { count: "exact", head: true }).eq("org_id", orgId);
  const { error: contractsErr } = await admin.from("contracts").delete().eq("org_id", orgId);
  if (contractsErr) return { error: `Couldn't clear contracts: ${contractsErr.message}` };

  revalidatePath("/crew/matrices");
  revalidatePath("/sites");
  revalidatePath("/projects");
  revalidatePath("/contracts");
  revalidatePath("/team/bulk-intake");
  revalidatePath("/team/bulk-intake/reset-data");

  return {
    deletedMatrices: matrixResult.deletedMatrices,
    deletedSites: siteCount ?? 0,
    deletedProjects: projectCount ?? 0,
    deletedContracts: contractCount ?? 0,
    deletedCrewAssignments: assignmentCount ?? 0,
  };
}
