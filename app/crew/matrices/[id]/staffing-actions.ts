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
//    elsewhere in ComplianceHub.
//  - createResourceProfileLink: generates a token-based public link (see
//    migration 0017 + app/resource-profile/[token]) that a client can
//    open without a ComplianceHub account to see one candidate's status
//    against the document types required for one specific rank on this
//    matrix — the same row already shown on screen, nothing more.

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

export async function assignCandidateToMatrix(crewId: string, crewMatrixId: string) {
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

  const today = new Date().toISOString().slice(0, 10);
  const { error } = await supabase.from("crew_assignments").insert({
    org_id: access.orgId,
    crew_id: crewId,
    offshore_site_id: matrix.offshore_site_id,
    start_date: today,
    planned_start_date: today,
    actual_start_date: today,
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
  if (lineErr || !line || matrixOrgId !== access.orgId) return { error: "Line not found." };

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
