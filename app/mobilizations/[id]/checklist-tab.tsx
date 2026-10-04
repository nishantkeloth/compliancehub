"use client";

// Phase 12 — per-position onboarding checklist, following whichever
// track (client-configured pathway, e.g. "New Joiner" vs "Returning
// Crew") was assigned to that position. See
// claude/phase12-adnoc-mobilization-flow-scope.md for the design.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setPositionTrack, updateChecklistItemStatus, updatePlannedArrival, refreshPositionSteps } from "../actions";
import { VISA_TYPES, VISA_LABEL } from "../visa-types";

export type ChecklistItem = {
  id: string;
  mobilization_position_id: string;
  sequence: number;
  title: string;
  description: string | null;
  is_parallel: boolean;
  due_date: string | null;
  status: string;
  completed_at: string | null;
};
export type Track = { id: string; client_id: string | null; name: string };
export type ChecklistPosition = {
  id: string;
  job_role_name: string;
  position_sequence: number;
  selected_crew_id: string | null;
  selected_crew_name: string | null;
  mobilization_track_id: string | null;
  visa_type: string | null;
  planned_arrival_date: string | null;
  required_onboard_date: string | null;
};

const cardCls = "bg-white border rounded-xl";
const cardStyle = { borderColor: "var(--ch-line)" };
const inputCls = "border rounded-lg px-3 py-2 text-sm";
const inputStyle = { borderColor: "var(--ch-line)" };

const STATUS_LABEL: Record<string, string> = { pending: "Pending", in_progress: "In progress", done: "Done", blocked: "Blocked" };
const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  pending: { bg: "var(--ch-paper)", fg: "var(--ch-sub)" },
  in_progress: { bg: "#fef3e2", fg: "#b45309" },
  done: { bg: "var(--ch-pass-bg)", fg: "var(--ch-pass)" },
  blocked: { bg: "var(--ch-fail-bg)", fg: "var(--ch-fail)" },
};

function dueBadge(dueDate: string | null, status: string) {
  if (!dueDate) return null;
  const today = new Date().toISOString().slice(0, 10);
  const overdue = status !== "done" && dueDate < today;
  const soon = status !== "done" && !overdue && dueDate <= new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const { bg, fg } = overdue
    ? { bg: "var(--ch-fail-bg)", fg: "var(--ch-fail)" }
    : soon
      ? { bg: "#fef3e2", fg: "#b45309" }
      : { bg: "var(--ch-paper)", fg: "var(--ch-sub)" };
  return (
    <span className="text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5" style={{ background: bg, color: fg }}>
      due {dueDate}
    </span>
  );
}

