"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Member = { id: string; full_name: string | null };

export default function ActionRow({
  action,
  overdue,
  canManage,
  members,
}: {
  action: any;
  overdue: boolean;
  canManage: boolean;
  members: Member[];
}) {
  const [ownerId, setOwnerId] = useState<string>(action.owner_id ?? "");
  const [ownerName, setOwnerName] = useState<string | null>(action.owner_name ?? null);
  const [due, setDue] = useState(action.due_date);
  const [status, setStatus] = useState(action.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (patch: Record<string, any>) => {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: err } = await supabase.from("corrective_actions").update(patch).eq("id", action.id);
    setBusy(false);
    if (err) setError(err.message);
  };

  const assign = (newOwnerId: string) => {
    const member = members.find((m) => m.id === newOwnerId);
    const newOwnerName = member?.full_name ?? null;
    setOwnerId(newOwnerId);
    setOwnerName(newOwnerName);
    save({ owner_id: newOwnerId || null, owner_name: newOwnerName });
  };

  const closeOut = async () => {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: err } = await supabase
      .from("corrective_actions")
      .update({ status: "closed", closed_at: new Date().toISOString() })
      .eq("id", action.id);
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setStatus("closed");
  };

  const borderColor =
    status === "closed" ? "var(--ch-pass)" : overdue ? "var(--ch-fail)" : "var(--ch-navy)";

  // inspection_responses comes back as an object or array depending on
  // Supabase's join inference — handle both.
  const rawPhotos = Array.isArray(action.inspection_responses)
    ? action.inspection_responses[0]?.photo_urls
    : action.inspection_responses?.photo_urls;
  const photos: string[] = rawPhotos ?? [];

  return (
    <div
      className="bg-white border rounded-xl p-4"
      style={{ borderColor: "var(--ch-line)", borderLeft: `4px solid ${borderColor}` }}
    >
      <div className="flex items-start gap-3 flex-wrap">
        {photos.length > 0 && (
          <a href={photos[0]} target="_blank" rel="noopener noreferrer" className="shrink-0">
            <img
              src={photos[0]}
              alt="Finding photo"
              className="w-16 h-16 object-cover rounded-lg border"
              style={{ borderColor: "var(--ch-line)" }}
            />
          </a>
        )}
        <div className="flex-1 min-w-[220px]">
          <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--ch-sub)" }}>
            {action.sites?.name}
          </div>
          <div className="text-sm font-semibold mt-0.5" style={{ color: "var(--ch-ink)" }}>{action.title}</div>
          {action.finding && (
            <div className="text-sm" style={{ color: "var(--ch-sub)" }}>Finding: {action.finding}</div>
          )}
          <div
            className="text-xs mt-1 font-medium"
            style={{ color: status === "closed" ? "var(--ch-pass)" : overdue ? "var(--ch-fail)" : "var(--ch-sub)" }}
          >
            Due {due}
            {overdue && status !== "closed" ? " · OVERDUE" : ""}
            {status === "closed" && action.closed_at
              ? ` · Closed ${new Date(action.closed_at).toLocaleDateString()}`
              : ""}
            {status !== "closed" ? (ownerName ? ` · Assigned to ${ownerName}` : " · Unassigned") : ""}
          </div>
        </div>

        {status !== "closed" ? (
          canManage ? (
            <div className="flex items-center gap-2 flex-wrap">
              <select
                className="border rounded-lg px-3 py-2 text-xs w-40"
                style={{ borderColor: "var(--ch-line)" }}
                value={ownerId}
                onChange={(e) => assign(e.target.value)}
                disabled={busy}
              >
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.full_name ?? "Unnamed"}
                  </option>
                ))}
              </select>
              <input
                type="date"
                className="border rounded-lg px-3 py-2 text-xs"
                style={{ borderColor: "var(--ch-line)" }}
                value={due}
                onChange={(e) => {
                  setDue(e.target.value);
                  save({ due_date: e.target.value });
                }}
              />
              <button
                onClick={closeOut}
                disabled={busy}
                className="ch-btn-primary rounded-lg px-3 py-2 text-xs font-bold disabled:opacity-50"
              >
                Close out
              </button>
            </div>
          ) : (
            <span
              className="text-xs font-semibold uppercase rounded-full px-3 py-1"
              style={
                overdue
                  ? { background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }
                  : { background: "#f3f4f6", color: "var(--ch-sub)" }
              }
            >
              {status === "in_progress" ? "In progress" : "Open"}
            </span>
          )
        ) : (
          <span
            className="text-xs font-bold uppercase rounded-full px-3 py-1"
            style={{ background: "var(--ch-pass-bg)", color: "var(--ch-pass)" }}
          >
            Verified & closed
          </span>
        )}
      </div>
      {error && (
        <div className="text-xs mt-2" style={{ color: "var(--ch-fail)" }}>
          {error}
        </div>
      )}
    </div>
  );
}
