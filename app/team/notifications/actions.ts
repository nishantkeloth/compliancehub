"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveAccess, can } from "@/lib/rbac";
import { DASHBOARD_MODULE_KEYS, type DashboardModuleKey } from "@/lib/document-notifications";

async function requireConfigure() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "notifications.manage")) throw new Error("You don't have permission to configure notifications.");
  if (!access.orgId) throw new Error("No company context.");
  return { supabase, userId: user.id, orgId: access.orgId };
}

function parseEmails(raw: string): { emails: string[]; invalid: string[] } {
  const parts = raw
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const emails = parts.filter((p) => emailRe.test(p));
  const invalid = parts.filter((p) => !emailRe.test(p));
  return { emails: Array.from(new Set(emails)), invalid };
}

export async function saveNotificationSettings(formData: FormData) {
  const { supabase, userId, orgId } = await requireConfigure();

  const raw = String(formData.get("recipientEmails") ?? "");
  const { emails, invalid } = parseEmails(raw);
  if (invalid.length > 0) {
    return { error: `Not a valid email address: ${invalid.slice(0, 3).join(", ")}${invalid.length > 3 ? "…" : ""}` };
  }

  const escalateAfterDaysRaw = Number(formData.get("escalateAfterDays"));
  const escalateAfterDays = Number.isFinite(escalateAfterDaysRaw) ? Math.min(30, Math.max(1, Math.round(escalateAfterDaysRaw))) : 3;

  const { error } = await supabase.from("notification_settings").upsert(
    {
      org_id: orgId,
      recipient_emails: emails,
      escalate_after_days: escalateAfterDays,
      digest_enabled: formData.get("digestEnabled") === "on",
      updated_by: userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id" }
  );
  if (error) return { error: error.message };

  revalidatePath("/team/notifications");
  revalidatePath("/ops-dashboard");
  return {};
}

export async function setDashboardModuleEnabled(moduleKey: DashboardModuleKey, enabled: boolean) {
  const { supabase, userId, orgId } = await requireConfigure();
  if (!DASHBOARD_MODULE_KEYS.includes(moduleKey)) return { error: "Unknown module." };

  const { error } = await supabase.from("dashboard_module_settings").upsert(
    { org_id: orgId, module_key: moduleKey, enabled, updated_by: userId, updated_at: new Date().toISOString() },
    { onConflict: "org_id,module_key" }
  );
  if (error) return { error: error.message };

  revalidatePath("/team/notifications");
  revalidatePath("/ops-dashboard");
  return {};
}
