"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function ActionRow({
  action,
  overdue,
}: {
  action: any;
  overdue: boolean;
}) {
  const [owner, setOwner] = useState(action.owner_name ?? "");
  const [due, setDue] = useState(action.due_date);
  const [status, setStatus] = useState(action.status);
  const [busy, setBusy] = useState(false);

  const save = async (patch: Record<string, any>) => {
    setBusy(true);
    const supabase = createClient();
    await supabase.from("corrective_actions").update(patch).eq("id", action.id);
    setBusy(false);
  };

  const closeOut = async () => {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("corrective_actions")
      .update({ status: "closed", closed_at: new Date().toISOString() })
      .eq("id", action.id);
    setBusy(false);
    if (!error) setStatus("closed");
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
          </div>
        </div>

        {status !== "closed" ? (
          <div className="flex items-center gap-2 flex-wrap">
            <input
              className="border rounded-lg px-3 py-2 text-xs w-36"
              style={{ borderColor: "var(--ch-line)" }}
              placeholder="Owner"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              onBlur={() => save({ owner_name: owner })}
            />
            <input
              type="date"
              className="border rounded-lg px-3 py-2 text-xs"
              style={{ borderColor: "var(--ch-line)" }}
              value={due}
              onChange={(e) => { setDue(e.target.value); save({ due_date: e.target.value }); }}
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
            className="text-xs font-bold uppercase rounded-full px-3 py-1"
            style={{ background: "var(--ch-pass-bg)", color: "var(--ch-pass)" }}
          >
            Verified & closed
          </span>
        )}
      </div>
    </div>
  );
}
