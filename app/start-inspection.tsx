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
      <button onClick={() => setOpen(true)} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-bold">
        Start inspection
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <input
        autoFocus
        className="border rounded-lg px-3 py-2 text-sm w-44"
        style={{ borderColor: "var(--ch-line)" }}
        placeholder="Site / location name"
        value={site}
        onChange={(e) => setSite(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && start()}
      />
      <button onClick={start} disabled={busy} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
        {busy ? "…" : "Go"}
      </button>
      <button onClick={() => { setOpen(false); setError(null); }} className="text-sm px-2" style={{ color: "var(--ch-sub)" }}>
        Cancel
      </button>
      {error && <span className="text-xs w-full" style={{ color: "var(--ch-fail)" }}>{error}</span>}
    </div>
  );
}
