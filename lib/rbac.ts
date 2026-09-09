// Single source of truth for role-based access control.
//
// Every permission check in the app should go through `can()` /
// `canAssignRole()` from this file — never compare `profile.role === "..."`
// directly in a page or Server Action. That scattering is exactly what
// made the old checks hard to audit; this file is the one place the
// answer to "who can do X" lives.

export const TENANT_ROLES = [
  "company_admin",
  "supervisor",
  "inspector",
  "auditor",
] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];

// "platform_admin" is never a value in profiles.role — it's derived from a
// row existing in the separate platform_admins table (see
// getEffectiveRole below). It's included here so the matrix can express
// platform-level permissions the same way as tenant-level ones.
export const ROLES = ["platform_admin", ...TENANT_ROLES] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "platform.manage_companies", // create / list companies across all tenants
  "company.onboard_admin", // create a company's first admin while creating the company
  "team.view", // see the Manage Users screen for one's own company
  "team.invite", // add a new team member (invite-link or direct-create)
  "team.manage_status", // activate / deactivate an existing team member
] as const;
export type Permission = (typeof PERMISSIONS)[number];

// THE permission matrix. To grant a role a permission, add the role to
// that permission's list below — that's the only place this decision
// should ever be made.
const MATRIX: Record<Permission, readonly Role[]> = {
  "platform.manage_companies": ["platform_admin"],
  "company.onboard_admin": ["platform_admin"],
  "team.view": ["company_admin"],
  "team.invite": ["company_admin"],
  "team.manage_status": ["company_admin"],
};

// Which roles a given role is allowed to hand out to someone else.
// A company_admin can create peers and any role below them; a
// platform_admin can only ever seed a company's first company_admin —
// they never assign supervisor/inspector/auditor directly.
const ASSIGNABLE_ROLES: Partial<Record<Role, readonly TenantRole[]>> = {
  platform_admin: ["company_admin"],
  company_admin: TENANT_ROLES,
};

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return MATRIX[permission].includes(role);
}

export function assignableRoles(role: Role | null | undefined): readonly TenantRole[] {
  if (!role) return [];
  return ASSIGNABLE_ROLES[role] ?? [];
}

export function canAssignRole(role: Role | null | undefined, targetRole: string): boolean {
  return assignableRoles(role).includes(targetRole as TenantRole);
}

// Resolves the caller's single effective role. Platform admin status
// (a row in platform_admins) always wins — that's a cross-tenant
// capability layered on top of, not stored inside, profiles.role.
export async function getEffectiveRole(
  supabase: { from: (table: string) => any },
  userId: string
): Promise<{ role: Role | null; orgId: string | null }> {
  const { data: platformAdminRow } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (platformAdminRow) return { role: "platform_admin", orgId: null };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, org_id")
    .eq("id", userId)
    .single();
  return { role: (profile?.role as Role) ?? null, orgId: profile?.org_id ?? null };
}

export const ROLE_LABELS: Record<TenantRole, string> = {
  inspector: "Inspector",
  supervisor: "Supervisor",
  auditor: "Auditor",
  company_admin: "Company Admin",
};
