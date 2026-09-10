"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  updateMobilizationHeader,
  deleteMobilizationRequest,
  generatePositionsFromMatrix,
  advanceToPlanning,
  advanceToComplianceReview,
  returnToPlanning,
  advanceToInternalApproval,
  approveInternal,
  approveClient,
  markTravelArranged,
  markInTransit,
  completeMobilization,
  cancelMobilization,
  emergencyFastTrack,
  postComment,
} from "../actions";
import { StatusPill } from "@/app/contracts/contracts-manager";
import PositionsBoard, { type Position } from "./positions-board";

type Request = {
  id: string;
  mobilization_number: string | null;
  mobilization_type: string;
  status: string;
  priority: string;
  request_date: string;
  required_onboard_date: string;
  crew_change_location: string | null;
  travel_origin: string | null;
  special_instructions: string | null;
  client_approval_required: boolean;
  project_name: string;
  site_name: string;
  matrix_label: string;
  requested_by_name: string;
  coordinator_name: string;
  approved_by_name: string | null;
  approved_at: string | null;
};
type StatusHistoryRow = { id: string; old_status: string | null; new_status: string; changed_by_name: string; changed_at: string };
type PositionHistoryRow = {
  id: string;
  mobilization_position_id: string;
  previous_crew_name: string | null;
  new_crew_name: string | null;
  reason: string | null;
  changed_by_name: string;
  changed_at: string;
};
type Comment = { id: string; author_name: string; body: string; is_system: boolean; created_at: string };
type JobRole = { id: string; name: string };

const inputCls = "border rounded-lg px-3 py-2 text-sm";
const inputStyle = { borderColor: "var(--ch-line)" };
const cardCls = "bg-white border rounded-xl";
const cardStyle = { borderColor: "var(--ch-line)" };

const WORKFLOW_STAGES = [
  "draft", "planning", "compliance_review", "internal_approval", "client_approval",
  "travel_arrangement", "ready_to_mobilize", "in_transit", "completed",
];
const TERMINAL_STATUSES = ["completed", "partially_completed", "cancelled"];

