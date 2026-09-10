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
    throw new Error("You don't have permission to manage clients.");
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

const revalidateClients = () => {
  revalidatePath("/crew/clients");
  // Offshore Sites (Crew Setup) shows the client name next to each
  // contractor in its dropdown, so keep that in sync too.
  revalidatePath("/crew/setup");
};

export async function createClient_(formData: FormData) {
  const { supabase, access, userId } = await requireCrewManage();
  const name = str(formData, "name");
  if (!name) return { error: "Name is required." };

  const { data: code, error: codeError } = await supabase.rpc("next_number_range_code", {
    p_org_id: access.orgId,
    p_entity_type: "client",
  });
  if (codeError) return { error: `Could not assign a client code: ${codeError.message}` };

  const { error } = await supabase.from("clients").insert({
    org_id: access.orgId,
    name,
    code,
    contract_number: optStr(formData, "contractNumber"),
    contract_start_date: optStr(formData, "contractStartDate"),
    contract_end_date: optStr(formData, "contractEndDate"),
    billing_model: optStr(formData, "billingModel"),
    notes: optStr(formData, "notes"),
    created_by: userId,
    updated_by: userId,
  });
  if (error) return { error: error.message };
  revalidateClients();
  return {};
}

export async function updateClient(id: string, formData: FormData) {
  const { supabase, userId } = await requireCrewManage();
  const name = str(formData, "name");
  if (!name) return { error: "Name is required." };

  const { error } = await supabase
    .from("clients")
    .update({
      name,
      contract_number: optStr(formData, "contractNumber"),
      contract_start_date: optStr(formData, "contractStartDate"),
      contract_end_date: optStr(formData, "contractEndDate"),
      billing_model: optStr(formData, "billingModel"),
      notes: optStr(formData, "notes"),
      is_active: formData.get("isActive") === "on",
      updated_by: userId,
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidateClients();
  return {};
}

export async function deleteClient(id: string) {
  const { supabase } = await requireCrewManage();
  const { error } = await supabase.from("clients").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidateClients();
  return {};
}
