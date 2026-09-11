"use client";

import { useState, useTransition } from "react";
import { reviewMatrix } from "../ai-actions";
import type { MatrixReview } from "@/lib/ai/schema";

const SEV: Record<string, { bg: string; fg: string }> = {
  high: { bg: "var(--ch-fail-bg)", fg: "var(--ch-fail)" },
  medium: { bg: "#fef3e2", fg: "#b45309" },
  low: { bg: "var(--ch-paper)", fg: "var(--ch-sub)" },
};

// Phase 9 — "Review with AI" on a draft matrix: findings only, nothing is
// changed automatically; the user applies suggestions by editing lines.
export default function AiReviewPanel({ crewMatrixId, isDraft }: { crewMatrixId: string; isDraft: boolean }) {
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ review: MatrixReview; modelLabel: string } | null>(null);

  const run = () => {
    setBusy(true);
    setError(null);
    startTransition(async () => {
      const res = await reviewMatrix(crewMatrixId);
      setBusy(false);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setResult(res);
    });
  };

  return (
    <div className="mt-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--ch-sub)" }}>AI review</div>
        <button onClick={run} disabled={busy} className="text-xs font-semibold ch-link-navy disabled:opacity-50">
          {busy ? "Reviewing…" : result ? "Run again" : isDraft ? "✦ Review this draft" : "✦ Review"}
        </button>
        {result && <span className="text-[11px]" style={{ color: "var(--ch-sub)" }}>by {result.modelLabel}</span>}
      </div>
      {error && <div className="text-xs mt-1.5" style={{ color: "var(--ch-fail)" }}>{error}</div>}
      {result && (
        <div className="mt-2 space-y-1.5">
          <div className="text-sm" style={{ color: "var(--ch-ink)" }}>{result.review.summary}</div>
          {result.review.findings.length === 0 && <div className="text-sm" style={{ color: "var(--ch-pass)" }}>No gaps found against the catering norms.</div>}
          {result.review.findings.map((f, i) => (
            <div key={i} className="text-xs border rounded-lg px-2.5 py-1.5" style={{ borderColor: "var(--ch-line)" }}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5" style={{ background: SEV[f.severity].bg, color: SEV[f.severity].fg }}>{f.severity}</span>
                {f.line_job_role_name && <span className="font-semibold" style={{ color: "var(--ch-ink)" }}>{f.line_job_role_name}</span>}
                <span style={{ color: "var(--ch-ink)" }}>{f.finding}</span>
                {f.norm_applied && <span className="text-[10px] font-mono" style={{ color: "var(--ch-navy)" }}>{f.norm_applied}</span>}
              </div>
              <div className="mt-0.5" style={{ color: "var(--ch-sub)" }}>Suggestion: {f.suggestion}</div>
            </div>
          ))}
          <div className="text-[11px]" style={{ color: "var(--ch-sub)" }}>Suggestions only — apply them by editing the lines.</div>
        </div>
      )}
    </div>
  );
}
