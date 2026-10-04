"use client";

// "Verify documents" step of the Send Matrix to Client wizard. Reads every
// document file that would go out, compares what is printed on it with the
// crew record, and shows only what needs a decision (exceptions), with the
// full list a click away. The send action re-derives every result itself;
// this screen only collects the sender's decisions.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getVerificationPlan, verifyDocumentItem } from "./verify-actions";
import { overallLabel, resolveInclusion, type Decision, type Policy, type VerifyItem, type VerifyOutcome } from "@/lib/matrix-verify";

const CONCURRENCY = 3;

const TONE = {
  pass: { bg: "#ecfdf3", line: "#b7ebc8", fg: "#15803d" },
  warn: { bg: "#fff6e5", line: "#fbd9a0", fg: "#92400e" },
  fail: { bg: "#fef2f2", line: "#fbc5c5", fg: "#b91c1c" },
  idle: { bg: "#f8fafc", line: "var(--ch-line)", fg: "var(--ch-sub)" },
} as const;

export type VerifyStepState = { policy: Policy; decisions: Decision[] };

export default function VerifyStep({
  crewMatrixId,
  initial,
  onChange,
  onBack,
  onContinue,
}: {
  crewMatrixId: string;
  initial: VerifyStepState;
  onChange: (s: VerifyStepState) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const [items, setItems] = useState<VerifyItem[]>([]);
  const [outcomes, setOutcomes] = useState<Record<string, VerifyOutcome>>({});
  const [loading, setLoading] = useState(true);
  const [planError, setPlanError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [policy, setPolicy] = useState<Policy>(initial.policy);
  const [decisions, setDecisions] = useState<Record<string, Decision>>(() => Object.fromEntries(initial.decisions.map((d) => [d.key, d])));
  const [showAll, setShowAll] = useState(false);
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());
  const runId = useRef(0);

  const runReads = useCallback(
    async (list: VerifyItem[], current: Record<string, VerifyOutcome>, includeUnread: boolean) => {
      const todo = list.filter((i) => current[i.key]?.overall === "not_verified" || (includeUnread && current[i.key]?.overall === "unread"));
      const myRun = ++runId.current;
      if (todo.length === 0) {
        setRunning(false);
        return;
      }
      setRunning(true);
      setProgress({ done: 0, total: todo.length });
      let next = 0;
      let done = 0;
      const worker = async () => {
        while (next < todo.length && runId.current === myRun) {
          const item = todo[next++];
          const res = await verifyDocumentItem(crewMatrixId, item.key).catch((e: unknown) => ({ error: e instanceof Error ? e.message : "Check failed." }));
          if (runId.current !== myRun) return;
          const outcome: VerifyOutcome = "error" in res ? { key: item.key, overall: "unread", checks: [], error: res.error } : res.outcome;
          setOutcomes((prev) => ({ ...prev, [item.key]: outcome }));
          done++;
          setProgress({ done, total: todo.length });
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
      if (runId.current === myRun) setRunning(false);
    },
    [crewMatrixId]
  );

  const load = useCallback(
    async (rereadFailures: boolean) => {
      const res = await getVerificationPlan(crewMatrixId);
      if ("error" in res) {
        setPlanError(res.error);
        setLoading(false);
        return;
      }
      const map: Record<string, VerifyOutcome> = {};
      for (const o of res.outcomes) map[o.key] = o;
      setItems(res.items);
      setOutcomes(map);
      setLoading(false);
      // Files that failed to read earlier are retried only on an explicit "Re-check".
      await runReads(res.items, map, rereadFailures);
    },
    [crewMatrixId, runReads]
  );

  useEffect(() => {
    load(false);
    return () => {
      runId.current++;
    };
  }, [load]);

  const decisionList = useMemo(() => Object.values(decisions), [decisions]);
  useEffect(() => {
    onChange({ policy, decisions: decisionList });
  }, [policy, decisionList, onChange]);

  const rows = useMemo(
    () =>
      items.map((item) => {
        const outcome = outcomes[item.key] ?? { key: item.key, overall: "not_verified" as const, checks: [], error: null };
        const decision = decisions[item.key];
        return { item, outcome, decision, inclusion: resolveInclusion(outcome, decision) };
      }),
    [items, outcomes, decisions]
  );

  const counts = useMemo(() => {
    let verified = 0;
    let notes = 0;
    let failed = 0;
    let noFile = 0;
    let included = 0;
    for (const r of rows) {
      if (r.outcome.overall === "pass") verified++;
      else if (r.outcome.overall === "warn") notes++;
      else if (r.outcome.overall === "no_file") noFile++;
      else failed++;
      if (r.inclusion.include && r.outcome.overall !== "no_file") included++;
    }
    return { verified, notes, failed, noFile, included, total: rows.length - noFile };
  }, [rows]);

  const exceptions = rows.filter((r) => ["fail", "unread", "not_verified"].includes(r.outcome.overall));
  const noteRows = rows.filter((r) => r.outcome.overall === "warn");
  const undecided = exceptions.filter((r) => !r.decision);
  const badOverride = exceptions.filter((r) => r.decision?.decision === "include" && !(r.decision.reason ?? "").trim());
  const blocked = running || loading || badOverride.length > 0 || (policy === "require_decision" && undecided.length > 0);

  const setDecision = (key: string, d: "include" | "exclude" | null, reason?: string) =>
    setDecisions((prev) => {
      const next = { ...prev };
      if (d === null) delete next[key];
      else next[key] = { key, decision: d, reason: reason ?? next[key]?.reason };
      return next;
    });

  const toggleOpen = (key: string) =>
    setOpenKeys((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const retryOne = async (item: VerifyItem) => {
    setOutcomes((prev) => ({ ...prev, [item.key]: { key: item.key, overall: "not_verified", checks: [], error: null } }));
    const res = await verifyDocumentItem(crewMatrixId, item.key).catch((e: unknown) => ({ error: e instanceof Error ? e.message : "Check failed." }));
    const outcome: VerifyOutcome = "error" in res ? { key: item.key, overall: "unread", checks: [], error: res.error } : res.outcome;
    setOutcomes((prev) => ({ ...prev, [item.key]: outcome }));
  };

  if (loading && items.length === 0) {
    return <div className="text-sm" style={{ color: "var(--ch-sub)" }}>Preparing the documents to check…</div>;
  }
  if (planError) {
    return (
      <div>
        <div className="text-sm mb-3" style={{ color: "var(--ch-fail)" }}>{planError}</div>
        <button onClick={onBack} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-line)" }}>Back</button>
      </div>
    );
  }

  const pct = counts.total + counts.noFile === 0 ? 0 : Math.round((progress.done / Math.max(progress.total, 1)) * 100);

  return (
    <div>
      <div className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: "var(--ch-sub)" }}>Verify documents</div>
      <p className="text-xs mb-3" style={{ color: "var(--ch-sub)" }}>
        Each document file that would go out is read and compared with the crew record: name, number, expiry date, document type, and whether it stays valid for the 30 days the link is open. This confirms the file agrees with the record; it can&apos;t confirm a certificate with the issuing body.
      </p>

      {items.length === 0 && (
        <div className="text-sm rounded-lg px-3 py-2 mb-3" style={{ background: TONE.idle.bg, border: `1px solid ${TONE.idle.line}` }}>
          No assigned crew hold any of this matrix&apos;s required documents yet, so there is nothing to verify.
        </div>
      )}

      {running && (
        <div className="mb-3" role="status" aria-live="polite">
          <div className="text-xs mb-1" style={{ color: "var(--ch-sub)" }}>Checked {progress.done} of {progress.total} files…</div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--ch-line)" }}>
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--ch-navy)", transition: "width .2s" }} />
          </div>
        </div>
      )}

      {items.length > 0 && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            <Tile tone="pass" n={counts.verified} label="Verified" />
            <Tile tone="warn" n={counts.notes} label="Verified with a note" />
            <Tile tone="fail" n={counts.failed} label="Need a decision" />
            <Tile tone="idle" n={counts.included} label="Will be sent" />
          </div>
          {counts.noFile > 0 && (
            <div className="text-xs mb-3" style={{ color: "var(--ch-sub)" }}>
              {counts.noFile} document{counts.noFile === 1 ? " has" : "s have"} a record but no file stored, so there is nothing to attach or check; they appear in the Excel as usual.
            </div>
          )}

          {exceptions.length > 0 && (
            <div className="mb-3">
              <div className="text-xs font-semibold mb-1.5" style={{ color: "var(--ch-ink)" }}>Needs your attention ({exceptions.length})</div>
              <div className="space-y-2">
                {exceptions.map((r) => (
                  <ExceptionCard
                    key={r.item.key}
                    row={r}
                    open={openKeys.has(r.item.key)}
                    onToggle={() => toggleOpen(r.item.key)}
                    onDecide={(d, reason) => setDecision(r.item.key, d, reason)}
                    onRetry={() => retryOne(r.item)}
                  />
                ))}
              </div>
            </div>
          )}

          {noteRows.length > 0 && (
            <details className="mb-3 rounded-lg border px-3 py-2" style={{ borderColor: TONE.warn.line, background: TONE.warn.bg }}>
              <summary className="text-xs font-semibold cursor-pointer" style={{ color: TONE.warn.fg }}>Verified with a note ({noteRows.length}) — sent as verified, shown with the note</summary>
              <div className="mt-2 space-y-1.5">
                {noteRows.map((r) => (
                  <div key={r.item.key} className="text-xs">
                    <b style={{ color: "var(--ch-ink)" }}>{r.item.crewName}</b> · {r.item.docTypeName}
                    <div style={{ color: TONE.warn.fg }}>{r.outcome.checks.filter((c) => c.state === "warn").map((c) => c.note).filter(Boolean).join(" ")}</div>
                  </div>
                ))}
              </div>
            </details>
          )}

          <button onClick={() => setShowAll((v) => !v)} className="text-xs font-semibold mb-3" style={{ color: "var(--ch-navy)" }}>
            {showAll ? "Hide the full list" : `Show all ${items.length}`}
          </button>
          {showAll && (
            <div className="overflow-x-auto border rounded-lg mb-3" style={{ borderColor: "var(--ch-line)" }}>
              <table className="w-full text-xs" style={{ minWidth: 520 }}>
                <thead>
                  <tr style={{ background: "#f8fafc", color: "var(--ch-sub)" }}>
                    <th className="text-left px-2 py-1.5">Crew member</th>
                    <th className="text-left px-2 py-1.5">Document</th>
                    <th className="text-left px-2 py-1.5">Result</th>
                    <th className="text-left px-2 py-1.5">Goes out</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.item.key} className="border-t" style={{ borderColor: "var(--ch-line)" }}>
                      <td className="px-2 py-1.5">{r.item.crewName}</td>
                      <td className="px-2 py-1.5">{r.item.docTypeName}</td>
                      <td className="px-2 py-1.5" style={{ color: toneFor(r.outcome.overall).fg, fontWeight: 600 }}>{overallLabel(r.outcome.overall)}</td>
                      <td className="px-2 py-1.5">{r.outcome.overall === "no_file" ? "—" : r.inclusion.include ? (r.inclusion.overridden ? "Yes (sent anyway)" : "Yes") : "Left out"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="rounded-lg border px-3 py-2 mb-3 text-xs" style={{ borderColor: "var(--ch-line)", background: "#f8fafc" }}>
            <div className="font-semibold mb-1" style={{ color: "var(--ch-ink)" }}>When a document fails a check</div>
            <label className="flex items-start gap-2 my-1">
              <input type="radio" name="verify-policy" checked={policy === "auto_exclude"} onChange={() => setPolicy("auto_exclude")} />
              <span>Leave it out automatically (the client sees it as &ldquo;being re-checked&rdquo;); I can still choose to send it anyway.</span>
            </label>
            <label className="flex items-start gap-2 my-1">
              <input type="radio" name="verify-policy" checked={policy === "require_decision"} onChange={() => setPolicy("require_decision")} />
              <span>Make me decide on each one before I can continue.</span>
            </label>
          </div>
        </>
      )}

      <div className="flex justify-between items-center gap-2 flex-wrap">
        <button onClick={onBack} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-line)" }}>Back</button>
        <div className="flex gap-2 items-center flex-wrap">
          {items.length > 0 && (
            <button
              onClick={() => {
                setLoading(true);
                setPlanError(null);
                load(true);
              }}
              disabled={running || loading} className="rounded-lg px-3 py-2 text-xs font-semibold border disabled:opacity-50" style={{ borderColor: "var(--ch-line)" }}>
              Re-check
            </button>
          )}
          <button onClick={onContinue} disabled={blocked} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
            {running ? "Checking…" : exceptions.length > 0 && policy === "auto_exclude" ? `Continue, ${exceptions.filter((e) => e.decision?.decision !== "include").length} left out` : "Next: Compose email"}
          </button>
        </div>
      </div>
      {badOverride.length > 0 && <div className="text-xs mt-2" style={{ color: "var(--ch-fail)" }}>Give a reason for each document you are sending anyway.</div>}
      {policy === "require_decision" && undecided.length > 0 && !running && (
        <div className="text-xs mt-2" style={{ color: "var(--ch-fail)" }}>{undecided.length} document{undecided.length === 1 ? "" : "s"} still need a decision.</div>
      )}
    </div>
  );
}

