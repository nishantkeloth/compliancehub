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
    throw new Error("You don't have permission to manage contractors.");
  }
  if (!access.orgId) throw new Error("No company context.");
  return { supabase, access, userId: user.id };
}

function str(formData: FormData, key: string) {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}
function optStr(formData: FormData, key: string) {
  const v = str(formData, key);
  return v || null;
}

const revalidateContractors = () => {
  revalidatePath("/crew/contractors");
  // Offshore Sites (Crew Setup) picks a contractor from a dropdown, so
  // keep that list in sync too.
  revalidatePath("/crew/setup");
};

export async function createContractor(formData: FormData) {
  const { supabase, access, userId } = await requireCrewManage();
  const name = str(formData, "name");
  if (!name) return { error: "Name is required." };
  const clientId = str(formData, "clientId");
  if (!clientId) return { error: "Client is required." };

  const { data: code, error: codeError } = await supabase.rpc("next_number_range_code", {
    p_org_id: access.orgId,
    p_entity_type: "contractor",
  });
  if (codeError) return { error: `Could not assign a contractor code: ${codeError.message}` };

  const { error } = await supabase.from("contractors").insert({
    org_id: access.orgId,
    client_id: clientId,
    name,
    code,
    notes: optStr(formData, "notes"),
    created_by: userId,
    updated_by: userId,
  });
  if (error) return { error: error.message };
  revalidateContractors();
  return {};
}

export async function updateContractor(id: string, formData: FormData) {
  const { supabase, userId } = await requireCrewManage();
  const name = str(formData, "name");
  if (!name) return { error: "Name is required." };
  const clientId = str(formData, "clientId");
  if (!clientId) return { error: "Client is required." };

  const { error } = await supabase
    .from("contractors")
    .update({
      name,
      client_id: clientId,
      notes: optStr(formData, "notes"),
      is_active: formData.get("isActive") === "on",
      updated_by: userId,
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidateContractors();
  return {};
}

export async function deleteContractor(id: string) {
  const { supabase } = await requireCrewManage();
  const { error } = await supabase.from("contractors").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidateContractors();
  return {};
}
