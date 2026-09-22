"use client";

// Phase 17 — the real expanding status timeline, replacing the plain
// crew_matrix_status_history list that used to be the whole "History"
// tab. Merges three sources into one chronological, append-only ledger
// that never reruns and never resets, exactly as confirmed with the
// client (see claude/ mockups crew-matrix-timeline-mockup.html and
// crew-matrix-timeline-6months.html — this component ports that
// confirmed visual design onto live data):
//   1. `history` (crew_matrix_status_history, passed down as a prop,
//      already fetched server-side) — the original Draft → Submitted →
//      Internal approval → Client approval → Activated pipeline.
//   2. Roster change requests (roster_change_requests via
//      listRosterChangeRequests) — every assign/replace/unassign raised
//      once the matrix went Active, each with its own approval gate.
//   3. "Sent to client" sends (crew_matrix_share_packages via the
//      existing getSharingHistory) — every time this matrix was emailed
//      out, draft or otherwise.
// Older, fully-closed cycles (everything between the first send and the
// start of the current cycle) collapse by default behind a dashed chip,
// exactly like the confirmed mockup — expand it to see the full chain.

import { useEffect, useState, type CSSProperties } from "react";
import { listRosterChangeRequests, decideRosterChangeRequest } from "./roster-change-actions";
import { REASON_CODES } from "./roster-change-shared";
import { getSharingHistory } from "./share-actions";

export type HistoryRow = { id: string; old_status: string | null; new_status: string; changed_at: string; comment: string | null };

type Node = {
  id: string;
  at: string; // ISO timestamp, sort key
  kind: "circle" | "gate" | "change";
  tone: "done" | "current" | "fail" | "pending";
  label: string;
  sub: string;
  detail?: string;
  request?: RosterChangeRequestRow;
};

type RosterChangeRequestRow = {
  id: string;
  change_type: "assign" | "replace" | "unassign";
  outgoing_crew_id: string | null;
  incoming_crew_id: string | null;
  effective_date: string;
  reason_code: string;
  reason_notes: string | null;
  status: "pending_approval" | "approved" | "rejected" | "cancelled";
  requested_by: string | null;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_comment: string | null;
  // Staged, not applied on approval — see roster-change-actions.ts. Null
  // means an approved request hasn't been applied to crew_assignments yet
  // (it happens once, together with every other approved request on this
  // matrix, when the matrix itself is Activated).
  applied_assignment_id: string | null;
  outgoing?: { full_name?: string } | { full_name?: string }[] | null;
  incoming?: { full_name?: string } | { full_name?: string }[] | null;
};

function unwrap<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending_internal_approval: "Submitted for internal approval",
  pending_client_approval: "Internal approval given",
  approved: "Approved",
  active: "Activated",
  superseded: "Superseded",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

function statusHistoryToNode(h: HistoryRow): Node {
  const isGate = h.new_status === "pending_client_approval" || h.new_status === "approved";
  const isFail = h.new_status === "rejected" || h.new_status === "cancelled";
  return {
    id: `status-${h.id}`,
    at: h.changed_at,
    kind: isGate ? "gate" : "circle",
    tone: isFail ? "fail" : "done",
    label: STATUS_LABELS[h.new_status] ?? h.new_status.replace(/_/g, " "),
    sub: new Date(h.changed_at).toLocaleDateString(),
    detail: h.comment ?? undefined,
  };
}

function changeLabel(r: RosterChangeRequestRow) {
  const outName = unwrap(r.outgoing)?.full_name;
  const inName = unwrap(r.incoming)?.full_name;
  if (r.change_type === "replace") return `Replace ${outName ?? "crew"}`;
  if (r.change_type === "unassign") return `Unassign ${outName ?? "crew"}`;
  return `Assign ${inName ?? "crew"}`;
}

function changeDetail(r: RosterChangeRequestRow) {
  const outName = unwrap(r.outgoing)?.full_name;
  const inName = unwrap(r.incoming)?.full_name;
  const reasonLabel = REASON_CODES.find((c) => c.value === r.reason_code)?.label ?? r.reason_code;
  const swap = r.change_type === "replace" ? `${outName ?? "—"} → ${inName ?? "—"}` : r.change_type === "unassign" ? `${outName ?? "—"} leaving` : `${inName ?? "—"} joining`;
  return `Reason: ${reasonLabel}${r.reason_notes ? ` — ${r.reason_notes}` : ""} · ${swap} · Effective ${r.effective_date}`;
}

