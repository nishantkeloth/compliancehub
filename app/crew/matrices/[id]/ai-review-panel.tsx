"use client";

import { useEffect, useState, useTransition } from "react";
import { reviewMatrix } from "../ai-actions";
import type { MatrixReview } from "@/lib/ai/schema";

const SEV: Record<string, { bg: string; fg: string }> = {
  high: { bg: "var(--ch-fail-bg)", fg: "var(--ch-fail)" },
  medium: { bg: "#fef3e2", fg: "#b45309" },
  low: { bg: "var(--ch-paper)", fg: "var(--ch-sub)" },
};

const cardCls = "bg-white border rounded-xl";
const cardStyle = { borderColor: "var(--ch-line)" };

// Phase 9 — "Review with AI" on a draft matrix: findings only, nothing is
// changed automatically; the user applies suggestions by editing lines.
// Triggered from the header's "✦ AI Review" button in matrix-detail.tsx
// and rendered as a scrollable modal (same overlay pattern as
// SharingHistoryPanel) rather than inline on the Overview tab, so a long
// findings list doesn't push the rest of the page around. The review
// starts the moment the modal opens — no separate "run" click needed —
// with a "Run again" link once results are in.
export default function AiReviewModal({ crewMatrixId, isDraft, onClose }: { crewMatrixId: string; isDraft: boolean; onClose: () => void }) {
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

  useEffect(() => {
    run();
    // Run once, when the modal first opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15, 23, 42, 0.5)" }}>
      <div className={`${cardCls} w-full max-w-2xl max-h-[85vh] overflow-y-auto p-5`} style={cardStyle}>
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono font-bold rounded px-1.5 py-0.5" style={{ background: "var(--ch-navy)", color: "#fff" }}>
              ✦ AI
            </span>
            <h3 className="text-sm font-bold" style={{ color: "var(--ch-navy)" }}>{isDraft ? "Review this draft" : "AI review"}</h3>
          </div>
          <button onClick={onClose} className="text-xs font-semibold" style={{ color: "var(--ch-sub)" }}>Close</button>
        </div>
        {result && <div className="text-[11px] mb-3" style={{ color: "var(--ch-sub)" }}>by {result.modelLabel}</div>}

        {busy && !result && <div className="text-sm mt-3" style={{ color: "var(--ch-sub)" }}>Reviewing…</div>}
        {error && (
          <div className="text-sm mt-3" style={{ color: "var(--ch-fail)" }}>
            {error}
            <div className="mt-1.5">
              <button onClick={run} disabled={busy} className="text-xs font-semibold ch-link-navy disabled:opacity-50">Try again</button>
            </div>
          </div>
        )}

        {result && (
          <div className="mt-2 space-y-1.5">
            <div className="text-sm" style={{ color: "var(--ch-ink)" }}>{result.review.summary}</div>
            {result.review.findings.length === 0 && (
              <div className="text-sm" style={{ color: "var(--ch-pass)" }}>No gaps found against the catering norms.</div>
            )}
            {result.review.findings.map((f, i) => (
              <div key={i} className="text-xs border rounded-lg px-2.5 py-1.5" style={{ borderColor: "var(--ch-line)" }}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className="text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5"
                    style={{ background: SEV[f.severity].bg, color: SEV[f.severity].fg }}
                  >
                    {f.severity}
                  </span>
                  {f.line_job_role_name && <span className="font-semibold" style={{ color: "var(--ch-ink)" }}>{f.line_job_role_name}</span>}
                  <span style={{ color: "var(--ch-ink)" }}>{f.finding}</span>
                  {f.norm_applied && <span className="text-[10px] font-mono" style={{ color: "var(--ch-navy)" }}>{f.norm_applied}</span>}
                </div>
                <div className="mt-0.5" style={{ color: "var(--ch-sub)" }}>Suggestion: {f.suggestion}</div>
              </div>
            ))}
            <div className="text-[11px] pt-1" style={{ color: "var(--ch-sub)" }}>Suggestions only — apply them by editing the lines.</div>
            <div className="pt-2">
              <button onClick={run} disabled={busy} className="text-xs font-semibold ch-link-navy disabled:opacity-50">
                {busy ? "Reviewing…" : "Run again"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
