// Single source of truth for role-based access control at the app layer.
//
// Company-level roles and permissions are DATA now, not code — they live
// in the `roles` / `permissions` / `role_permissions` tables (see the
// Roles & Permissions screen under Manage Users) and are mirrored
// exactly by Postgres RLS via the has_permission() SQL function. This
// file only resolves "what can the current user do" once per request,
// and defines the small fixed set of PLATFORM-level permissions that
// aren't company-configurable at all.
//
// getEffectiveAccess() is wrapped in React's cache() below: every page
// calls it once for its own permission gate, and AppShell calls it again
// to build the sidebar/nav. Without the cache, that's two full round
// trips on every navigation. With it, the second call in the same
// request is a no-op — but only because lib/supabase/server.ts's
// createClient() is also cache()-wrapped, so both callers pass in the
// identical `supabase` instance (cache() keys on argument identity).
//
// It also now fetches everything AppShell's sidebar needs in one place
// (full name, company name) so AppShell doesn't run its own separate
// `profiles`/`companies` queries — those used to be two more full round
// trips on every single page load. Internally, independent lookups run
// concurrently (Promise.all) instead of one after another: this cuts a
// ~5-6 sequential-round-trip waterfall down to ~2 parallel "waves".

import { cache } from "react";

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
  fullName: string | null;
  companyName: string | null;
  permissions: Set<string>;
};

async function fetchPermissionKeys(
  supabase: { from: (table: string) => any },
  roleId: string | null
): Promise<string[]> {
  if (!roleId) return [];
  const { data } = await supabase.from("role_permissions").select("permission_key").eq("role_id", roleId);
  return ((data ?? []) as { permission_key: string }[]).map((r) => r.permission_key);
}

async function fetchCompanyName(
  supabase: { from: (table: string) => any },
  orgId: string | null
): Promise<string | null> {
  if (!orgId) return null;
  const { data } = await supabase.from("companies").select("name").eq("id", orgId).single();
  return (data as { name: string } | null)?.name ?? null;
}

export const getEffectiveAccess = cache(async function getEffectiveAccess(
  supabase: { from: (table: string) => any },
  userId: string
): Promise<EffectiveAccess> {
  // The platform-admin check and the profile row don't depend on each
  // other — fetch both at once instead of gating the profile query
  // behind the platform-admin result.
  const [{ data: platformAdminRow }, { data: profile }] = await Promise.all([
    supabase.from("platform_admins").select("user_id").eq("user_id", userId).maybeSingle(),
    supabase.from("profiles").select("full_name, org_id, role_id, roles(name)").eq("id", userId).single(),
  ]);

  if (platformAdminRow) {
    return {
      isPlatformAdmin: true,
      orgId: null,
      roleId: null,
      roleName: "Platform Admin",
      fullName: profile?.full_name ?? null,
      companyName: "Platform Admin",
      permissions: new Set(),
    };
  }

  const roleId: string | null = profile?.role_id ?? null;
  const orgId: string | null = profile?.org_id ?? null;

  // role_permissions depends only on roleId, companies only on orgId —
  // neither depends on the other, so fetch both concurrently too.
  const [permissionKeys, companyName] = await Promise.all([
    fetchPermissionKeys(supabase, roleId),
    fetchCompanyName(supabase, orgId),
  ]);

  return {
    isPlatformAdmin: false,
    orgId,
    roleId,
    roleName: (profile?.roles as { name?: string } | null)?.name ?? null,
    fullName: profile?.full_name ?? null,
    companyName,
    permissions: new Set(permissionKeys),
  };
});

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
