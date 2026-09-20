"use client";

// Phase 12 — per-position onboarding checklist, following whichever
// track (client-configured pathway, e.g. "New Joiner" vs "Returning
// Crew") was assigned to that position. See
// claude/phase12-adnoc-mobilization-flow-scope.md for the design.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setPositionTrack, updateChecklistItemStatus } from "../actions";

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

  const run = (fn: () => Promise<{ error?: string } | undefined>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res?.error) {
        setError(res.error);
        return;
      }
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
      {tracks.length === 0 && canManage && (
        <div className="text-sm rounded-lg px-3 py-2" style={{ background: "var(--ch-paper)", color: "var(--ch-sub)" }}>
          No mobilization tracks configured for this client yet — set them up under Mobilizations → Mobilization Tracks.
        </div>
      )}
      {staffedPositions.map((p) => {
        const items = checklistItems.filter((c) => c.mobilization_position_id === p.id).sort((a, b) => a.sequence - b.sequence);
        const track = tracks.find((t) => t.id === p.mobilization_track_id) ?? null;
        const doneCount = items.filter((i) => i.status === "done").length;
        return (
          <div key={p.id} className={`${cardCls} p-4`} style={cardStyle}>
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <span className="text-[10px] font-mono font-bold rounded px-1.5 py-0.5" style={{ background: "var(--ch-navy-soft)", color: "var(--ch-navy)" }}>
                #{p.position_sequence}
              </span>
              <span className="text-sm font-semibold" style={{ color: "var(--ch-ink)" }}>{p.job_role_name}</span>
              <span className="text-sm" style={{ color: "var(--ch-ink)" }}>{p.selected_crew_name}</span>
              {track && <span className="text-xs" style={{ color: "var(--ch-sub)" }}>· {track.name}</span>}
              {items.length > 0 && (
                <span className="text-xs ml-auto" style={{ color: "var(--ch-sub)" }}>
                  {doneCount}/{items.length} done
                </span>
              )}
            </div>

            {!p.mobilization_track_id ? (
              canManage ? (
                <TrackPicker
                  tracks={tracks}
                  onAssign={(trackId) => run(() => setPositionTrack(p.id, requestId, trackId))}
                />
              ) : (
                <div className="text-xs" style={{ color: "var(--ch-sub)" }}>No track assigned yet.</div>
              )
            ) : items.length === 0 ? (
              <div className="text-xs" style={{ color: "var(--ch-sub)" }}>This track has no checklist steps configured.</div>
            ) : (
              <div className="space-y-1.5 mt-2">
                {items.map((item) => (
                  <div key={item.id} className="flex items-start gap-2 flex-wrap text-sm border rounded-lg px-2.5 py-1.5" style={{ borderColor: "var(--ch-line)" }}>
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
                        className={`${inputCls} text-xs py-1`}
                        style={{ ...inputStyle, ...STATUS_COLORS[item.status] }}
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
        );
      })}
    </div>
  );
}

function TrackPicker({ tracks, onAssign }: { tracks: Track[]; onAssign: (trackId: string) => void }) {
  const [trackId, setTrackId] = useState("");
  if (tracks.length === 0) return <div className="text-xs" style={{ color: "var(--ch-sub)" }}>No tracks available to assign.</div>;
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select className={`${inputCls}`} style={inputStyle} value={trackId} onChange={(e) => setTrackId(e.target.value)}>
        <option value="">Choose a track…</option>
        {tracks.map((t) => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
      </select>
      <button
        onClick={() => trackId && onAssign(trackId)}
        disabled={!trackId}
        className="ch-btn-primary rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50"
      >
        Assign track
      </button>
    </div>
  );
}
