import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { can, getEffectiveAccess } from "@/lib/rbac";
import AppShell from "../../app-shell";
import ScheduleForm from "./schedule-form";
import ScheduleRow from "./schedule-row";

export default async function SchedulesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getEffectiveAccess(supabase, user.id);
  if (!access.orgId) redirect("/");

  const canManage = can(access, "schedules.manage");

  const { data: schedules } = await supabase
    .from("inspection_schedules")
    .select(
      "id, frequency, next_due_date, active, assigned_to, templates(name, code), sites(name), profiles(full_name)"
    )
    .eq("org_id", access.orgId)
    .order("next_due_date");

  const { data: templates } = await supabase
    .from("templates")
    .select("id, name, code")
    .eq("org_id", access.orgId)
    .order("name");

  const { data: members } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("org_id", access.orgId)
    .order("full_name");

  const today = new Date().toISOString().slice(0, 10);

  return (
    <AppShell active="schedules" title="Inspection Schedules">
      <p className="text-sm mb-6" style={{ color: "var(--ch-sub)" }}>
        Set up a recurring inspection and who it's assigned to. Reminder emails go out as it comes due
        and if it's missed.
      </p>

      {canManage && (
        <>
          <h2
            className="text-sm font-semibold uppercase tracking-wide mb-3"
            style={{ color: "var(--ch-sub)" }}
          >
            New schedule
          </h2>
          <ScheduleForm templates={templates ?? []} members={members ?? []} />
        </>
      )}

      <h2
        className="text-sm font-semibold uppercase tracking-wide mb-3 mt-8"
        style={{ color: "var(--ch-sub)" }}
      >
        Schedules ({(schedules ?? []).length})
      </h2>
      <div className="space-y-3">
        {(schedules ?? []).map((s: any) => {
          // Supabase's join inference sometimes returns these as a single
          // object and sometimes as a one-element array depending on the
          // relationship — normalize both to an object (same pattern used
          // for inspections on the dashboard).
          const template = Array.isArray(s.templates) ? s.templates[0] : s.templates;
          const site = Array.isArray(s.sites) ? s.sites[0] : s.sites;
          const assignee = Array.isArray(s.profiles) ? s.profiles[0] : s.profiles;
          return (
            <ScheduleRow
              key={s.id}
              schedule={{
                id: s.id,
                templateName: template?.name ?? "—",
                templateCode: template?.code ?? "",
                siteName: site?.name ?? "—",
                assigneeName: assignee?.full_name ?? null,
                frequency: s.frequency,
                nextDueDate: s.next_due_date,
              }}
              canManage={canManage}
              canMarkDone={canManage || s.assigned_to === user.id}
              today={today}
            />
          );
        })}
        {(schedules ?? []).length === 0 && (
          <div
            className="bg-white border rounded-xl p-6 text-sm"
            style={{ borderColor: "var(--ch-line)", color: "var(--ch-sub)" }}
          >
            No recurring schedules yet.
          </div>
        )}
      </div>
    </AppShell>
  );
}
