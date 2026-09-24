import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getEffectiveAccess, can } from "@/lib/rbac";
import { DASHBOARD_MODULE_KEYS, type DashboardModuleKey } from "@/lib/document-notifications";
import NotificationSettingsPanel from "./notification-settings-panel";

export default async function NotificationSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "notifications.manage") || !access.orgId) redirect("/team");
  const orgId = access.orgId;

  const [settingsRes, modulesRes] = await Promise.all([
    supabase
      .from("notification_settings")
      .select("recipient_emails, escalate_after_days, digest_enabled, last_digest_sent_for")
      .eq("org_id", orgId)
      .maybeSingle(),
    supabase.from("dashboard_module_settings").select("module_key, enabled").eq("org_id", orgId),
  ]);

  const moduleEnabled: Record<DashboardModuleKey, boolean> = {
    document_expiry: true,
    crew_matrix: true,
    inspections_actions: true,
  };
  for (const row of modulesRes.data ?? []) {
    if (DASHBOARD_MODULE_KEYS.includes(row.module_key as DashboardModuleKey)) {
      moduleEnabled[row.module_key as DashboardModuleKey] = row.enabled;
    }
  }

  return (
    <>
      <p className="text-sm mb-6" style={{ color: "var(--ch-sub)" }}>
        Who gets alerted when a crew document is expiring or has expired, and which modules show
        up on the Operations Dashboard for everyone in the company.
      </p>
      <NotificationSettingsPanel
        settings={{
          recipientEmails: settingsRes.data?.recipient_emails ?? [],
          escalateAfterDays: settingsRes.data?.escalate_after_days ?? 3,
          digestEnabled: settingsRes.data?.digest_enabled ?? true,
          lastDigestSentFor: settingsRes.data?.last_digest_sent_for ?? null,
        }}
        moduleEnabled={moduleEnabled}
      />
    </>
  );
}
