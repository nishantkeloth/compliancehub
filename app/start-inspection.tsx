"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function StartInspection({
  templateId,
  orgId,
}: {
  templateId: string;
  orgId: string;
}) {
  const [open, setOpen] = useState(false);
  const [site, setSite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    if (!site.trim()) {
      setError("Enter a site or location name");
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();

    // Find or create the site by name within the org
    let { data: siteRow } = await supabase
      .from("sites")
      .select("id")
      .eq("org_id", orgId)
      .ilike("name", site.trim())
      .maybeSingle();

    if (!siteRow) {
      const { data, error: sErr } = await supabase
        .from("sites")
        .insert({ org_id: orgId, name: site.trim() })
        .select("id")
        .single();
      if (sErr) {
        setError(sErr.message);
        setBusy(false);
        return;
      }
      siteRow = data;
    }

    const { data: auth } = await supabase.auth.getUser();
    const { data: insp, error: iErr } = await supabase
      .from("inspections")
      .insert({
        org_id: orgId,
        template_id: templateId,
        site_id: siteRow!.id,
        inspector_id: auth.user?.id,
        status: "in_progress",
      })
      .select("id")
      .single();

    if (iErr) {
      setError(iErr.message);
      setBusy(false);
      return;
    }
    window.location.href = `/inspections/${insp!.id}`;
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="bg-amber-400 hover:bg-amber-500 text-neutral-900 rounded-lg px-4 py-2 text-sm font-bold"
      >
        Start inspection
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <input
        autoFocus
        className="border border-neutral-300 rounded-lg px-3 py-2 text-sm w-44"
        placeholder="Site / location name"
        value={site}
        onChange={(e) => setSite(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && start()}
      />
      <button
        onClick={start}
        disabled={busy}
        className="bg-neutral-900 text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
      >
        {busy ? "…" : "Go"}
      </button>
      <button
        onClick={() => { setOpen(false); setError(null); }}
        className="text-sm text-neutral-500 px-2"
      >
        Cancel
      </button>
      {error && <span className="text-xs text-red-600 w-full">{error}</span>}
    </div>
  );
}