function requestToNodes(r: RosterChangeRequestRow): Node[] {
  const tone = r.status === "approved" ? "done" : r.status === "rejected" || r.status === "cancelled" ? "fail" : "pending";
  const approvedWord = r.applied_assignment_id ? "Applied" : "Recorded — will apply when this version goes live";
  const statusWord = r.status === "pending_approval" ? "Pending your review" : r.status === "approved" ? approvedWord : r.status === "rejected" ? "Rejected" : "Withdrawn";
  const nodes: Node[] = [
    {
      id: `change-${r.id}`,
      at: r.requested_at,
      kind: "change",
      tone,
      label: changeLabel(r),
      sub: `${statusWord} · ${new Date(r.requested_at).toLocaleDateString()}`,
      detail: changeDetail(r),
      request: r,
    },
  ];
  // A separate "Change approval" gate node is only meaningful when someone
  // OTHER than the requester actually decided it (decideRosterChangeRequest
  // — kept for a pending_approval row, though the current flow never
  // creates one). The current flow's requestRosterChange self-records
  // straight to "approved" (requested_by === decided_by, same moment) —
  // showing a second node for that would just duplicate the change node
  // above.
  if (r.decided_at && r.decided_by && r.decided_by !== r.requested_by) {
    nodes.push({
      id: `gate-${r.id}`,
      at: r.decided_at,
      kind: "gate",
      tone: r.status === "approved" ? "done" : "fail",
      label: "Change approval",
      sub: `${r.status === "approved" ? "Approved" : "Rejected"} ${new Date(r.decided_at).toLocaleDateString()}`,
      detail: r.decision_comment ?? undefined,
    });
  }
  return nodes;
}

function sendToNode(p: { id: string; matrixVersion: number; createdAt: string; status: string; staffCount: number }, isFirst: boolean): Node {
  return {
    id: `send-${p.id}`,
    at: p.createdAt,
    kind: "circle",
    tone: p.status === "revoked" ? "fail" : "done",
    label: isFirst ? "Sent to client" : "Resent to client",
    sub: `v${p.matrixVersion} · ${new Date(p.createdAt).toLocaleDateString()}`,
    detail: `${p.staffCount} crew on this send${p.status === "revoked" ? " · revoked" : ""}`,
  };
}

const toneColor: Record<Node["tone"], { border: string; bg: string; fg: string }> = {
  done: { border: "var(--ch-pass)", bg: "var(--ch-pass)", fg: "#fff" },
  current: { border: "var(--ch-navy)", bg: "var(--ch-navy-soft)", fg: "var(--ch-navy)" },
  fail: { border: "var(--ch-fail)", bg: "var(--ch-fail-bg)", fg: "var(--ch-fail)" },
  pending: { border: "#b45309", bg: "#fff7ed", fg: "#b45309" },
};
const changeTone = { border: "#9d174d", bg: "#fdf2f8", fg: "#9d174d" };

function NodeDot({ node }: { node: Node }) {
  const isChange = node.kind === "change";
  const colors = isChange ? changeTone : toneColor[node.tone];
  const icon = node.kind === "change" ? "⇄" : node.tone === "pending" ? "!" : node.tone === "fail" ? "✕" : "✓";
  // "done" is the only tone that fills solid (border color as background,
  // white glyph) — every other tone (current/pending/fail, and a change
  // node in any of those states) stays a soft tint with a colored glyph.
  const filled: boolean = node.tone === "done";
  const base: CSSProperties = {
    width: 28,
    height: 28,
    borderRadius: node.kind === "gate" ? 6 : "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 12,
    fontWeight: 700,
    border: `2px solid ${colors.border}`,
    color: filled ? "#fff" : colors.fg,
    background: filled ? colors.border : colors.bg,
    transform: node.kind === "gate" ? "rotate(45deg)" : undefined,
    flexShrink: 0,
  };
  return (
    <div style={base}>
      <span style={{ transform: node.kind === "gate" ? "rotate(-45deg)" : undefined }}>{icon}</span>
    </div>
  );
}

