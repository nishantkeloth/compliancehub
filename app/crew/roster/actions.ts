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
export async function bulkAssignCrew(
  crewIds: string[],
  offshoreSiteId: string,
  startDate: string,
  notes: string | null
) {
  if (crewIds.length === 0) return { error: "Select at least one crew member." };
  if (!offshoreSiteId) return { error: "Select a vessel." };
  const { supabase, access, userId } = await requireCrewManage();
  const effectiveStartDate = startDate || new Date().toISOString().slice(0, 10);

  const failed: string[] = [];
  for (const crewId of crewIds) {
    const { error: closeError } = await supabase
      .from("crew_assignments")
      .update({ end_date: effectiveStartDate, updated_by: userId })
      .eq("crew_id", crewId)
      .is("end_date", null);
    if (closeError) {
      failed.push(crewId);
      continue;
    }
    const { error: insertError } = await supabase.from("crew_assignments").insert({
      org_id: access.orgId,
      crew_id: crewId,
      offshore_site_id: offshoreSiteId,
      start_date: effectiveStartDate,
      notes,
      created_by: userId,
      updated_by: userId,
    });
    if (insertError) failed.push(crewId);
  }

  crewIds.forEach(revalidateDetail);
  revalidateRoster();

  if (failed.length > 0) {
    return { error: `${failed.length} of ${crewIds.length} crew member(s) couldn't be assigned. Try those again.`, failed };
  }
  return {};
}
