// Single source of truth for role-based access control at the app layer.
//
// Company-level roles and permissions are DATA now, not code — they live
// in the `roles` / `permissions` / `role_permissions` tables (see the
// Roles & Permissions screen under Manage Users) and are mirrored
// exactly by Postgres RLS via the has_permission() SQL function. This
// file only resolves "what can the current user do" once per request,
// and defines the small fixed set of PLATFORM-level permissions that
// aren't company-configurable at all.

// Platform-level permissions — cross-tenant, never something a company
// admin can grant or configure. Governed entirely by membership in the
// platform_admins table.
export const PLATFORM_PERMISSIONS = [
  "platform.manage_companies",
  "company.onboard_admin",
] as const;
export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];

export type EffectiveAccess = {
  isPlatformAdmin: boolean;
  orgId: string | null;
  roleId: string | null;
  roleName: string | null;
  permissions: Set<string>;
};

export async function getEffectiveAccess(
  supabase: { from: (table: string) => any },
  userId: string
): Promise<EffectiveAccess> {
  const { data: platformAdminRow } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (platformAdminRow) {
    return {
      isPlatformAdmin: true,
      orgId: null,
      roleId: null,
      roleName: "Platform Admin",
      permissions: new Set(),
    };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("org_id, role_id, roles(name)")
    .eq("id", userId)
    .single();

  const roleId: string | null = profile?.role_id ?? null;
  let permissions = new Set<string>();
  if (roleId) {
    const { data: rows } = await supabase
      .from("role_permissions")
      .select("permission_key")
      .eq("role_id", roleId);
    permissions = new Set((rows ?? []).map((r: { permission_key: string }) => r.permission_key));
  }

  return {
    isPlatformAdmin: false,
    orgId: profile?.org_id ?? null,
    roleId,
    roleName: (profile?.roles as { name?: string } | null)?.name ?? null,
    permissions,
  };
}

// Company-level permission check — does the current user's role have
// this permission granted? (Platform admins can always act — they go
// through the service-role client after their own is_platform_admin()
// check anyway, same as everywhere else in this app.)
export function can(access: EffectiveAccess, permission: string): boolean {
  return access.isPlatformAdmin || access.permissions.has(permission);
}

// Platform-level permission check — only ever true for an actual
// platform admin; no company role can grant these.
export function canPlatform(access: EffectiveAccess, _permission: PlatformPermission): boolean {
  return access.isPlatformAdmin;
}