function TimelineNode({ node, canApproveInternal, onDecide, busy }: { node: Node; canApproveInternal: boolean; onDecide: (id: string, decision: "approved" | "rejected") => void; busy: string | null }) {
  const [open, setOpen] = useState(node.request?.status === "pending_approval");
  const clickable = !!node.detail || !!node.request;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 152, textAlign: "center" }}>
      <div onClick={() => clickable && setOpen((o) => !o)} style={{ cursor: clickable ? "pointer" : "default", display: "flex", flexDirection: "column", alignItems: "center" }}>
        <NodeDot node={node} />
        <div className="text-[11px] font-semibold mt-1.5" style={{ color: "var(--ch-ink)", lineHeight: 1.3 }}>{node.label}</div>
        <div className="text-[10px] mt-0.5" style={{ color: "var(--ch-sub)" }}>{node.sub}</div>
        {node.kind === "change" && (
          <div className="mt-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: changeTone.bg, color: changeTone.fg }}>reason required</div>
        )}
      </div>
      {open && node.detail && (
        <div className="mt-1.5 text-[10px] rounded-lg border px-2 py-1.5" style={{ borderColor: "var(--ch-line)", background: "var(--ch-paper)", color: "var(--ch-sub)", lineHeight: 1.5, maxWidth: 152 }}>
          {node.detail}
        </div>
      )}
      {open && node.request && node.request.status === "pending_approval" && canApproveInternal && (
        <div className="mt-1.5 flex gap-1">
          <button
            onClick={() => onDecide(node.request!.id, "approved")}
            disabled={busy !== null}
            className="text-[10px] font-semibold rounded px-2 py-1 border disabled:opacity-50"
            style={{ borderColor: "var(--ch-pass)", color: "var(--ch-pass)" }}
          >
            {busy === node.request.id ? "…" : "Approve"}
          </button>
          <button
            onClick={() => onDecide(node.request!.id, "rejected")}
            disabled={busy !== null}
            className="text-[10px] font-semibold rounded px-2 py-1 border disabled:opacity-50"
            style={{ borderColor: "var(--ch-fail)", color: "var(--ch-fail)" }}
          >
            {busy === node.request.id ? "…" : "Reject"}
          </button>
        </div>
      )}
    </div>
  );
}

const Connector = () => <div style={{ width: 20, height: 2, background: "var(--ch-line)", marginTop: 13, flexShrink: 0 }} />;

