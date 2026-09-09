"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function DuplicateInspection({
  templateId,
  siteId,
  orgId,
}: {
  templateId: string;
  siteId: string;
  orgId: string;
}) {
  const [busy, setBusy] = useState(false);

  const duplicate = async () => {
    setBusy(true);
    const supabase = createClient();
    const { data: auth } = await supabase.auth.getUser();

    const { data, error } = await supabase
      .from("inspections")
      .insert({
        org_id: orgId,
        template_id: templateId,
        site_id: siteId,
        inspector_id: auth.user?.id,
        status: "in_progress",
      })
      .select("id")
      .single();

    if (error) {
      alert(error.message);
      setBusy(false);
      return;
    }
    window.location.href = `/inspections/${data.id}`;
  };

  return (
    <button
      onClick={duplicate}
      disabled={busy}
      className="text-xs font-semibold rounded-lg px-3 py-2 border disabled:opacity-50"
      style={{ borderColor: "var(--ch-line)", color: "var(--ch-navy)" }}
    >
      {busy ? "Duplicating…" : "Duplicate as new inspection"}
    </button>
  );
}
