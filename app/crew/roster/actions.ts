"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveAccess, can } from "@/lib/rbac";

async function requireCrewManage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "crew.manage")) {
    throw new Error("You don't have permission to manage crew profiles.");
  }
  if (!access.orgId) throw new Error("No company context.");
  return { supabase, access, userId: user.id };
}

const revalidateRoster = () => revalidatePath("/crew/roster");
const revalidateDetail = (id: string) => revalidatePath(`/crew/profiles/${id}`);

// Assigns several crew members to the same vessel in one action — the
// vessel-first counterpart to assignCrewToSite (which is still what the
// per-crew profile page and the roster board's drag-and-drop use for a
// single person). Same rule applies per crew member: close out whatever
// open assignment they currently have, then open a new one.
//
// Phase 4: like assignCrewToSite, this is now the restricted emergency
// path — normal assignment happens through an approved mobilization's
// boarding confirmation — so it requires mobilization.emergency_override
// on top of crew.manage, a reason, and logs each assignment to
// manual_assignment_overrides.
export async function bulkAssignCrew(
  crewIds: string[],
  offshoreSiteId: string,
  startDate: string,
  notes: string | null,
  reason: string
) {
  if (crewIds.length === 0) return { error: "Select at least one crew member." };
  if (!offshoreSiteId) return { error: "Select a vessel." };
  if (!reason?.trim()) return { error: "A reason is required for a direct (non-mobilization) assignment." };
  const { supabase, access, userId } = await requireCrewManage();
  if (!can(access, "mobilization.emergency_override")) {
    return { error: "Direct assignment is a restricted emergency override — you need that permission to use it. Assign crew through an approved mobilization instead." };
  }
  const effectiveStartDate = startDate || new Date().toISOString().slice(0, 10);

  const failed: string[] = [];
  for (const crewId of crewIds) {
    // Phase 6 control: never silently close an active tour — it ends only
    // on sign-off. The one-active DB index rejects the insert otherwise.
    const { data: assignment, error: insertError } = await supabase
      .from("crew_assignments")
      .insert({
        org_id: access.orgId,
        crew_id: crewId,
        offshore_site_id: offshoreSiteId,
        start_date: effectiveStartDate,
        planned_start_date: effectiveStartDate,
        actual_start_date: effectiveStartDate,
        assignment_status: "active",
        notes,
        created_by: userId,
        updated_by: userId,
      })
      .select("id")
      .single();
    if (insertError) {
      failed.push(crewId);
      continue;
    }
    await supabase.from("crew_profiles").update({ deployment_status: "onboard" }).eq("id", crewId);
    await supabase.from("manual_assignment_overrides").insert({
      org_id: access.orgId,
      crew_id: crewId,
      offshore_site_id: offshoreSiteId,
      crew_assignment_id: assignment?.id,
      reason: reason.trim(),
      created_by: userId,
    });
  }

  crewIds.forEach(revalidateDetail);
  revalidateRoster();

  revalidatePath("/rotations");
  if (failed.length > 0) {
    return { error: `${failed.length} of ${crewIds.length} crew member(s) couldn't be assigned — most likely they still have an active assignment that needs a sign-off first.`, failed };
  }
  return {};
}
