"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { StatusPill } from "@/app/contracts/contracts-manager";
import {
  getVersionsOverview,
  compareVersions,
  getChangeSummary,
  type VersionOverviewRow,
  type Comparison,
  type ChangeSummaryView,
} from "./change-actions";
import { totalChanges, type LineChange } from "@/lib/matrix-diff";

const cardCls = "bg-white border rounded-xl";
const cardStyle = { borderColor: "var(--ch-line)" };
const OK = "var(--ch-ok, #1a7f37)";
const FAIL = "var(--ch-fail, #b91c1c)";
const WARN = "var(--ch-warn, #b45309)";

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/* ================= Versions tab ================= */

export function VersionsPanel({ matrixId }: { matrixId: string }) {
  const [rows, setRows] = useState<VersionOverviewRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [cmpError, setCmpError] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);

  const runCompare = async (a: string, b: string) => {
    setCmpError(null);
    setComparing(true);
    const res = await compareVersions(a, b);
    setComparing(false);
    if (res.error || !res.comparison) {
      setComparison(null);
      setCmpError(res.error ?? "Could not compare those versions.");
      return;
    }
    setComparison(res.comparison);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await getVersionsOverview(matrixId);
      if (cancelled) return;
      if (res.error || !res.rows) {
        setLoadError(res.error ?? "Could not load the versions.");
        return;
      }
      setRows(res.rows);
      // Open on the most useful comparison: this version against the one before it.
      const idx = res.rows.findIndex((r) => r.id === matrixId);
      const prev = idx >= 0 ? res.rows[idx + 1] : undefined; // rows are newest first
      if (prev) {
        setFromId(prev.id);
        setToId(matrixId);
        setComparing(true);
        const cmp = await compareVersions(prev.id, matrixId);
        if (cancelled) return;
        setComparing(false);
        if (cmp.comparison) setComparison(cmp.comparison);
        else setCmpError(cmp.error ?? null);
      } else if (res.rows.length > 1) {
        setToId(matrixId);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [matrixId]);

  if (loadError) return <div className="text-sm" style={{ color: FAIL }}>{loadError}</div>;
  if (!rows) return <div className="text-sm" style={{ color: "var(--ch-sub)" }}>Loading versions…</div>;

  const compareWithPrevious = (i: number) => {
    const prev = rows[i + 1];
    if (!prev) return;
    setFromId(prev.id);
    setToId(rows[i].id);
    void runCompare(prev.id, rows[i].id);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {rows.map((v, i) => (
          <div
            key={v.id}
            className={`${cardCls} p-3`}
            style={v.id === matrixId ? { ...cardStyle, background: "var(--ch-navy-soft)" } : cardStyle}
          >
            <div className="flex items-center gap-3 flex-wrap">
              {v.id === matrixId ? (
                <span className="text-sm font-semibold" style={{ color: "var(--ch-ink)" }}>v{v.version_number} (this version)</span>
              ) : (
                <Link href={`/crew/matrices/${v.id}`} className="text-sm font-semibold ch-link-navy">v{v.version_number}</Link>
              )}
              <StatusPill status={v.status} />
              <span className="text-xs" style={{ color: "var(--ch-sub)" }}>
                {fmtDate(v.created_at)}
                {v.createdByName ? ` · ${v.createdByName}` : ""}
              </span>
              {v.totalChanges != null && (
                <span className="text-xs font-semibold rounded-full px-2 py-0.5" style={{ background: "var(--ch-navy-soft)", color: "var(--ch-navy)" }}>
                  {v.totalChanges} {v.totalChanges === 1 ? "change" : "changes"}
                </span>
              )}
              {rows[i + 1] && (
                <button type="button" onClick={() => compareWithPrevious(i)} className="ml-auto text-xs font-semibold ch-link-navy">
                  Compare with v{rows[i + 1].version_number}
                </button>
              )}
            </div>
            {v.reason && (
              <div className="text-xs mt-2" style={{ color: "var(--ch-sub)" }}>
                <span className="font-semibold">Reason:</span> {v.reason}
              </div>
            )}
          </div>
        ))}
      </div>

      {rows.length > 1 && (
        <div className={`${cardCls} p-4`} style={cardStyle}>
          <div className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--ch-sub)" }}>Compare versions</div>
          <div className="flex items-end gap-3 flex-wrap mb-3">
            <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
              From
              <select className="border rounded-lg px-3 py-2 text-sm block mt-1" style={{ borderColor: "var(--ch-line)" }} value={fromId} onChange={(e) => setFromId(e.target.value)}>
                <option value="">Select…</option>
                {rows.map((r) => <option key={r.id} value={r.id}>v{r.version_number} ({r.status.replace(/_/g, " ")})</option>)}
              </select>
            </label>
            <span className="pb-2 text-sm" style={{ color: "var(--ch-sub)" }}>→</span>
            <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
              To
              <select className="border rounded-lg px-3 py-2 text-sm block mt-1" style={{ borderColor: "var(--ch-line)" }} value={toId} onChange={(e) => setToId(e.target.value)}>
                <option value="">Select…</option>
                {rows.map((r) => <option key={r.id} value={r.id}>v{r.version_number} ({r.status.replace(/_/g, " ")})</option>)}
              </select>
            </label>
            <button
              type="button"
              disabled={!fromId || !toId || fromId === toId || comparing}
              onClick={() => void runCompare(fromId, toId)}
              className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
            >
              {comparing ? "Comparing…" : "Compare"}
            </button>
          </div>
          {cmpError && <div className="text-sm mb-2" style={{ color: FAIL }}>{cmpError}</div>}
          {comparison && <DiffView comparison={comparison} />}
        </div>
      )}
    </div>
  );
}