export default function MobilizationDetail({
  request,
  positions,
  statusHistory,
  positionHistory,
  comments,
  jobRoles,
  canManage,
  canComplianceReview,
  canApprove,
  canCancel,
  canEmergencyOverride,
}: {
  request: Request;
  positions: Position[];
  statusHistory: StatusHistoryRow[];
  positionHistory: PositionHistoryRow[];
  comments: Comment[];
  jobRoles: JobRole[];
  canManage: boolean;
  canComplianceReview: boolean;
  canApprove: boolean;
  canCancel: boolean;
  canEmergencyOverride: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [tab, setTab] = useState<"overview" | "positions" | "timeline" | "comments">("overview");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isEditableStage = ["draft", "planning"].includes(request.status);
  const isTerminal = TERMINAL_STATUSES.includes(request.status);

  const required = positions.length;
  const selected = positions.filter((p) => p.selected_crew_id).length;
  const approvedCount = positions.filter((p) => p.client_approval_status === "approved" || p.client_approval_status === "not_required").length;
  const remaining = required - selected;

  const tabs: { key: typeof tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "positions", label: `Positions (${required})` },
    { key: "timeline", label: "Status Timeline" },
    { key: "comments", label: `Comments (${comments.filter((c) => !c.is_system).length})` },
  ];

  const run = (fn: () => Promise<{ error?: string; warning?: string } | undefined>) => {
    setError(null);
    setBusy(true);
    startTransition(async () => {
      const res = await fn();
      setBusy(false);
      if (res?.error) {
        setError(res.error);
        return;
      }
      if (res?.warning) setError(res.warning);
      router.refresh();
    });
  };

  const submitDelete = () => {
    if (!window.confirm(`Delete draft mobilization "${request.mobilization_number ?? "request"}"? This can't be undone.`)) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteMobilizationRequest(request.id);
      if (res?.error) {
        setError(res.error);
        return;
      }
      router.push("/mobilizations");
    });
  };

  return (
    <div>
      <div className="mb-4 flex items-center gap-2 flex-wrap">
        <Link href="/mobilizations" className="text-xs font-semibold ch-link-navy">← All mobilizations</Link>
      </div>

      <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            {request.mobilization_number && (
              <span className="text-[10px] font-mono font-bold rounded px-1.5 py-0.5" style={{ background: "var(--ch-navy-soft)", color: "var(--ch-navy)" }}>
                {request.mobilization_number}
              </span>
            )}
            <h1 className="text-lg font-semibold" style={{ color: "var(--ch-ink)" }}>{request.mobilization_type.replace(/_/g, " ")}</h1>
            <StatusPill status={request.status} />
            {request.priority !== "normal" && (
              <span
                className="text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5"
                style={request.priority === "emergency" ? { background: "var(--ch-fail-bg)", color: "var(--ch-fail)" } : { background: "#fef3e2", color: "#b45309" }}
              >
                {request.priority}
              </span>
            )}
          </div>
          <div className="text-xs mt-1" style={{ color: "var(--ch-sub)" }}>
            {request.site_name} · {request.project_name} · from {request.matrix_label}
          </div>
        </div>
        {request.status === "draft" && canManage && (
          <button onClick={submitDelete} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-fail)", color: "var(--ch-fail)" }}>
            Delete
          </button>
        )}
      </div>

      {error && (
        <div className="text-sm mb-4 rounded-lg px-3 py-2" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>{error}</div>
      )}

      <div className={`${cardCls} p-3 mb-4 flex items-center gap-4 flex-wrap text-sm`} style={cardStyle}>
        <span style={{ color: "var(--ch-sub)" }}>Required <strong style={{ color: "var(--ch-ink)" }}>{required}</strong></span>
        <span style={{ color: "var(--ch-sub)" }}>Selected <strong style={{ color: "var(--ch-ink)" }}>{selected}</strong></span>
        <span style={{ color: "var(--ch-sub)" }}>Approved <strong style={{ color: "var(--ch-ink)" }}>{approvedCount}</strong></span>
        <span style={{ color: "var(--ch-sub)" }}>Remaining <strong style={{ color: remaining > 0 ? "var(--ch-fail)" : "var(--ch-ink)" }}>{remaining}</strong></span>
      </div>

      <WorkflowActions
        request={request}
        hasPositions={positions.length > 0}
        canManage={canManage}
        canComplianceReview={canComplianceReview}
        canApprove={canApprove}
        canCancel={canCancel}
        canEmergencyOverride={canEmergencyOverride}
        busy={busy}
        onGeneratePositions={() => run(() => generatePositionsFromMatrix(request.id))}
        onAdvanceToPlanning={() => run(() => advanceToPlanning(request.id))}
        onAdvanceToComplianceReview={() => run(() => advanceToComplianceReview(request.id))}
        onReturnToPlanning={(comment) => run(() => returnToPlanning(request.id, comment))}
        onAdvanceToInternalApproval={() => run(() => advanceToInternalApproval(request.id))}
        onApproveInternal={(comment) => run(() => approveInternal(request.id, comment))}
        onApproveClient={(ref) => run(() => approveClient(request.id, ref))}
        onMarkTravelArranged={() => run(() => markTravelArranged(request.id))}
        onMarkInTransit={() => run(() => markInTransit(request.id))}
        onComplete={() => run(() => completeMobilization(request.id))}
        onCancel={(reason) => run(() => cancelMobilization(request.id, reason))}
        onEmergencyFastTrack={() => run(() => emergencyFastTrack(request.id))}
      />

      <div className="flex gap-1.5 flex-wrap mb-4 mt-4 border-b pb-2" style={{ borderColor: "var(--ch-line)" }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="text-xs font-semibold rounded-lg px-3 py-1.5"
            style={tab === t.key ? { background: "var(--ch-navy)", color: "#fff" } : { background: "var(--ch-paper)", color: "var(--ch-sub)" }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" &&
        (editing ? (
          <HeaderForm
            request={request}
            onCancel={() => setEditing(false)}
            onSubmit={(fd) => {
              setError(null);
              setEditing(false);
              startTransition(async () => {
                const res = await updateMobilizationHeader(request.id, fd);
                if (res?.error) {
                  setError(res.error);
                  setEditing(true);
                  return;
                }
                router.refresh();
              });
            }}
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className={`${cardCls} p-4`} style={cardStyle}>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--ch-sub)" }}>Plan</div>
                {isEditableStage && canManage && (
                  <button onClick={() => setEditing(true)} className="text-xs font-semibold ch-link-navy">Edit</button>
                )}
              </div>
              <Row label="Request date" value={request.request_date} />
              <Row label="Required onboard date" value={request.required_onboard_date} />
              <Row label="Crew change location" value={request.crew_change_location} />
              <Row label="Travel origin" value={request.travel_origin} />
              <Row label="Coordinator" value={request.coordinator_name} />
              <Row label="Requested by" value={request.requested_by_name} />
              {request.approved_by_name && <Row label="Approved by" value={`${request.approved_by_name} (${request.approved_at ? new Date(request.approved_at).toLocaleString() : ""})`} />}
              <Row label="Client approval required" value={request.client_approval_required ? "Yes" : "No"} />
              {request.special_instructions && (
                <div className="mt-3">
                  <div className="text-xs mb-1" style={{ color: "var(--ch-sub)" }}>Special instructions</div>
                  <div className="text-sm whitespace-pre-wrap" style={{ color: "var(--ch-ink)" }}>{request.special_instructions}</div>
                </div>
              )}
            </div>
            <div className={`${cardCls} p-4`} style={cardStyle}>
              <div className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: "var(--ch-sub)" }}>Workflow</div>
              <ol className="space-y-1.5">
                {WORKFLOW_STAGES.map((stage) => {
                  const reached = WORKFLOW_STAGES.indexOf(stage) <= WORKFLOW_STAGES.indexOf(request.status);
                  const current = stage === request.status;
                  return (
                    <li key={stage} className="flex items-center gap-2 text-sm" style={{ color: current ? "var(--ch-ink)" : reached ? "var(--ch-sub)" : "#c7d0da" }}>
                      <span
                        className="inline-block w-2 h-2 rounded-full"
                        style={{ background: current ? "var(--ch-navy)" : reached ? "var(--ch-pass)" : "#e2e6eb" }}
                      />
                      <span className={current ? "font-semibold" : ""}>{stage.replace(/_/g, " ")}</span>
                    </li>
                  );
                })}
                {request.status === "partially_completed" && (
                  <li className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--ch-fail)" }}>
                    <span className="inline-block w-2 h-2 rounded-full" style={{ background: "var(--ch-fail)" }} />
                    partially completed
                  </li>
                )}
                {request.status === "cancelled" && (
                  <li className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--ch-fail)" }}>
                    <span className="inline-block w-2 h-2 rounded-full" style={{ background: "var(--ch-fail)" }} />
                    cancelled
                  </li>
                )}
              </ol>
            </div>
          </div>
        ))}

      {tab === "positions" && (
        <PositionsBoard
          requestId={request.id}
          requestStatus={request.status}
          positions={positions}
          jobRoles={jobRoles}
          canManage={canManage}
          canComplianceReview={canComplianceReview}
          canApprove={canApprove}
          isTerminal={isTerminal}
        />
      )}

      {tab === "timeline" && (
        <div className="space-y-2">
          {statusHistory.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No status changes recorded yet.</div>}
          {statusHistory.map((h) => (
            <div key={h.id} className={`${cardCls} p-3 flex items-center gap-2 flex-wrap text-sm`} style={cardStyle}>
              <span style={{ color: "var(--ch-sub)" }}>{new Date(h.changed_at).toLocaleString()}</span>
              <span>{(h.old_status ?? "—").replace(/_/g, " ")} → <strong>{h.new_status.replace(/_/g, " ")}</strong></span>
              <span style={{ color: "var(--ch-sub)" }}>by {h.changed_by_name}</span>
            </div>
          ))}
          {positionHistory.length > 0 && (
            <>
              <div className="text-xs font-semibold mt-5 mb-2 uppercase tracking-wide" style={{ color: "var(--ch-sub)" }}>Candidate changes</div>
              {positionHistory.map((h) => (
                <div key={h.id} className={`${cardCls} p-3 flex items-start gap-2 flex-wrap text-sm`} style={cardStyle}>
                  <span style={{ color: "var(--ch-sub)" }}>{new Date(h.changed_at).toLocaleString()}</span>
                  <span>
                    {h.previous_crew_name ?? "(open)"} → <strong>{h.new_crew_name ?? "(cleared)"}</strong>
                  </span>
                  {h.reason && <span style={{ color: "var(--ch-sub)" }}>— {h.reason}</span>}
                  <span style={{ color: "var(--ch-sub)" }}>by {h.changed_by_name}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {tab === "comments" && <CommentsPanel requestId={request.id} comments={comments} />}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 border-b last:border-0" style={{ borderColor: "var(--ch-line)" }}>
      <span className="text-xs" style={{ color: "var(--ch-sub)" }}>{label}</span>
      <span className="text-sm text-right" style={{ color: "var(--ch-ink)" }}>{value ?? "—"}</span>
    </div>
  );
}

const MOBILIZATION_TYPES = ["initial", "rotation_change", "replacement", "additional_manpower", "emergency", "demobilization"];
const PRIORITIES = ["normal", "urgent", "emergency"];

function HeaderForm({ request, onSubmit, onCancel }: { request: Request; onSubmit: (fd: FormData) => void; onCancel: () => void }) {
  const [values, setValues] = useState({
    mobilizationType: request.mobilization_type,
    requiredOnboardDate: request.required_onboard_date,
    crewChangeLocation: request.crew_change_location ?? "",
    travelOrigin: request.travel_origin ?? "",
    specialInstructions: request.special_instructions ?? "",
    priority: request.priority,
  });
  const [submitted, setSubmitted] = useState(false);
  const set = (k: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));

  const save = () => {
    if (!values.requiredOnboardDate || submitted) return;
    const fd = new FormData();
    Object.entries(values).forEach(([k, v]) => fd.set(k, v));
    setSubmitted(true);
    onSubmit(fd);
  };

  return (
    <div className={`${cardCls} p-4`} style={cardStyle}>
      <div className="grid gap-3 sm:grid-cols-3 mb-3">
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Mobilization type
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={values.mobilizationType} onChange={set("mobilizationType")}>
            {MOBILIZATION_TYPES.map((t) => (
              <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
            ))}
          </select>
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Priority
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={values.priority} onChange={set("priority")}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Required onboard date
          <input type="date" className={`${inputCls} w-full mt-1`} style={inputStyle} value={values.requiredOnboardDate} onChange={set("requiredOnboardDate")} />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 mb-3">
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Crew change location
          <input className={`${inputCls} w-full mt-1`} style={inputStyle} value={values.crewChangeLocation} onChange={set("crewChangeLocation")} />
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Travel origin
          <input className={`${inputCls} w-full mt-1`} style={inputStyle} value={values.travelOrigin} onChange={set("travelOrigin")} />
        </label>
      </div>
      <textarea className={`${inputCls} w-full mb-3`} style={inputStyle} placeholder="Special instructions" rows={2} value={values.specialInstructions} onChange={set("specialInstructions")} />
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={submitted || !values.requiredOnboardDate} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">Save</button>
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-line)" }}>Cancel</button>
      </div>
    </div>
  );
}

function CommentsPanel({ requestId, comments }: { requestId: string; comments: Comment[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = () => {
    if (!body.trim() || submitting) return;
    setError(null);
    setSubmitting(true);
    startTransition(async () => {
      const res = await postComment(requestId, body);
      setSubmitting(false);
      if (res?.error) {
        setError(res.error);
        return;
      }
      setBody("");
      router.refresh();
    });
  };

  return (
    <div>
      <div className={`${cardCls} p-3 mb-4`} style={cardStyle}>
        {error && <div className="text-sm mb-2" style={{ color: "var(--ch-fail)" }}>{error}</div>}
        <div className="flex items-center gap-2">
          <input
            className={`${inputCls} flex-1`}
            style={inputStyle}
            placeholder="Add a comment…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          <button onClick={submit} disabled={!body.trim() || submitting} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">Post</button>
        </div>
      </div>
      <div className="space-y-2">
        {comments.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No comments yet.</div>}
        {comments.map((c) => (
          <div key={c.id} className={`${cardCls} p-3 text-sm`} style={c.is_system ? { ...cardStyle, background: "var(--ch-paper)" } : cardStyle}>
            <div className="flex items-center gap-2 mb-1">
              <span className="font-semibold" style={{ color: c.is_system ? "var(--ch-sub)" : "var(--ch-ink)" }}>{c.author_name}</span>
              <span className="text-xs" style={{ color: "var(--ch-sub)" }}>{new Date(c.created_at).toLocaleString()}</span>
            </div>
            <div className={c.is_system ? "italic" : ""} style={{ color: c.is_system ? "var(--ch-sub)" : "var(--ch-ink)" }}>{c.body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function WorkflowActions({
  request,
  hasPositions,
  canManage,
  canComplianceReview,
  canApprove,
  canCancel,
  canEmergencyOverride,
  busy,
  onGeneratePositions,
  onAdvanceToPlanning,
  onAdvanceToComplianceReview,
  onReturnToPlanning,
  onAdvanceToInternalApproval,
  onApproveInternal,
  onApproveClient,
  onMarkTravelArranged,
  onMarkInTransit,
  onComplete,
  onCancel,
  onEmergencyFastTrack,
}: {
  request: Request;
  hasPositions: boolean;
  canManage: boolean;
  canComplianceReview: boolean;
  canApprove: boolean;
  canCancel: boolean;
  canEmergencyOverride: boolean;
  busy: boolean;
  onGeneratePositions: () => void;
  onAdvanceToPlanning: () => void;
  onAdvanceToComplianceReview: () => void;
  onReturnToPlanning: (comment: string) => void;
  onAdvanceToInternalApproval: () => void;
  onApproveInternal: (comment: string) => void;
  onApproveClient: (ref: string) => void;
  onMarkTravelArranged: () => void;
  onMarkInTransit: () => void;
  onComplete: () => void;
  onCancel: (reason: string) => void;
  onEmergencyFastTrack: () => void;
}) {
  const [openAction, setOpenAction] = useState<string | null>(null);
  const [text, setText] = useState("");
  const close = () => {
    setOpenAction(null);
    setText("");
  };
  const status = request.status;
  const isTerminal = TERMINAL_STATUSES.includes(status);

  const btn = (label: string, onClick: () => void, variant: "primary" | "danger" | "outline" = "outline", key?: string) => (
    <button
      key={key ?? label}
      onClick={onClick}
      disabled={busy}
      className="rounded-lg px-4 py-2 text-sm font-semibold border disabled:opacity-50"
      style={
        variant === "primary"
          ? { background: "var(--ch-navy)", color: "#fff", borderColor: "var(--ch-navy)" }
          : variant === "danger"
          ? { borderColor: "var(--ch-fail)", color: "var(--ch-fail)" }
          : { borderColor: "var(--ch-line)", color: "var(--ch-ink)" }
      }
    >
      {label}
    </button>
  );

  const buttons: React.ReactNode[] = [];
  if (status === "draft" && canManage) {
    if (!hasPositions) buttons.push(btn("Generate positions from matrix", onGeneratePositions, "primary", "gen"));
    buttons.push(btn("Advance to planning", onAdvanceToPlanning, "primary", "plan"));
  }
  if (status === "planning" && canManage) {
    buttons.push(btn("Advance to compliance review", onAdvanceToComplianceReview, "primary", "compliance"));
  }
  if (status === "compliance_review") {
    if (canComplianceReview) buttons.push(btn("Advance to internal approval", onAdvanceToInternalApproval, "primary", "internal"));
    if (canManage || canComplianceReview || canApprove) buttons.push(btn("Return to planning", () => setOpenAction("return"), "outline", "return1"));
  }
  if (status === "internal_approval") {
    if (canApprove) buttons.push(btn("Approve", () => setOpenAction("approveInternal"), "primary", "approveInt"));
    if (canManage || canComplianceReview || canApprove) buttons.push(btn("Return to planning", () => setOpenAction("return"), "outline", "return2"));
  }
  if (status === "client_approval") {
    if (canApprove) buttons.push(btn("Record client approval", () => setOpenAction("approveClient"), "primary", "approveClient"));
    if (canManage || canComplianceReview || canApprove) buttons.push(btn("Return to planning", () => setOpenAction("return"), "outline", "return3"));
  }
  if (status === "travel_arrangement" && canManage) {
    buttons.push(btn("Mark travel arranged", onMarkTravelArranged, "primary", "travel"));
  }
  if (status === "ready_to_mobilize" && canManage) {
    buttons.push(btn("Mark in transit", onMarkInTransit, "primary", "transit"));
  }
  if (status === "in_transit" && canManage) {
    buttons.push(btn("Complete mobilization", onComplete, "primary", "complete"));
  }
  if (!isTerminal && canCancel) {
    buttons.push(btn("Cancel", () => setOpenAction("cancel"), "danger", "cancel"));
  }
  if (request.priority === "emergency" && canEmergencyOverride && !isTerminal && !["ready_to_mobilize", "in_transit"].includes(status)) {
    buttons.push(btn("Emergency fast-track", onEmergencyFastTrack, "danger", "emergency"));
  }

  if (buttons.length === 0 && !openAction) return null;

  return (
    <div className={`${cardCls} p-3 mb-2`} style={cardStyle}>
      <div className="flex items-center gap-2 flex-wrap">{buttons}</div>
      {openAction && (
        <div className="mt-3 pt-3 border-t" style={{ borderColor: "var(--ch-line)" }}>
          {openAction === "return" && (
            <ActionForm
              label="Correction comment (required)"
              placeholder="What needs to be corrected?"
              required
              confirmLabel="Return to planning"
              text={text}
              setText={setText}
              onConfirm={() => {
                onReturnToPlanning(text);
                close();
              }}
              onCancel={close}
            />
          )}
          {openAction === "approveInternal" && (
            <ActionForm
              label="Approval comment (optional)"
              placeholder="Optional comment"
              required={false}
              confirmLabel="Confirm approval"
              text={text}
              setText={setText}
              onConfirm={() => {
                onApproveInternal(text);
                close();
              }}
              onCancel={close}
            />
          )}
          {openAction === "approveClient" && (
            <ActionForm
              label="Client approval reference (optional)"
              placeholder="e.g. client email or approval number"
              required={false}
              confirmLabel="Confirm client approval"
              text={text}
              setText={setText}
              onConfirm={() => {
                onApproveClient(text);
                close();
              }}
              onCancel={close}
            />
          )}
          {openAction === "cancel" && (
            <ActionForm
              label="Cancellation reason (required)"
              placeholder="Why is this being cancelled?"
              required
              confirmLabel="Confirm cancellation"
              text={text}
              setText={setText}
              onConfirm={() => {
                onCancel(text);
                close();
              }}
              onCancel={close}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ActionForm({
  label,
  placeholder,
  required,
  confirmLabel,
  text,
  setText,
  onConfirm,
  onCancel,
}: {
  label: string;
  placeholder: string;
  required: boolean;
  confirmLabel: string;
  text: string;
  setText: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div>
      <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
        {label}
        <textarea className={`${inputCls} w-full mt-1`} style={inputStyle} rows={2} placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <div className="flex items-center gap-2 mt-2">
        <button onClick={onConfirm} disabled={required && !text.trim()} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
          {confirmLabel}
        </button>
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-line)" }}>Cancel</button>
      </div>
    </div>
  );
}
