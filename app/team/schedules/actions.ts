"use server";

import { createClient } from "@/lib/supabase/server";
import { can, getEffectiveAccess } from "@/lib/rbac";
import { revalidatePath } from "next/cache";

const FREQUENCIES = ["daily", "weekly", "monthly"] as const;
type Frequency = (typeof FREQUENCIES)[number];

function advanceDueDate(date: string, frequency: Frequency): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (frequency === "daily") d.setUTCDate(d.getUTCDate() + 1);
  else if (frequency === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}

export async function createSchedule(formData: FormData) {
  const templateId = (formData.get("templateId") as string | null)?.trim();
  const siteName = (formData.get("siteName") as string | null)?.trim();
  const assignedTo = (formData.get("assignedTo") as string | null)?.trim() || null;
  const frequency = (formData.get("frequency") as string | null) as Frequency | null;
  const startDate = (formData.get("startDate") as string | null)?.trim();

  if (!templateId) return { error: "Choose a template." };
  if (!siteName) return { error: "Enter a site or location name." };
  if (!frequency || !FREQUENCIES.includes(frequency)) return { error: "Choose a frequency." };
  if (!startDate) return { error: "Choose a start date." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "schedules.manage") || !access.orgId) {
    return { error: "You don't have permission to do this." };
  }

  const { data: templateRow } = await supabase
    .from("templates")
    .select("id, org_id")
    .eq("id", templateId)
    .single();
  if (!templateRow || templateRow.org_id !== access.orgId) {
    return { error: "Choose a valid template." };
  }

  // Same lookup-or-create pattern as Start Inspection on the dashboard —
  // sites here are just named locations, not a managed picker.
  let { data: siteRow } = await supabase
    .from("sites")
    .select("id")
    .eq("org_id", access.orgId)
    .ilike("name", siteName)
    .maybeSingle();
  if (!siteRow) {
    const { data, error: sErr } = await supabase
      .from("sites")
      .insert({ org_id: access.orgId, name: siteName })
      .select("id")
      .single();
    if (sErr) return { error: sErr.message };
    siteRow = data;
  }

  if (assignedTo) {
    const { data: assigneeRow } = await supabase
      .from("profiles")
      .select("id, org_id")
      .eq("id", assignedTo)
      .single();
    if (!assigneeRow || assigneeRow.org_id !== access.orgId) {
      return { error: "Choose a valid assignee." };
    }
  }

  const { error } = await supabase.from("inspection_schedules").insert({
    org_id: access.orgId,
    site_id: siteRow!.id,
    template_id: templateId,
    assigned_to: assignedTo,
    frequency,
    next_due_date: startDate,
    created_by: user.id,
  });
  if (error) return { error: error.message };

  revalidatePath("/team/schedules");
  return { error: null };
}

export async function markScheduleDone(scheduleId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const access = await getEffectiveAccess(supabase, user.id);
  if (!access.orgId) return { error: "Not part of a company." };

  const { data: schedule } = await supabase
    .from("inspection_schedules")
    .select("id, org_id, assigned_to, frequency, next_due_date")
    .eq("id", scheduleId)
    .single();
  if (!schedule || schedule.org_id !== access.orgId) {
    return { error: "Schedule not found." };
  }
  // Either whoever manages schedules, or the person it's actually
  // assigned to, can mark their own occurrence done.
  if (!can(access, "schedules.manage") && schedule.assigned_to !== user.id) {
    return { error: "You don't have permission to do this." };
  }

  const nextDue = advanceDueDate(schedule.next_due_date, schedule.frequency as Frequency);
  const { error } = await supabase
    .from("inspection_schedules")
    .update({ next_due_date: nextDue, reminder_due_soon_sent_for: null, reminder_overdue_sent_for: null })
    .eq("id", scheduleId);
  if (error) return { error: error.message };

  revalidatePath("/team/schedules");
  return { error: null };
}

export async function deleteSchedule(scheduleId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "schedules.manage") || !access.orgId) {
    return { error: "You don't have permission to do this." };
  }

  const { error } = await supabase.from("inspection_schedules").delete().eq("id", scheduleId).eq("org_id", access.orgId);
  if (error) return { error: error.message };

  revalidatePath("/team/schedules");
  return { error: null };
}