function toneFor(o: VerifyOutcome["overall"]) {
  if (o === "pass") return TONE.pass;
  if (o === "warn") return TONE.warn;
  if (o === "fail" || o === "unread") return TONE.fail;
  return TONE.idle;
}

function Tile({ tone, n, label }: { tone: keyof typeof TONE; n: number; label: string }) {
  const t = TONE[tone];
  return (
    <div className="rounded-lg px-3 py-2" style={{ background: t.bg, border: `1px solid ${t.line}`, color: t.fg }}>
      <div className="text-xl font-bold tabular-nums leading-tight">{n}</div>
      <div className="text-[11px]">{label}</div>
    </div>
  );
}

type Row = { item: VerifyItem; outcome: VerifyOutcome; decision: Decision | undefined; inclusion: ReturnType<typeof resolveInclusion> };

function ExceptionCard({ row, open, onToggle, onDecide, onRetry }: { row: Row; open: boolean; onToggle: () => void; onDecide: (d: "include" | "exclude" | null, reason?: string) => void; onRetry: () => void }) {
  const { item, outcome, decision } = row;
  const t = toneFor(outcome.overall);
  const reasons =
    outcome.overall === "unread"
      ? [outcome.error ?? "The file could not be read."]
      : outcome.overall === "not_verified"
        ? ["Not checked yet."]
        : outcome.checks.filter((c) => c.state === "fail").map((c) => c.note ?? c.label);
  const sendAnyway = decision?.decision === "include";
  return (
    <div className="rounded-lg border-l-4 border px-3 py-2" style={{ borderColor: t.line, borderLeftColor: t.fg, background: "var(--ch-card, #fff)" }}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex-1" style={{ minWidth: 200 }}>
          <div className="text-sm font-semibold" style={{ color: "var(--ch-ink)" }}>{item.docTypeName} · {item.crewName}</div>
          {reasons.map((m, i) => (
            <div key={i} className="text-xs" style={{ color: t.fg }}>{m}</div>
          ))}
        </div>
        <div className="flex gap-1.5 flex-wrap items-center">
          {outcome.overall === "unread" && (
            <button onClick={onRetry} className="text-xs font-semibold rounded-lg px-2.5 py-1 border" style={{ borderColor: "var(--ch-line)" }}>Retry</button>
          )}
          <button
            onClick={() => onDecide(decision?.decision === "exclude" ? null : "exclude")}
            aria-pressed={decision?.decision === "exclude"}
            className="text-xs font-semibold rounded-lg px-2.5 py-1 border"
            style={{ borderColor: decision?.decision === "exclude" ? "var(--ch-navy)" : "var(--ch-line)", background: decision?.decision === "exclude" ? "#e7edf3" : "transparent" }}
          >
            Leave out
          </button>
          <button
            onClick={() => onDecide(sendAnyway ? null : "include")}
            aria-pressed={sendAnyway}
            className="text-xs font-semibold rounded-lg px-2.5 py-1 border"
            style={{ borderColor: sendAnyway ? "var(--ch-navy)" : "var(--ch-line)", background: sendAnyway ? "#e7edf3" : "transparent" }}
          >
            Send anyway
          </button>
        </div>
      </div>
      {!decision && <div className="text-[11px] mt-1" style={{ color: "var(--ch-sub)" }}>Will be left out unless you choose Send anyway.</div>}
      {sendAnyway && (
        <label className="block text-xs mt-1.5" style={{ color: "var(--ch-sub)" }}>
          Reason (kept on the sharing record)
          <input
            className="border rounded-lg px-2 py-1.5 text-xs w-full mt-1"
            style={{ borderColor: "var(--ch-line)" }}
            value={decision?.reason ?? ""}
            onChange={(e) => onDecide("include", e.target.value)}
            placeholder="e.g. Record is right, the file is a renewal in progress"
          />
        </label>
      )}
      {outcome.checks.length > 0 && (
        <>
          <button onClick={onToggle} className="text-[11px] font-semibold mt-1.5" style={{ color: "var(--ch-navy)" }}>{open ? "Hide details" : "Show what was read"}</button>
          {open && (
            <div className="overflow-x-auto mt-1.5">
              <table className="w-full text-xs" style={{ minWidth: 420 }}>
                <thead>
                  <tr style={{ color: "var(--ch-sub)" }}>
                    <th className="text-left py-1 pr-2 font-medium"></th>
                    <th className="text-left py-1 pr-2 font-medium">In ComplianceHub</th>
                    <th className="text-left py-1 pr-2 font-medium">Read from the file</th>
                    <th className="text-left py-1 font-medium">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {outcome.checks.map((c) => {
                    const ct = c.state === "pass" ? TONE.pass : c.state === "warn" ? TONE.warn : c.state === "fail" ? TONE.fail : TONE.idle;
                    return (
                      <tr key={c.key} className="border-t" style={{ borderColor: "var(--ch-line)" }}>
                        <td className="py-1 pr-2">{c.label}</td>
                        <td className="py-1 pr-2 tabular-nums">{c.recorded ?? "—"}</td>
                        <td className="py-1 pr-2 tabular-nums">{c.found ?? "—"}</td>
                        <td className="py-1 font-semibold" style={{ color: ct.fg }}>{c.state === "pass" ? "Match" : c.state === "na" ? "—" : c.note ?? (c.state === "fail" ? "Different" : "Check")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
