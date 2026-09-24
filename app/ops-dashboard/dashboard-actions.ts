"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveAccess, can } from "@/lib/rbac";

async function requireManage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "crew.documents.manage") && !can(access, "notifications.manage")) {
    throw new Error("You don't have permission to manage document notifications.");
  }
  if (!access.orgId) throw new Error("No company context.");
  return { supabase, userId: user.id, orgId: access.orgId };
}

export async function acknowledgeNotification(id: string) {
  const { supabase, userId, orgId } = await requireManage();
  const { error } = await supabase
    .from("document_notifications")
    .update({ status: "acknowledged", acknowledged_by: userId, acknowledged_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("org_id", orgId);
  if (error) return { error: error.message };
  revalidatePath("/ops-dashboard");
  return {};
}

export async function resolveNotification(id: string) {
  const { supabase, orgId } = await requireManage();
  const { error } = await supabase
    .from("document_notifications")
    .update({ status: "resolved", resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("org_id", orgId);
  if (error) return { error: error.message };
  revalidatePath("/ops-dashboard");
  return {};
}
