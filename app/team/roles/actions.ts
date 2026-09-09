"use server";

import { createClient } from "@/lib/supabase/server";
import { can, getEffectiveAccess } from "@/lib/rbac";
import { revalidatePath } from "next/cache";

const BASE_RANKS = ["company_admin", "supervisor", "inspector", "auditor"] as const;

export async function createRole(formData: FormData) {
  const name = (formData.get("name") as string | null)?.trim();
  const baseRank = formData.get("baseRank") as string | null;

  if (!name) return { error: "Name is required." };
  if (!baseRank || !BASE_RANKS.includes(baseRank as (typeof BASE_RANKS)[number])) {
    return { error: "Choose a base tier." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "team.manage_roles") || !access.orgId) {
    return { error: "You don't have permission to do this." };
  }

  const { data: role, error } = await supabase
    .from("roles")
    .insert({ org_id: access.orgId, name, base_rank: baseRank, is_system: false, created_by: user.id })
    .select("id, name")
    .single();
  if (error) {
    return { error: error.message.includes("duplicate") ? "A role with that name already exists." : error.message };
  }

  revalidatePath("/team/roles");
  revalidatePath("/team");
  return { error: null, role };
}

export async function renameRole(roleId: string, name: string) {
  name = name.trim();
  if (!name) return { error: "Name is required." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "team.manage_roles") || !access.orgId) {
    return { error: "You don't have permission to do this." };
  }

  const { error } = await supabase.from("roles").update({ name }).eq("id", roleId).eq("org_id", access.orgId);
  if (error) {
    return { error: error.message.includes("duplicate") ? "A role with that name already exists." : error.message };
  }

  revalidatePath("/team/roles");
  revalidatePath("/team");
  return { error: null };
}

export async function deleteRole(roleId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "team.manage_roles") || !access.orgId) {
    return { error: "You don't have permission to do this." };
  }

  const { count } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role_id", roleId);
  if ((count ?? 0) > 0) {
    return { error: `${count} team member${count === 1 ? "" : "s"} still ${count === 1 ? "has" : "have"} this role — reassign them first.` };
  }

  const { error } = await supabase.from("roles").delete().eq("id", roleId).eq("org_id", access.orgId);
  if (error) return { error: "Could not delete this role (built-in roles can't be deleted)." };

  revalidatePath("/team/roles");
  revalidatePath("/team");
  return { error: null };
}

export async function setRolePermission(roleId: string, permissionKey: string, granted: boolean) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "team.manage_roles") || !access.orgId) {
    return { error: "You don't have permission to do this." };
  }

  // Guardrail: never let the built-in Company Admin role lose the ability
  // to manage roles — that would lock everyone (including whoever just
  // clicked this) out of this screen for good.
  if (!granted && permissionKey === "team.manage_roles") {
    const { data: role } = await supabase.from("roles").select("system_key").eq("id", roleId).single();
    if (role?.system_key === "company_admin") {
      return { error: "The built-in Company Admin role must always be able to manage roles." };
    }
  }

  if (granted) {
    const { error } = await supabase.from("role_permissions").insert({ role_id: roleId, permission_key: permissionKey });
    if (error && !error.message.includes("duplicate")) return { error: error.message };
  } else {
    const { error } = await supabase
      .from("role_permissions")
      .delete()
      .eq("role_id", roleId)
      .eq("permission_key", permissionKey);
    if (error) return { error: error.message };
  }

  revalidatePath("/team/roles");
  return { error: null };
}
