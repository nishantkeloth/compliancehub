// Shared helpers for the in-app bell. Used by the scheduled jobs (service-role
// client) — people only ever read and mark-read their own rows, through the
// server actions in app/notifications/actions.ts.

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped supabase client, same pattern as the cron routes */

export type BellKind = "visa" | "document" | "upload" | "action" | "system";
export type BellSeverity = "info" | "warning" | "critical" | "ok";

export type BellInput = {
  orgId: string;
  userId: string;
  kind: BellKind;
  severity: BellSeverity;
  title: string;
  body?: string | null;
  link?: string | null;
  /** The same alert for the same person is created once per key. */
  dedupeKey: string;
};

/** Create bell items; any that already exist for that person and key are left alone. */
export async function addBellNotifications(admin: any, rows: BellInput[]): Promise<{ error: string | null }> {
  if (rows.length === 0) return { error: null };
  const payload = rows.map((r) => ({
    org_id: r.orgId,
    user_id: r.userId,
    kind: r.kind,
    severity: r.severity,
    title: r.title,
    body: r.body ?? null,
    link: r.link ?? null,
    dedupe_key: r.dedupeKey,
  }));
  for (let i = 0; i < payload.length; i += 500) {
    const { error } = await admin
      .from("app_notifications")
      .upsert(payload.slice(i, i + 500), { onConflict: "user_id,dedupe_key", ignoreDuplicates: true });
    if (error) return { error: error.message };
  }
  return { error: null };
}

/** Everyone in the company whose role grants the permission. */
export async function usersWithPermission(admin: any, orgId: string, permissionKey: string): Promise<string[]> {
  const { data: roleRows } = await admin
    .from("roles")
    .select("id, role_permissions!inner(permission_key)")
    .eq("org_id", orgId)
    .eq("role_permissions.permission_key", permissionKey);
  const roleIds = (roleRows ?? []).map((r: any) => r.id);
  if (roleIds.length === 0) return [];
  const { data: profileRows } = await admin.from("profiles").select("id").eq("org_id", orgId).in("role_id", roleIds);
  return (profileRows ?? []).map((p: any) => p.id as string);
}

/** Bell items older than 30 days are removed. */
export async function pruneOldNotifications(admin: any): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
  await admin.from("app_notifications").delete().lt("created_at", cutoff);
}

export function siteUrl(): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) || "http://localhost:3000";
  return base.replace(/\/$/, "");
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** "09 Oct 2026" from an ISO date. */
export function niceDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}