export default function RosterTimeline({
  crewMatrixId,
  history,
  matrixCreatedAt,
  canApproveInternal,
}: {
  crewMatrixId: string;
  history: HistoryRow[];
  matrixCreatedAt?: string | null;
  canApproveInternal: boolean;
}) {
  const [requests, setRequests] = useState<RosterChangeRequestRow[]>([]);
  const [sends, setSends] = useState<{ id: string; matrixVersion: number; createdAt: string; status: string; staffCount: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(true);
  const [decideBusy, setDecideBusy] = useState<string | null>(null);
  const [decideError, setDecideError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const [reqRes, shareRes] = await Promise.all([
      listRosterChangeRequests(crewMatrixId).catch(() => ({ requests: [] as RosterChangeRequestRow[] })),
      getSharingHistory(crewMatrixId).catch(() => ({ packages: undefined as any })),
    ]);
    setRequests(((reqRes as any)?.requests ?? []) as RosterChangeRequestRow[]);
    setSends(((shareRes as any)?.packages ?? []).map((p: any) => ({ id: p.id, matrixVersion: p.matrixVersion, createdAt: p.createdAt, status: p.status, staffCount: p.staffCount })));
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crewMatrixId]);

  const onDecide = async (requestId: string, decision: "approved" | "rejected") => {
    setDecideError(null);
    setDecideBusy(requestId);
    const res = await decideRosterChangeRequest(requestId, decision);
    setDecideBusy(null);
    if (res?.error) {
      setDecideError(res.error);
      return;
    }
    await load();
  };

  if (loading) {
    return <div className="text-sm" style={{ color: "var(--ch-sub)" }}>Loading timeline…</div>;
  }

  const sendsSorted = [...sends].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const sendNodes = sendsSorted.map((s, i) => sendToNode(s, i === 0));

  const allNodes: Node[] = [
    ...(matrixCreatedAt ? [{ id: "created", at: matrixCreatedAt, kind: "circle" as const, tone: "done" as const, label: "Draft created", sub: new Date(matrixCreatedAt).toLocaleDateString() }] : []),
    ...history.map(statusHistoryToNode),
    ...requests.flatMap(requestToNodes),
    ...sendNodes,
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  if (allNodes.length === 0) {
    return <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No status changes recorded yet.</div>;
  }

  // Mark the very last node "current" so it stands out, same as the
  // confirmed mockup's always-highlighted latest node.
  const last = allNodes[allNodes.length - 1];
  if (last.tone === "done") last.tone = "current";

  // Collapse everything strictly between the first send and the start of
  // the current cycle (the send before last) — see file header. Fewer
  // than two sends means there's no completed cycle to collapse yet.
  let originNodes = allNodes;
  let collapsedNodes: Node[] = [];
  let currentNodes: Node[] = [];
  if (sendsSorted.length >= 2) {
    const firstSendAt = Date.parse(sendsSorted[0].createdAt);
    const cycleStartAt = Date.parse(sendsSorted[sendsSorted.length - 2].createdAt);
    originNodes = allNodes.filter((n) => Date.parse(n.at) <= firstSendAt);
    collapsedNodes = allNodes.filter((n) => Date.parse(n.at) > firstSendAt && Date.parse(n.at) <= cycleStartAt);
    currentNodes = allNodes.filter((n) => Date.parse(n.at) > cycleStartAt);
  } else {
    currentNodes = [];
    originNodes = allNodes;
  }
  const collapsedChangeCount = collapsedNodes.filter((n) => n.kind === "change").length;

  const renderList = collapsed ? originNodes : [...originNodes, ...collapsedNodes];

  return (
    <div>
      {decideError && <div className="text-xs mb-2" style={{ color: "var(--ch-fail)" }}>{decideError}</div>}
      <div className="flex flex-wrap items-start gap-y-4" style={{ rowGap: 18 }}>
        {renderList.map((n, i) => (
          <div key={n.id} className="flex items-start">
            {i > 0 && <Connector />}
            <TimelineNode node={n} canApproveInternal={canApproveInternal} onDecide={onDecide} busy={decideBusy} />
          </div>
        ))}
        {collapsedNodes.length > 0 && (
          <div className="flex items-start">
            <Connector />
            <div
              onClick={() => setCollapsed((c) => !c)}
              className="flex flex-col items-center justify-center text-center rounded-xl border border-dashed px-3 py-3 cursor-pointer"
              style={{ borderColor: "var(--ch-line)", background: "var(--ch-paper)", width: 152 }}
            >
              {collapsed ? (
                <>
                  <div className="text-lg font-extrabold" style={{ color: "var(--ch-navy)" }}>+{collapsedChangeCount}</div>
                  <div className="text-[10px] mt-0.5" style={{ color: "var(--ch-sub)" }}>earlier roster change{collapsedChangeCount === 1 ? "" : "s"}</div>
                  <div className="text-[10px] font-semibold mt-1.5" style={{ color: "var(--ch-navy)" }}>Show full history →</div>
                </>
              ) : (
                <div className="text-[10px] font-semibold" style={{ color: "var(--ch-navy)" }}>← Collapse earlier history</div>
              )}
            </div>
          </div>
        )}
        {currentNodes.map((n) => (
          <div key={n.id} className="flex items-start">
            <Connector />
            <TimelineNode node={n} canApproveInternal={canApproveInternal} onDecide={onDecide} busy={decideBusy} />
          </div>
        ))}
      </div>
      <div className="flex gap-4 flex-wrap mt-5 pt-3 border-t text-[11px]" style={{ borderColor: "var(--ch-line)", color: "var(--ch-sub)" }}>
        <span className="flex items-center gap-1.5"><span style={{ width: 12, height: 12, borderRadius: "50%", border: "2px solid var(--ch-pass)", background: "var(--ch-pass)", display: "inline-block" }} /> Done</span>
        <span className="flex items-center gap-1.5"><span style={{ width: 12, height: 12, borderRadius: "50%", border: "2px solid var(--ch-navy)", background: "var(--ch-navy-soft)", display: "inline-block" }} /> Current</span>
        <span className="flex items-center gap-1.5"><span style={{ width: 12, height: 12, borderRadius: 3, border: "2px solid #7c3aed", background: "#f5f3ff", display: "inline-block", transform: "rotate(45deg)" }} /> Approval gate</span>
        <span className="flex items-center gap-1.5"><span style={{ width: 12, height: 12, borderRadius: "50%", border: `2px solid ${changeTone.border}`, background: changeTone.bg, display: "inline-block" }} /> Roster change (click for reason)</span>
      </div>
    </div>
  );
}
