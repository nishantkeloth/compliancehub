"use client";

import { useState } from "react";
import Link from "next/link";

type Insp = {
  id: string;
  status: string;
  score_pct: number | null;
  started_at: string;
  submitted_at: string | null;
  templates: { code: string; name: string } | null;
  sites: { name: string } | null;
};

function scoreTone(pct: number | null) {
  const p = pct ?? 0;
  if (p >= 90) return { bg: "var(--ch-pass-bg)", fg: "var(--ch-pass)" };
  if (p >= 75) return { bg: "#fef3e2", fg: "#b45309" };
  return { bg: "var(--ch-fail-bg)", fg: "var(--ch-fail)" };
}

export default function InspectionsPanel({ inspections }: { inspections: Insp[] }) {
  const [view, setView] = useState<"list" | "grid">("list");
  const [exporting, setExporting] = useState(false);

  const exportExcel = async () => {
    setExporting(true);
    try {
      const XLSX = await import("xlsx");
      const rows = inspections.map((i) => ({
        "Template Code": i.templates?.code ?? "",
        "Template Name": i.templates?.name ?? "",
        Site: i.sites?.name ?? "",
        Status: i.status,
        "Score %": i.score_pct != null ? Math.round(i.score_pct) : "",
        Started: new Date(i.started_at).toLocaleString(),
        Submitted: i.submitted_at ? new Date(i.submitted_at).toLocaleString() : "",
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Inspections");
      XLSX.writeFile(wb, `compliancehub-inspections-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--ch-sub)" }}>
          Recent inspections
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={exportExcel}
            disabled={exporting || inspections.length === 0}
            className="text-xs font-semibold rounded-lg px-3 py-1.5 border disabled:opacity-40"
            style={{ borderColor: "var(--ch-line)", color: "var(--ch-navy)" }}
          >
            {exporting ? "Exporting…" : "Export Excel"}
          </button>
          <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: "var(--ch-line)" }}>
            <button
              onClick={() => setView("list")}
              className="text-xs font-semibold px-3 py-1.5"
              style={view === "list" ? { background: "var(--ch-navy)", color: "#fff" } : { color: "var(--ch-sub)" }}
            >
              List
            </button>
            <button
              onClick={() => setView("grid")}
              className="text-xs font-semibold px-3 py-1.5"
              style={view === "grid" ? { background: "var(--ch-navy)", color: "#fff" } : { color: "var(--ch-sub)" }}
            >
              Grid
            </button>
          </div>
        </div>
      </div>

      {inspections.length === 0 ? (
        <div className="bg-white border rounded-xl p-6 text-sm" style={{ borderColor: "var(--ch-line)", color: "var(--ch-sub)" }}>
          No inspections yet — start one from a template above.
        </div>
      ) : view === "list" ? (
        <div className="space-y-2">
          {inspections.map((i) => {
            const tone = scoreTone(i.score_pct);
            return (
              <Link
                key={i.id}
                href={`/inspections/${i.id}`}
                className="bg-white border rounded-xl p-4 flex items-center justify-between gap-3 block hover:border-[color:var(--ch-navy)] transition-colors"
                style={{ borderColor: "var(--ch-line)" }}
              >
                <div>
                  <div className="font-medium text-sm" style={{ color: "var(--ch-ink)" }}>
                    {i.templates?.code} — {i.sites?.name}
                  </div>
                  <div className="text-xs" style={{ color: "var(--ch-sub)" }}>
                    {new Date(i.started_at).toLocaleString()}
                  </div>
                </div>
                {i.status === "in_progress" ? (
                  <span className="text-xs font-semibold uppercase rounded-full px-3 py-1 ch-badge-navy">
                    In progress
                  </span>
                ) : (
                  <span
                    className="text-xs font-bold rounded-full px-3 py-1"
                    style={{ background: tone.bg, color: tone.fg }}
                  >
                    {Math.round(i.score_pct ?? 0)}%
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {inspections.map((i) => {
            const tone = scoreTone(i.score_pct);
            return (
              <Link
                key={i.id}
                href={`/inspections/${i.id}`}
                className="bg-white border rounded-xl p-4 flex flex-col gap-2 hover:border-[color:var(--ch-navy)] transition-colors"
                style={{ borderColor: "var(--ch-line)" }}
              >
                <div
                  className="w-full aspect-square rounded-lg flex items-center justify-center text-2xl font-extrabold"
                  style={i.status === "in_progress" ? { background: "var(--ch-navy-soft)", color: "var(--ch-navy)" } : { background: tone.bg, color: tone.fg }}
                >
                  {i.status === "in_progress" ? "…" : `${Math.round(i.score_pct ?? 0)}%`}
                </div>
                <div className="text-xs font-semibold truncate" style={{ color: "var(--ch-ink)" }}>
                  {i.templates?.code}
                </div>
                <div className="text-xs truncate" style={{ color: "var(--ch-sub)" }}>
                  {i.sites?.name}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
