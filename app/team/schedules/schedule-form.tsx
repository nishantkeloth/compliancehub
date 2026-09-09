"use client";

import { useState, useTransition } from "react";
import { createSchedule } from "./actions";

type Template = { id: string; name: string; code: string };
type Member = { id: string; full_name: string | null };

const FREQUENCY_OPTIONS = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

export default function ScheduleForm({ templates, members }: { templates: Template[]; members: Member[] }) {
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [siteName, setSiteName] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [frequency, setFrequency] = useState("weekly");
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    if (!templateId || !siteName.trim() || !startDate) return;
    setError(null);
    const formData = new FormData();
    formData.set("templateId", templateId);
    formData.set("siteName", siteName.trim());
    formData.set("assignedTo", assignedTo);
    formData.set("frequency", frequency);
    formData.set("startDate", startDate);
    startTransition(async () => {
      const res = await createSchedule(formData);
      if (res?.error) {
        setError(res.error);
        return;
      }
      setSiteName("");
      setAssignedTo("");
    });
  };

  if (templates.length === 0) {
    return (
      <div
        className="bg-white border rounded-xl p-5 text-sm mb-8"
        style={{ borderColor: "var(--ch-line)", color: "var(--ch-sub)" }}
      >
        No inspection templates exist yet — a schedule needs one to repeat.
      </div>
    );
  }

  return (
    <div className="bg-white border rounded-xl p-5 mb-8" style={{ borderColor: "var(--ch-line)" }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm" style={{ color: "var(--ch-ink)" }}>
          Template
          <select
            className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
            style={{ borderColor: "var(--ch-line)" }}
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.code})
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm" style={{ color: "var(--ch-ink)" }}>
          Site / location
          <input
            className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
            style={{ borderColor: "var(--ch-line)" }}
            placeholder="e.g. Vessel A"
            value={siteName}
            onChange={(e) => setSiteName(e.target.value)}
          />
        </label>
        <label className="text-sm" style={{ color: "var(--ch-ink)" }}>
          Assign to (optional)
          <select
            className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
            style={{ borderColor: "var(--ch-line)" }}
            value={assignedTo}
            onChange={(e) => setAssignedTo(e.target.value)}
          >
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.full_name || "—"}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm" style={{ color: "var(--ch-ink)" }}>
          Repeats
          <select
            className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
            style={{ borderColor: "var(--ch-line)" }}
            value={frequency}
            onChange={(e) => setFrequency(e.target.value)}
          >
            {FREQUENCY_OPTIONS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm sm:col-span-2" style={{ color: "var(--ch-ink)" }}>
          First due date
          <input
            type="date"
            className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
            style={{ borderColor: "var(--ch-line)" }}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </label>
      </div>

      <button
        onClick={submit}
        disabled={pending || !templateId || !siteName.trim()}
        className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50 mt-4"
      >
        {pending ? "Creating…" : "Create schedule"}
      </button>

      {error && (
        <div
          className="text-sm mt-3 rounded-lg px-3 py-2"
          style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