/* ================= The comparison itself ================= */

function Tag({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5" style={{ color, border: `1px solid ${color}` }}>
      {children}
    </span>
  );
}

function FromTo({ from, to }: { from: string; to: string }) {
  return (
    <span className="text-sm">
      <span style={{ color: "var(--ch-sub)", textDecoration: "line-through" }}>{from}</span>
      <span style={{ color: "var(--ch-sub)" }}> → </span>
      <span className="font-semibold" style={{ color: "var(--ch-ink)" }}>{to}</span>
    </span>
  );
}

function LineCard({ line, impact }: { line: LineChange; impact?: string[] }) {
  const color = line.status === "added" ? OK : line.status === "removed" ? FAIL : WARN;
  const word = line.status === "added" ? "Added" : line.status === "removed" ? "Removed" : "Changed";
  return (
    <div className="rounded-lg border p-3" style={{ borderColor: "var(--ch-line)", borderLeft: `4px solid ${color}` }}>
      <div className="flex items-center gap-2 flex-wrap">
        <Tag color={color}>{word}</Tag>
        <span className="text-sm font-semibold" style={{ color: "var(--ch-ink)" }}>Line {line.lineNumber} · {line.roleName}</span>
        {line.status === "added" && line.headcountTo != null && <span className="text-xs" style={{ color: "var(--ch-sub)" }}>Headcount {line.headcountTo}</span>}
        {line.status === "removed" && line.headcountFrom != null && <span className="text-xs" style={{ color: "var(--ch-sub)" }}>Headcount was {line.headcountFrom}</span>}
      </div>
      {(line.fields.length > 0 || line.sets.length > 0) && (
        <div className="mt-2 space-y-1">
          {line.fields.map((f) => (
            <div key={f.label} className="flex items-baseline gap-2 flex-wrap">
              <span className="text-xs w-44 shrink-0" style={{ color: "var(--ch-sub)" }}>{f.label}</span>
              <FromTo from={f.from} to={f.to} />
            </div>
          ))}
          {line.sets.map((s, i) => {
            const c = s.kind === "added" ? OK : s.kind === "removed" ? FAIL : WARN;
            const sign = s.kind === "added" ? "+" : s.kind === "removed" ? "−" : "~";
            return (
              <div key={`${s.group}-${s.label}-${i}`} className="flex items-baseline gap-2 flex-wrap">
                <span className="text-xs w-44 shrink-0" style={{ color: "var(--ch-sub)" }}>{s.group} {s.kind}</span>
                <span className="text-sm">
                  <span className="font-bold" style={{ color: c }}>{sign} </span>
                  <span style={{ color: "var(--ch-ink)" }}>{s.label}</span>
                  {s.detail && <span style={{ color: "var(--ch-sub)" }}> ({s.detail})</span>}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {impact && impact.length > 0 && (
        <div className="mt-2 text-xs rounded px-2 py-1.5" style={{ background: "var(--ch-warn-bg, #fff6e5)", color: WARN }}>
          Currently assigned in this role: {impact.join(", ")}. Decide what happens to them on the roster.
        </div>
      )}
    </div>
  );
}

export function DiffView({ comparison }: { comparison: Comparison }) {
  const { diff } = comparison;
  const total = totalChanges(diff);
  const impactByRole = new Map(comparison.impact.map((i) => [i.roleId, i.crewNames]));
  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className="text-sm font-semibold" style={{ color: "var(--ch-ink)" }}>
          v{comparison.fromVersion} → v{comparison.toVersion}
        </span>
        {total === 0 ? (
          <span className="text-sm" style={{ color: "var(--ch-sub)" }}>No differences.</span>
        ) : (
          <>
            <span className="text-xs font-semibold rounded-full px-2 py-0.5" style={{ background: "var(--ch-navy-soft)", color: "var(--ch-navy)" }}>{total} {total === 1 ? "change" : "changes"}</span>
            {diff.counts.linesAdded > 0 && <span className="text-xs font-semibold" style={{ color: OK }}>+{diff.counts.linesAdded} {diff.counts.linesAdded === 1 ? "line" : "lines"}</span>}
            {diff.counts.linesRemoved > 0 && <span className="text-xs font-semibold" style={{ color: FAIL }}>−{diff.counts.linesRemoved} {diff.counts.linesRemoved === 1 ? "line" : "lines"}</span>}
            {diff.counts.linesChanged > 0 && <span className="text-xs font-semibold" style={{ color: WARN }}>{diff.counts.linesChanged} edited</span>}
          </>
        )}
      </div>
      {comparison.toReason && (
        <div className="text-xs mb-3" style={{ color: "var(--ch-sub)" }}>
          <span className="font-semibold">Reason for v{comparison.toVersion}:</span> {comparison.toReason}
        </div>
      )}

      {diff.header.length > 0 && (
        <div className="rounded-lg border p-3 mb-3" style={{ borderColor: "var(--ch-line)", borderLeft: `4px solid ${WARN}` }}>
          <div className="flex items-center gap-2 mb-2"><Tag color={WARN}>Changed</Tag><span className="text-sm font-semibold" style={{ color: "var(--ch-ink)" }}>Matrix details</span></div>
          <div className="space-y-1">
            {diff.header.map((h) => (
              <div key={h.label} className="flex items-baseline gap-2 flex-wrap">
                <span className="text-xs w-44 shrink-0" style={{ color: "var(--ch-sub)" }}>{h.label}</span>
                <FromTo from={h.from} to={h.to} />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        {diff.lines.map((l, i) => (
          <LineCard key={`${l.roleId}-${l.status}-${i}`} line={l} impact={impactByRole.get(l.roleId)} />
        ))}
      </div>

      {diff.unchangedLines > 0 && (
        <div className="text-xs mt-3" style={{ color: "var(--ch-sub)" }}>
          {diff.unchangedLines} unchanged {diff.unchangedLines === 1 ? "line" : "lines"} not shown. Lines are matched by job role; skills, documents, competencies and client requirements are compared as sets, so reordering shows no change.
        </div>
      )}
    </div>
  );
}

/* ================= "What changed" panel for approvers ================= */

export function ChangeSummaryPanel({
  matrixId,
  versionNumber,
  openByDefault,
  onOpenComparison,
}: {
  matrixId: string;
  versionNumber: number;
  openByDefault: boolean;
  onOpenComparison: () => void;
}) {
  const [view, setView] = useState<ChangeSummaryView | null | undefined>(undefined);
  const [open, setOpen] = useState(openByDefault);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await getChangeSummary(matrixId);
      if (!cancelled) setView(res.view ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [matrixId]);

  if (versionNumber <= 1 || !view) return null;
  const sentences = view.summary.sentences;
  const shown = showAll ? sentences : sentences.slice(0, 8);

  return (
    <div className={`${cardCls} p-3 mt-4`} style={cardStyle}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between gap-2 text-left">
        <span className="text-sm font-semibold" style={{ color: "var(--ch-ink)" }}>
          What changed since v{view.fromVersion ?? versionNumber - 1}
          <span className="ml-2 text-xs font-semibold rounded-full px-2 py-0.5" style={{ background: "var(--ch-navy-soft)", color: "var(--ch-navy)" }}>
            {view.summary.total} {view.summary.total === 1 ? "change" : "changes"}
          </span>
        </span>
        <span className="text-xs" style={{ color: "var(--ch-sub)" }}>{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="mt-2">
          {view.reason && (
            <div className="text-xs mb-2" style={{ color: "var(--ch-sub)" }}>
              <span className="font-semibold">Reason:</span> {view.reason}
            </div>
          )}
          {sentences.length === 0 ? (
            <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No differences from the previous version.</div>
          ) : (
            <ul className="text-sm space-y-1 list-disc pl-5" style={{ color: "var(--ch-ink)" }}>
              {shown.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          )}
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            {sentences.length > 8 && (
              <button type="button" onClick={() => setShowAll((v) => !v)} className="text-xs font-semibold ch-link-navy">
                {showAll ? "Show fewer" : `Show all ${sentences.length}`}
              </button>
            )}
            <button type="button" onClick={onOpenComparison} className="text-xs font-semibold ch-link-navy">Open full comparison</button>
            <span className="text-xs" style={{ color: "var(--ch-sub)" }}>
              {view.frozen ? `Recorded when submitted for approval${view.frozenAt ? ` (${fmtDate(view.frozenAt)})` : ""}.` : "Worked out live; it is recorded when the version is submitted for approval."}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
