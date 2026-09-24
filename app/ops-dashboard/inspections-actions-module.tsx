function stat(label: string, value: number, warn?: boolean) {
  return (
    <div>
      <div className="text-2xl font-bold" style={{ color: warn ? "var(--ch-fail, #b3261e)" : "var(--ch-navy)" }}>
        {value}
      </div>
      <div className="text-xs" style={{ color: "var(--ch-sub)" }}>
        {label}
      </div>
    </div>
  );
}

export type ScheduleRow = { id: string; templateName: string; siteName: string | null; dueDate: string; overdue: boolean };
export type CorrectiveActionRow = { id: string; title: string; siteName: string | null; dueDate: string | null; overdue: boolean; priority: string | null };

export default function InspectionsActionsModule({
  schedules,
  actions,
}: {
  schedules: ScheduleRow[];
  actions: CorrectiveActionRow[];
}) {
  const overdueSchedules = schedules.filter((s) => s.overdue).length;
  const overdueActions = actions.filter((a) => a.overdue).length;

  return (
    <div className="bg-white border rounded-xl p-5" style={{ borderColor: "var(--ch-line)" }}>
      <div className="text-sm font-semibold mb-3" style={{ color: "var(--ch-navy)" }}>
        Inspections, Audits & Corrective Actions
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
        {stat("Inspections due soon", schedules.length - overdueSchedules)}
        {stat("Inspections overdue", overdueSchedules, overdueSchedules > 0)}
        {stat("Open corrective actions", actions.length)}
        {stat("Actions overdue", overdueActions, overdueActions > 0)}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <div className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: "var(--ch-sub)" }}>
            Upcoming / overdue inspections
          </div>
          {schedules.length === 0 ? (
            <div className="text-sm" style={{ color: "var(--ch-sub)" }}>
              Nothing due in the next 7 days.
            </div>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {schedules.slice(0, 8).map((s) => (
                <li key={s.id} className="flex justify-between gap-2">
                  <span>
                    {s.templateName} {s.siteName ? `· ${s.siteName}` : ""}
                  </span>
                  <span style={{ color: s.overdue ? "#b3261e" : "var(--ch-sub)" }}>{s.dueDate}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: "var(--ch-sub)" }}>
            Open corrective actions
          </div>
          {actions.length === 0 ? (
            <div className="text-sm" style={{ color: "var(--ch-sub)" }}>
              No open corrective actions.
            </div>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {actions.slice(0, 8).map((a) => (
                <li key={a.id} className="flex justify-between gap-2">
                  <span>
                    {a.title} {a.siteName ? `· ${a.siteName}` : ""}
                  </span>
                  <span style={{ color: a.overdue ? "#b3261e" : "var(--ch-sub)" }}>{a.dueDate ?? "—"}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