export default function ChecklistTab({
  requestId,
  positions,
  tracks,
  checklistItems,
  canManage,
}: {
  requestId: string;
  positions: ChecklistPosition[];
  tracks: Track[];
  checklistItems: ChecklistItem[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // People who still need a pathway start open (they need action); people
  // with a checklist start collapsed so a long list stays scannable.
  const [openIds, setOpenIds] = useState<Set<string>>(
    () => new Set(positions.filter((p) => p.selected_crew_id && !p.mobilization_track_id).map((p) => p.id))
  );
  const toggleOpen = (id: string) =>
    setOpenIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const run = (fn: () => Promise<{ error?: string; count?: number } | undefined>, okMessage?: (count: number) => string) => {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await fn();
      if (res?.error) {
        setError(res.error);
        return;
      }
      if (okMessage) setNotice(okMessage(res?.count ?? 0));
      router.refresh();
    });
  };

  const staffedPositions = positions.filter((p) => p.selected_crew_id);

  if (staffedPositions.length === 0) {
    return <div className="text-sm" style={{ color: "var(--ch-sub)" }}>Select a candidate for a position first — the checklist follows whoever is selected.</div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-sm mb-1" style={{ color: "var(--ch-fail)" }}>{error}</div>}
      {notice && <div className="text-sm mb-1" style={{ color: "var(--ch-pass)" }}>{notice}</div>}
      {tracks.length === 0 && canManage && (
        <div className="text-sm rounded-lg px-3 py-2" style={{ background: "var(--ch-paper)", color: "var(--ch-sub)" }}>
          No mobilization tracks yet — add one under Administration → Mobilization Tracks.
        </div>
      )}
      {staffedPositions.length > 1 && (
        <div className="flex items-center gap-2 justify-end">
          <button
            onClick={() => setOpenIds(new Set(staffedPositions.map((p) => p.id)))}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold border"
            style={{ borderColor: "var(--ch-line)" }}
          >
            Expand all
          </button>
          <button onClick={() => setOpenIds(new Set())} className="rounded-lg px-3 py-1.5 text-xs font-semibold border" style={{ borderColor: "var(--ch-line)" }}>
            Collapse all
          </button>
        </div>
      )}
      {staffedPositions.map((p) => {
        const items = checklistItems.filter((c) => c.mobilization_position_id === p.id).sort((a, b) => a.sequence - b.sequence);
        const track = tracks.find((t) => t.id === p.mobilization_track_id) ?? null;
        const doneCount = items.filter((i) => i.status === "done").length;
        const today = new Date().toISOString().slice(0, 10);
        const openItems = items.filter((i) => i.status !== "done");
        const overdueCount = openItems.filter((i) => i.due_date && i.due_date < today).length;
        const nextDue = openItems.map((i) => i.due_date).filter((d): d is string => !!d && d >= today).sort()[0] ?? null;
        const isOpen = openIds.has(p.id);
        return (
          <div key={p.id} className={`${cardCls} p-4`} style={cardStyle}>
            <button
              type="button"
              onClick={() => toggleOpen(p.id)}
              aria-expanded={isOpen}
              className="flex items-center gap-2 flex-wrap w-full text-left"
            >
              <svg viewBox="0 0 20 20" aria-hidden="true" className="w-4 h-4 shrink-0" style={{ transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .15s", color: "var(--ch-sub)" }}>
                <path d="M7 4l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="text-[10px] font-mono font-bold rounded px-1.5 py-0.5" style={{ background: "var(--ch-navy-soft)", color: "var(--ch-navy)" }}>
                #{p.position_sequence}
              </span>
              <span className="text-sm font-semibold" style={{ color: "var(--ch-ink)" }}>{p.job_role_name}</span>
              <span className="text-sm" style={{ color: "var(--ch-ink)" }}>{p.selected_crew_name}</span>
              {track && <span className="text-xs" style={{ color: "var(--ch-sub)" }}>· {track.name}</span>}
              {p.visa_type && <span className="text-xs" style={{ color: "var(--ch-sub)" }}>· {VISA_LABEL[p.visa_type] ?? p.visa_type} visa</span>}
              {items.length > 0 && <Roadmap items={items} today={today} />}
              <span className="ml-auto flex items-center gap-2">
                {overdueCount > 0 && (
                  <span className="text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>
                    {overdueCount} overdue
                  </span>
                )}
                {nextDue && !isOpen && (
                  <span className="text-xs" style={{ color: "var(--ch-sub)" }}>next due {nextDue}</span>
                )}
                {items.length > 0 && (
                  <span className="text-xs" style={{ color: "var(--ch-sub)" }}>
                    {doneCount}/{items.length} done
                  </span>
                )}
                {!p.mobilization_track_id && (
                  <span className="text-xs" style={{ color: "var(--ch-sub)" }}>no pathway yet</span>
                )}
              </span>
            </button>
            {isOpen && (
            <div className="mt-2 space-y-2">
            {!p.mobilization_track_id ? (
              canManage ? (
                <TrackPicker
                  tracks={tracks}
                  defaultArrival={p.required_onboard_date}
                  onAssign={(trackId, visa, arrival) => run(() => setPositionTrack(p.id, requestId, trackId, visa, arrival))}
                />
              ) : (
                <div className="text-xs" style={{ color: "var(--ch-sub)" }}>No track assigned yet.</div>
              )
            ) : (
              <ArrivalDate
                value={p.planned_arrival_date}
                canManage={canManage}
                onSave={(d) => run(() => updatePlannedArrival(p.id, requestId, d))}
              />
            )}
            {p.mobilization_track_id && canManage && (
              <div className="flex items-center gap-2 flex-wrap mt-2">
                {items.length === 0 && (
                  <span className="text-xs" style={{ color: "var(--ch-sub)" }}>
                    No steps yet. Add steps to this pathway in Mobilization Tracks, then click Refresh steps.
                  </span>
                )}
                <button
                  onClick={() =>
                    run(
                      () => refreshPositionSteps(p.id, requestId),
                      (n) => (n === 0 ? "Nothing to add. This checklist already has every step that applies." : `Added ${n} step${n === 1 ? "" : "s"} to ${p.selected_crew_name ?? "this person"}.`)
                    )
                  }
                  className="rounded-lg px-3 py-1.5 text-xs font-semibold border"
                  style={{ borderColor: "var(--ch-line)" }}
                >
                  Refresh steps from pathway
                </button>
              </div>
            )}
            {p.mobilization_track_id && items.length > 0 && (
              <div className="space-y-1.5 mt-2">
                {items.map((item) => (
                  <div key={item.id} data-s={item.status} className="ch-st-row flex items-start gap-2 flex-wrap text-sm rounded-lg px-2.5 py-1.5">
                    <span className="ch-st-dot shrink-0 rounded-full mt-1.5" style={{ width: 9, height: 9 }} />
                    <span className="text-[10px] font-mono rounded px-1 py-0.5 mt-0.5" style={{ background: "var(--ch-paper)", color: "var(--ch-sub)" }}>
                      {item.sequence}
                    </span>
                    <div className="flex-1 min-w-[160px]">
                      <div className="font-medium" style={{ color: "var(--ch-ink)" }}>
                        {item.title}
                        {item.is_parallel && <span className="ml-1 text-[10px]" style={{ color: "var(--ch-sub)" }}>(parallel)</span>}
                      </div>
                      {item.description && <div className="text-xs" style={{ color: "var(--ch-sub)" }}>{item.description}</div>}
                    </div>
                    {dueBadge(item.due_date, item.status)}
                    {canManage ? (
                      <select
                        className={`ch-st-select ${inputCls} text-xs py-1`}
                        data-s={item.status}
                        value={item.status}
                        onChange={(e) => run(() => updateChecklistItemStatus(item.id, requestId, e.target.value as "pending" | "in_progress" | "done" | "blocked"))}
                      >
                        {Object.entries(STATUS_LABEL).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    ) : (
                      <span
                        className="text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5"
                        style={{ background: STATUS_COLORS[item.status].bg, color: STATUS_COLORS[item.status].fg }}
                      >
                        {STATUS_LABEL[item.status]}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
            </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ArrivalDate({ value, canManage, onSave }: { value: string | null; canManage: boolean; onSave: (date: string) => void }) {
  const [date, setDate] = useState(value ?? "");
  if (!canManage) {
    return <div className="text-xs" style={{ color: "var(--ch-sub)" }}>Planned arrival: {value ?? "not set"}</div>;
  }
  return (
    <div className="flex items-center gap-2 flex-wrap text-xs" style={{ color: "var(--ch-sub)" }}>
      <label className="flex items-center gap-2">
        Planned arrival
        <input type="date" className={`${inputCls} py-1`} style={inputStyle} value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      {date && date !== (value ?? "") && (
        <button onClick={() => onSave(date)} className="ch-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold">
          {value ? "Update date" : "Set date"}
        </button>
      )}
    </div>
  );
}

function TrackPicker({
  tracks,
  defaultArrival,
  onAssign,
}: {
  tracks: Track[];
  defaultArrival: string | null;
  onAssign: (trackId: string, visaType: string | null, plannedArrivalDate: string | null) => void;
}) {
  const [trackId, setTrackId] = useState("");
  const [visa, setVisa] = useState("");
  const [arrival, setArrival] = useState(defaultArrival ?? "");
  if (tracks.length === 0) return <div className="text-xs" style={{ color: "var(--ch-sub)" }}>No tracks available to assign.</div>;
  return (
    <div className="flex items-end gap-2 flex-wrap">
      <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
        Pathway
        <select className={`${inputCls} block mt-1`} style={inputStyle} value={trackId} onChange={(e) => setTrackId(e.target.value)}>
          <option value="">Choose a pathway…</option>
          {tracks.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </label>
      <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
        Visa type
        <select className={`${inputCls} block mt-1`} style={inputStyle} value={visa} onChange={(e) => setVisa(e.target.value)}>
          <option value="">Choose…</option>
          {VISA_TYPES.map((v) => (
            <option key={v} value={v}>{VISA_LABEL[v]}</option>
          ))}
        </select>
      </label>
      <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
        Planned arrival date
        <input type="date" className={`${inputCls} block mt-1`} style={inputStyle} value={arrival} onChange={(e) => setArrival(e.target.value)} />
      </label>
      <button
        onClick={() => trackId && onAssign(trackId, visa || null, arrival || null)}
        disabled={!trackId || !visa}
        className="ch-btn-primary rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50"
      >
        Create checklist
      </button>
    </div>
  );
}


const ROAD_COLORS: Record<string, { fill: string; border: string; text: string }> = {
  done: { fill: "#16a34a", border: "#16a34a", text: "#ffffff" },
  in_progress: { fill: "#fff6e5", border: "#d97706", text: "#92400e" },
  blocked: { fill: "#fef2f2", border: "#dc2626", text: "#b91c1c" },
  pending: { fill: "#ffffff", border: "#9ca3af", text: "#4b5563" },
};
const ROAD_LABEL: Record<string, string> = { done: "Done", in_progress: "In progress", blocked: "Blocked", pending: "Pending" };

// A compact step-by-step road map for one person, shown in the collapsed
// header: one numbered dot per checklist step, coloured by status and
// joined by a line that turns green as steps complete. A red outer ring
// marks a step that is past due; the first step not yet done is the
// current one and gets a heavier outline. Hover a dot for its name and
// due date.
function Roadmap({ items, today }: { items: { id: string; title: string; status: string; due_date: string | null }[]; today: string }) {
  const currentIdx = items.findIndex((i) => i.status !== "done");
  const done = items.filter((i) => i.status === "done").length;
  const label = currentIdx === -1 ? `All ${items.length} steps done` : `${done} of ${items.length} steps done, step ${currentIdx + 1} is next: ${items[currentIdx].title}`;
  return (
    <span role="img" aria-label={label} className="flex items-center mx-3 flex-1 overflow-x-auto" style={{ minWidth: 200 }}>
      {items.map((it, idx) => {
        const c = ROAD_COLORS[it.status] ?? ROAD_COLORS.pending;
        const late = it.status !== "done" && !!it.due_date && it.due_date < today;
        const current = idx === currentIdx;
        return (
          <span key={it.id} className="flex items-center shrink-0">
            {idx > 0 && <span aria-hidden="true" style={{ width: 10, height: 2, background: items[idx - 1].status === "done" ? "#16a34a" : "var(--ch-line)" }} />}
            <span
              title={`${idx + 1}. ${it.title} — ${ROAD_LABEL[it.status] ?? it.status}${it.due_date ? `, due ${it.due_date}` : ""}${late ? " (overdue)" : ""}`}
              className="inline-flex items-center justify-center rounded-full text-[9px] font-bold tabular-nums"
              style={{
                width: 18,
                height: 18,
                background: c.fill,
                color: c.text,
                border: `${current ? 2 : 1}px solid ${c.border}`,
                boxShadow: late ? "0 0 0 2px #fbc5c5" : undefined,
              }}
            >
              {it.status === "done" ? "✓" : idx + 1}
            </span>
          </span>
        );
      })}
    </span>
  );
}
