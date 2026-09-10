"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveAccess, can } from "@/lib/rbac";

async function requireNumberRangesManage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "team.manage_number_ranges")) {
    throw new Error("You don't have permission to manage number ranges.");
  }
  if (!access.orgId) throw new Error("No company context.");
  return { supabase, access, userId: user.id };
}

export async function updateNumberRange(entityType: "client" | "contractor", formData: FormData) {
  const { supabase, access, userId } = await requireNumberRangesManage();

  const prefix = ((formData.get("prefix") as string | null) ?? "").trim();
  const paddingRaw = (formData.get("paddingLength") as string | null) ?? "";
  const currentRaw = (formData.get("currentNumber") as string | null) ?? "";

  const paddingLength = Number(paddingRaw);
  if (!Number.isFinite(paddingLength) || paddingLength < 1 || paddingLength > 10) {
    return { error: "Padding must be a number between 1 and 10." };
  }

  const currentNumber = Number(currentRaw);
  if (!Number.isFinite(currentNumber) || currentNumber < 0) {
    return { error: "Current number must be 0 or greater." };
  }

  const { error } = await supabase.from("number_range_configs").upsert(
    {
      org_id: access.orgId,
      entity_type: entityType,
      prefix,
      padding_length: paddingLength,
      current_number: currentNumber,
      is_active: formData.get("isActive") === "on",
      updated_by: userId,
    },
    { onConflict: "org_id,entity_type" }
  );
  if (error) return { error: error.message };

  revalidatePath("/team/number-ranges");
  return {};
}
