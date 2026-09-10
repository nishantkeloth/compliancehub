import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { can, getEffectiveAccess } from "@/lib/rbac";
import RolesManager from "./roles-manager";

export default async function RolesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "team.manage_roles") || !access.orgId) {
    redirect("/team");
  }

  const { data: roles } = await supabase
    .from("roles")
    .select("id, name, is_system, system_key")
    .eq("org_id", access.orgId)
    .order("is_system", { ascending: false })
    .order("name");

  const { data: permissions } = await supabase
    .from("permissions")
    .select("key, label, description")
    .order("key");

  const roleIds = (roles ?? []).map((r) => r.id);
  const { data: rolePermissionRows } = roleIds.length
    ? await supabase.from("role_permissions").select("role_id, permission_key").in("role_id", roleIds)
    : { data: [] as { role_id: string; permission_key: string }[] };

  const grants: Record<string, string[]> = {};
  for (const row of rolePermissionRows ?? []) {
    (grants[row.role_id] ??= []).push(row.permission_key);
  }

  return (
    <>
      <p className="text-sm mb-6" style={{ color: "var(--ch-sub)" }}>
        Create roles and choose exactly what each one can do. Assign roles to people from Manage Users.
      </p>
      <RolesManager
        roles={(roles ?? []).map((r) => ({ id: r.id, name: r.name, isSystem: r.is_system, systemKey: r.system_key }))}
        permissions={permissions ?? []}
        grants={grants}
      />
    </>
  );
}
