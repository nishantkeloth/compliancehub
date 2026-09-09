"use client";

import { useState, useTransition } from "react";
import { markScheduleDone, deleteSchedule } from "./actions";

const FREQUENCY_LABELS: Record<string, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

export default function ScheduleRow({
  schedule,
  canManage,
  canMarkDone,
  today,
}: {
  schedule: {
    id: string;
    templateName: string;
    templateCode: string;
    siteName: string;
    assigneeName: string | null;
    frequency: string;
    nextDueDate: string;
  };
  canManage: boolean;
  canMarkDone: boolean;
  today: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const daysUntilDue = Math.round(
    (new Date(`${schedule.nextDueDate}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) /
      86400000
  );
  const status =
    daysUntilDue < 0 ? "overdue" : daysUntilDue <= 3 ? "due soon" : "upcoming";
  const statusStyle =
    status === "overdue"
      ? { background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }
      : status === "due soon"
        ? { background: "#fff3cd", color: "#8a6500" }
        : { background: "var(--ch-navy-soft)", color: "var(--ch-navy)" };

  const markDone = () => {
    setError(null);
    startTransition(async () => {
      const res = await markScheduleDone(schedule.id);
      if (res?.error) setError(res.error);
    });
  };

  const remove = () => {
    if (!window.confirm("Delete this schedule? This can't be undone.")) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteSchedule(schedule.id);
      if (res?.error) setError(res.error);
    });
  };

  return (
    <div
      className="bg-white border rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap"
      style={{ borderColor: "var(--ch-line)" }}
    >
      <div>
        <div className="font-semibold" style={{ color: "var(--ch-ink)" }}>
          {schedule.templateName} · {schedule.siteName}
        </div>
        <div className="text-sm" style={{ color: "var(--ch-sub)" }}>
          {FREQUENCY_LABELS[schedule.frequency] ?? schedule.frequency} · Due {schedule.nextDueDate}
          {schedule.assigneeName ? ` · ${schedule.assigneeName}` : " · Unassigned"}
        </div>
        {error && (
          <div className="text-xs mt-1" style={{ color: "var(--ch-fail)" }}>
            {error}
          </div>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs font-bold uppercase rounded-full px-3 py-1" style={statusStyle}>
          {status}
        </span>
        {canMarkDone && (
          <button
            onClick={markDone}
            disabled={pending}
            className="text-xs font-semibold border rounded-lg px-3 py-1.5 disabled:opacity-50"
            style={{ borderColor: "var(--ch-line)", color: "var(--ch-navy)" }}
          >
            {pending ? "…" : "Mark done"}
          </button>
        )}
        {canManage && (
          <button
            onClick={remove}
            disabled={pending}
            className="text-xs font-semibold rounded-lg px-3 py-1.5 disabled:opacity-50"
            style={{ color: "var(--ch-fail)" }}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
