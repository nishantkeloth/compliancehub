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
    status === "closed" ? "border-green-600" : overdue ? "border-red-600" : "border-amber-400";

  return (
    <div
      className="bg-white border border-neutral-200 rounded-xl p-4"
      style={{ borderLeft: `4px solid`, borderLeftColor: borderColor.replace("border-", "") }}
    >
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-[220px]">
          <div className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
            {action.sites?.name}
          </div>
          <div className="text-sm font-semibold text-neutral-900 mt-0.5">{action.title}</div>
          {action.finding && (
            <div className="text-sm text-neutral-500">Finding: {action.finding}</div>
          )}
          <div
            className={`text-xs mt-1 font-medium ${
              status === "closed"
                ? "text-green-700"
                : overdue
                ? "text-red-600 font-bold"
                : "text-neutral-500"
            }`}
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
              className="border border-neutral-300 rounded-lg px-3 py-2 text-xs w-36"
              placeholder="Owner"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              onBlur={() => save({ owner_name: owner })}
            />
            <input
              type="date"
              className="border border-neutral-300 rounded-lg px-3 py-2 text-xs"
              value={due}
              onChange={(e) => { setDue(e.target.value); save({ due_date: e.target.value }); }}
            />
            <button
              onClick={closeOut}
              disabled={busy}
              className="bg-neutral-900 text-white rounded-lg px-3 py-2 text-xs font-bold disabled:opacity-50"
            >
              Close out
            </button>
          </div>
        ) : (
          <span className="text-xs font-bold uppercase bg-green-100 text-green-800 rounded-full px-3 py-1">
            Verified & closed
          </span>
        )}
      </div>
    </div>
  );
}
