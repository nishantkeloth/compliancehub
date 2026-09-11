"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addAdditionalPosition,
  deleteAdditionalPosition,
  listCandidates,
  selectCandidate,
  replaceCandidate,
  clearCandidate,
  markPositionCompliance,
  approvePosition,
  markPositionVacant,
  confirmBoarding,
  getPositionReadiness,
  listWaiversForPosition,
  type Candidate,
} from "../actions";
import { requestWaiver, decideWaiver, cancelWaiver } from "../waivers-actions";
import { CHECK_DESCRIPTIONS, type CheckCode, type ReadinessCheck, type OverallOutcome } from "@/lib/readiness";

type Waiver = {
  id: string;
  check_code: string;
  requirement_description: string | null;
  justification: string;
  attachment_url: string | null;
  status: string;
  requested_by: string | null;
  requested_by_name: string;
  requested_at: string;
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string | null;
  expires_at: string | null;
};

const OUTCOME_COLORS: Record<OverallOutcome, { bg: string; fg: string; label: string }> = {
  ready: { bg: "var(--ch-pass-bg)", fg: "var(--ch-pass)", label: "Ready" },
  ready_with_warning: { bg: "#fef3e2", fg: "#b45309", label: "Ready (warnings)" },
  overridden: { bg: "var(--ch-navy-soft)", fg: "var(--ch-navy)", label: "Ready (waived)" },
  not_ready: { bg: "var(--ch-fail-bg)", fg: "var(--ch-fail)", label: "Not ready" },
};

const CHECK_RESULT_COLORS: Record<ReadinessCheck["result"], { bg: string; fg: string }> = {
  pass: { bg: "var(--ch-pass-bg)", fg: "var(--ch-pass)" },
  warning: { bg: "#fef3e2", fg: "#b45309" },
  fail: { bg: "var(--ch-fail-bg)", fg: "var(--ch-fail)" },
  overridden: { bg: "var(--ch-navy-soft)", fg: "var(--ch-navy)" },
  not_applicable: { bg: "var(--ch-paper)", fg: "var(--ch-sub)" },
};

export type Position = {
  id: string;
  crew_matrix_line_id: string | null;
  job_role_id: string;
  job_role_name: string;
  position_sequence: number;
  required_onboard_date: string | null;
  selected_crew_id: string | null;
  selected_crew_name: string | null;
  selected_crew_code: string | null;
  reliever_for_crew_id: string | null;
  reliever_for_crew_name: string | null;
  readiness_status: string;
  client_approval_status: string;
  final_status: string;
  is_additional: boolean;
  additional_reason: string | null;
  remarks: string | null;
};
type JobRole = { id: string; name: string };

const inputCls = "border rounded-lg px-3 py-2 text-sm";
const inputStyle = { borderColor: "var(--ch-line)" };
const cardCls = "bg-white border rounded-xl";
const cardStyle = { borderColor: "var(--ch-line)" };

const TIER_COLORS: Record<Candidate["tier"], { bg: string; fg: string }> = {
  eligible: { bg: "var(--ch-pass-bg)", fg: "var(--ch-pass)" },
  partial: { bg: "#fef3e2", fg: "#b45309" },
  ineligible: { bg: "var(--ch-fail-bg)", fg: "var(--ch-fail)" },
};

function pill(text: string, bg: string, fg: string) {
  return (
    <span className="text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5" style={{ background: bg, color: fg }}>
      {text}
    </span>
  );
}

export default function PositionsBoard({
  requestId,
  requestStatus,
  positions,
  jobRoles,
  canManage,
  canComplianceReview,
  canApprove,
  isTerminal,
}: {
  requestId: string;
  requestStatus: string;
  positions: Position[];
  jobRoles: JobRole[];
  canManage: boolean;
  canComplianceReview: boolean;
  canApprove: boolean;
  isTerminal: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [addingRole, setAddingRole] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const groups = new Map<string, Position[]>();
  for (const p of positions) {
    const list = groups.get(p.job_role_id) ?? [];
    list.push(p);
    groups.set(p.job_role_id, list);
  }

  const run = (fn: () => Promise<{ error?: string } | undefined>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res?.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div>
      {error && <div className="text-sm mb-3" style={{ color: "var(--ch-fail)" }}>{error}</div>}

      {canManage && !isTerminal && (
        <div className="mb-4">
          {addingRole ? (
            <AddPositionForm
              jobRoles={jobRoles}
              onSubmit={(fd) => {
                startTransition(async () => {
                  const res = await addAdditionalPosition(requestId, fd);
                  if (res?.error) {
                    setError(res.error);
                    return;
                  }
                  setAddingRole(false);
                  router.refresh();
                });
              }}
              onCancel={() => setAddingRole(false)}
            />
          ) : (
            <button onClick={() => setAddingRole(true)} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold">
              + Add position outside the matrix
            </button>
          )}
        </div>
      )}

      {positions.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No positions yet — generate them from the crew matrix.</div>}

      <div className="space-y-5">
        {Array.from(groups.entries()).map(([roleId, rows]) => {
          const roleName = rows[0]?.job_role_name ?? "—";
          const required = rows.length;
          const selectedCount = rows.filter((p) => p.selected_crew_id).length;
          const approvedCount = rows.filter((p) => p.client_approval_status === "approved" || p.client_approval_status === "not_required").length;
          const remaining = required - selectedCount;
          return (
            <div key={roleId}>
              <div className="flex items-center gap-3 flex-wrap mb-2">
                <span className="text-sm font-semibold" style={{ color: "var(--ch-ink)" }}>{roleName}</span>
                <span className="text-xs" style={{ color: "var(--ch-sub)" }}>
                  Required {required} · Selected {selectedCount} · Approved {approvedCount} · Remaining <strong style={{ color: remaining > 0 ? "var(--ch-fail)" : "var(--ch-sub)" }}>{remaining}</strong>
                </span>
              </div>
              <div className="space-y-2">
                {rows.map((p) => (
                  <PositionRow
                    key={p.id}
                    requestId={requestId}
                    requestStatus={requestStatus}
                    position={p}
                    canManage={canManage}
                    canComplianceReview={canComplianceReview}
                    canApprove={canApprove}
                    isTerminal={isTerminal}
                    run={run}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AddPositionForm({
  jobRoles,
  onSubmit,
  onCancel,
}: {
  jobRoles: JobRole[];
  onSubmit: (fd: FormData) => void;
  onCancel: () => void;
}) {
  const [jobRoleId, setJobRoleId] = useState(jobRoles[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const [requiredOnboardDate, setRequiredOnboardDate] = useState("");

  const save = () => {
    if (!jobRoleId || !reason.trim()) return;
    const fd = new FormData();
    fd.set("jobRoleId", jobRoleId);
    fd.set("reason", reason.trim());
    fd.set("requiredOnboardDate", requiredOnboardDate);
    onSubmit(fd);
  };

  return (
    <div className={`${cardCls} p-4`} style={cardStyle}>
      <div className="grid gap-3 sm:grid-cols-2 mb-3">
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Job role
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={jobRoleId} onChange={(e) => setJobRoleId(e.target.value)}>
            {jobRoles.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Required onboard date (optional override)
          <input type="date" className={`${inputCls} w-full mt-1`} style={inputStyle} value={requiredOnboardDate} onChange={(e) => setRequiredOnboardDate(e.target.value)} />
        </label>
      </div>
      <textarea className={`${inputCls} w-full mb-3`} style={inputStyle} placeholder="Reason this position is needed outside the crew matrix" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={!jobRoleId || !reason.trim()} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">Add position</button>
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-line)" }}>Cancel</button>
      </div>
    </div>
  );
}

function PositionRow({
  requestId,
  requestStatus,
  position,
  canManage,
  canComplianceReview,
  canApprove,
  isTerminal,
  run,
}: {
  requestId: string;
  requestStatus: string;
  position: Position;
  canManage: boolean;
  canComplianceReview: boolean;
  canApprove: boolean;
  isTerminal: boolean;
  run: (fn: () => Promise<{ error?: string } | undefined>) => void;
}) {
  const [panel, setPanel] = useState<"none" | "select" | "replace" | "vacant" | "compliance" | "approval" | "readiness" | "boarding">("none");
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [reasonText, setReasonText] = useState("");
  const [readinessChecks, setReadinessChecks] = useState<ReadinessCheck[] | null>(null);
  const [readinessOutcome, setReadinessOutcome] = useState<OverallOutcome | null>(null);
  const [readinessError, setReadinessError] = useState<string | null>(null);
  const [loadingReadiness, setLoadingReadiness] = useState(false);
  const [waivers, setWaivers] = useState<Waiver[] | null>(null);
  const [waiverFormFor, setWaiverFormFor] = useState<CheckCode | null>(null);

  const openPanel = (mode: "select" | "replace") => {
    setPanel(mode);
    setReasonText("");
    setCandidates(null);
    setLoadingCandidates(true);
    listCandidates(position.id).then((res) => {
      setLoadingCandidates(false);
      if ("candidates" in res) setCandidates(res.candidates);
    });
  };

  const loadReadiness = () => {
    setPanel("readiness");
    setReadinessError(null);
    setReadinessChecks(null);
    setReadinessOutcome(null);
    setWaiverFormFor(null);
    setLoadingReadiness(true);
    Promise.all([getPositionReadiness(position.id), listWaiversForPosition(position.id)]).then(([readinessRes, waiversRes]) => {
      setLoadingReadiness(false);
      if ("error" in readinessRes) setReadinessError(readinessRes.error);
      else {
        setReadinessChecks(readinessRes.evaluation.checks);
        setReadinessOutcome(readinessRes.evaluation.overallOutcome);
      }
      if ("waivers" in waiversRes) setWaivers(waiversRes.waivers as Waiver[]);
    });
  };

  const refreshReadiness = () => {
    Promise.all([getPositionReadiness(position.id), listWaiversForPosition(position.id)]).then(([readinessRes, waiversRes]) => {
      if ("error" in readinessRes) setReadinessError(readinessRes.error);
      else {
        setReadinessChecks(readinessRes.evaluation.checks);
        setReadinessOutcome(readinessRes.evaluation.overallOutcome);
      }
      if ("waivers" in waiversRes) setWaivers(waiversRes.waivers as Waiver[]);
    });
  };

  const choose = (crewId: string) => {
    if (panel === "select") {
      run(() => selectCandidate(position.id, requestId, crewId));
    } else if (panel === "replace") {
      if (!reasonText.trim()) return;
      run(() => replaceCandidate(position.id, requestId, crewId, reasonText.trim()));
    }
    setPanel("none");
  };

  return (
    <div className={`${cardCls}`} style={cardStyle}>
      <div className="p-3 flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-mono font-bold rounded px-1.5 py-0.5" style={{ background: "var(--ch-navy-soft)", color: "var(--ch-navy)" }}>
          #{position.position_sequence}
        </span>
        {position.is_additional && pill("outside matrix", "var(--ch-navy-soft)", "var(--ch-navy)")}
        {position.selected_crew_id ? (
          <span className="text-sm font-semibold" style={{ color: "var(--ch-ink)" }}>
            {position.selected_crew_name} {position.selected_crew_code ? `(${position.selected_crew_code})` : ""}
          </span>
        ) : (
          <span className="text-sm italic" style={{ color: "var(--ch-sub)" }}>Open</span>
        )}
        {pill(position.readiness_status.replace(/_/g, " "), "var(--ch-paper)", "var(--ch-sub)")}
        {position.client_approval_status !== "not_required" &&
          pill(
            position.client_approval_status,
            position.client_approval_status === "approved" ? "var(--ch-pass-bg)" : position.client_approval_status === "rejected" ? "var(--ch-fail-bg)" : "var(--ch-paper)",
            position.client_approval_status === "approved" ? "var(--ch-pass)" : position.client_approval_status === "rejected" ? "var(--ch-fail)" : "var(--ch-sub)"
          )}
        {position.final_status !== "pending" &&
          pill(position.final_status, position.final_status === "filled" ? "var(--ch-pass-bg)" : "var(--ch-fail-bg)", position.final_status === "filled" ? "var(--ch-pass)" : "var(--ch-fail)")}
        {position.reliever_for_crew_name && <span className="text-xs" style={{ color: "var(--ch-sub)" }}>relieving {position.reliever_for_crew_name}</span>}

        <div className="ml-auto flex items-center gap-1.5 flex-wrap">
          {position.selected_crew_id && (
            <button onClick={loadReadiness} className="text-xs font-semibold ch-link-navy">Readiness</button>
          )}
          {canManage && !isTerminal && position.final_status === "pending" && !position.selected_crew_id && (
            <button onClick={() => openPanel("select")} className="text-xs font-semibold ch-link-navy">Select candidate</button>
          )}
          {canManage && !isTerminal && position.final_status === "pending" && position.selected_crew_id && (
            <>
              <button onClick={() => openPanel("replace")} className="text-xs font-semibold ch-link-navy">Replace</button>
              <button onClick={() => run(() => clearCandidate(position.id, requestId))} className="text-xs font-semibold" style={{ color: "var(--ch-fail)" }}>Clear</button>
            </>
          )}
          {requestStatus === "compliance_review" && canComplianceReview && position.selected_crew_id && (
            <>
              <button onClick={() => run(() => markPositionCompliance(position.id, requestId, true))} className="text-xs font-semibold" style={{ color: "var(--ch-pass)" }}>Mark cleared</button>
              <button onClick={() => run(() => markPositionCompliance(position.id, requestId, false))} className="text-xs font-semibold" style={{ color: "var(--ch-fail)" }}>Flag issue</button>
            </>
          )}
          {requestStatus === "client_approval" && canApprove && position.client_approval_status === "pending" && (
            <>
              <button onClick={() => run(() => approvePosition(position.id, requestId, true))} className="text-xs font-semibold" style={{ color: "var(--ch-pass)" }}>Client approve</button>
              <button onClick={() => run(() => approvePosition(position.id, requestId, false))} className="text-xs font-semibold" style={{ color: "var(--ch-fail)" }}>Client reject</button>
            </>
          )}
          {["ready_to_mobilize", "in_transit"].includes(requestStatus) && canManage && position.selected_crew_id && position.final_status === "pending" && (
            <button onClick={() => setPanel(panel === "boarding" ? "none" : "boarding")} className="text-xs font-semibold" style={{ color: "var(--ch-pass)" }}>Confirm boarding</button>
          )}
          {canManage && !isTerminal && position.final_status === "pending" && (
            <button onClick={() => setPanel(panel === "vacant" ? "none" : "vacant")} className="text-xs font-semibold" style={{ color: "var(--ch-fail)" }}>Mark vacant</button>
          )}
          {canManage && !isTerminal && position.is_additional && (
            <button onClick={() => run(() => deleteAdditionalPosition(position.id, requestId))} className="text-xs font-semibold" style={{ color: "var(--ch-fail)" }}>Remove</button>
          )}
        </div>
      </div>

      {position.is_additional && position.additional_reason && (
        <div className="px-3 pb-2 text-xs" style={{ color: "var(--ch-sub)" }}>Reason: {position.additional_reason}</div>
      )}
      {position.remarks && <div className="px-3 pb-2 text-xs" style={{ color: "var(--ch-sub)" }}>{position.remarks}</div>}

      {panel === "vacant" && (
        <div className="border-t p-3" style={{ borderColor: "var(--ch-line)" }}>
          <VacantForm
            onConfirm={(reason) => {
              run(() => markPositionVacant(position.id, requestId, reason));
              setPanel("none");
            }}
            onCancel={() => setPanel("none")}
          />
        </div>
      )}

      {panel === "boarding" && (
        <div className="border-t p-3" style={{ borderColor: "var(--ch-line)" }}>
          <BoardingForm
            crewName={position.selected_crew_name ?? "crew member"}
            onSubmit={(fd) => {
              run(() => confirmBoarding(position.id, requestId, fd));
              setPanel("none");
            }}
            onCancel={() => setPanel("none")}
          />
        </div>
      )}

      {panel === "readiness" && (
        <div className="border-t p-3" style={{ borderColor: "var(--ch-line)" }}>
          <ReadinessPanel
            checks={readinessChecks}
            outcome={readinessOutcome}
            error={readinessError}
            loading={loadingReadiness}
            waivers={waivers}
            positionId={position.id}
            crewId={position.selected_crew_id}
            requestId={requestId}
            canRequest={canManage || canComplianceReview}
            canApprove={canApprove}
            waiverFormFor={waiverFormFor}
            setWaiverFormFor={setWaiverFormFor}
            onRefresh={refreshReadiness}
            onClose={() => setPanel("none")}
          />
        </div>
      )}

      {(panel === "select" || panel === "replace") && (
        <div className="border-t p-3" style={{ borderColor: "var(--ch-line)" }}>
          {panel === "replace" && (
            <textarea
              className={`${inputCls} w-full mb-3`}
              style={inputStyle}
              placeholder="Reason for replacing the selected candidate (required)"
              rows={2}
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
            />
          )}
          {loadingCandidates && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>Loading candidates…</div>}
          {candidates && candidates.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No candidates found for this role.</div>}
          {candidates && (
            <div className="space-y-1.5">
              {candidates.map((c) => {
                const colors = TIER_COLORS[c.tier];
                const disabled = panel === "replace" && !reasonText.trim();
                return (
                  <div key={c.id} className="flex items-center gap-2 flex-wrap text-sm border rounded-lg px-2.5 py-1.5" style={{ borderColor: "var(--ch-line)" }}>
                    {pill(c.tier, colors.bg, colors.fg)}
                    <span className="font-semibold" style={{ color: "var(--ch-ink)" }}>{c.full_name}</span>
                    {c.employee_code && <span className="text-xs" style={{ color: "var(--ch-sub)" }}>{c.employee_code}</span>}
                    {c.current_vessel && <span className="text-xs" style={{ color: "var(--ch-sub)" }}>on {c.current_vessel}</span>}
                    {c.current_rotation && <span className="text-xs" style={{ color: "var(--ch-sub)" }}>{c.current_rotation}</span>}
                    <span className="text-xs" style={{ color: "var(--ch-sub)" }}>Skills {c.skill_match}</span>
                    {c.availability_date && <span className="text-xs" style={{ color: "var(--ch-sub)" }}>Available {c.availability_date}</span>}
                    {c.day_rate != null && <span className="text-xs" style={{ color: "var(--ch-sub)" }}>{c.currency ?? ""} {c.day_rate}/day</span>}
                    {c.reasons.length > 0 && <span className="text-xs w-full" style={{ color: "var(--ch-sub)" }}>{c.reasons.join(" ")}</span>}
                    <button
                      onClick={() => choose(c.id)}
                      disabled={disabled}
                      className="ml-auto text-xs font-semibold ch-link-navy disabled:opacity-40"
                    >
                      Choose
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <button onClick={() => setPanel("none")} className="text-xs font-semibold mt-2" style={{ color: "var(--ch-sub)" }}>Cancel</button>
        </div>
      )}
    </div>
  );
}

function ReadinessPanel({
  checks,
  outcome,
  error,
  loading,
  waivers,
  positionId,
  crewId,
  requestId,
  canRequest,
  canApprove,
  waiverFormFor,
  setWaiverFormFor,
  onRefresh,
  onClose,
}: {
  checks: ReadinessCheck[] | null;
  outcome: OverallOutcome | null;
  error: string | null;
  loading: boolean;
  waivers: Waiver[] | null;
  positionId: string;
  crewId: string | null;
  requestId: string;
  canRequest: boolean;
  canApprove: boolean;
  waiverFormFor: CheckCode | null;
  setWaiverFormFor: (c: CheckCode | null) => void;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const waiverByCheck = (code: string) => (waivers ?? []).find((w) => w.check_code === code && (w.status === "pending" || w.status === "approved"));

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold" style={{ color: "var(--ch-ink)" }}>Readiness</span>
          {outcome && (() => {
            const c = OUTCOME_COLORS[outcome];
            return <span className="text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5" style={{ background: c.bg, color: c.fg }}>{c.label}</span>;
          })()}
        </div>
        <button onClick={onClose} className="text-xs font-semibold" style={{ color: "var(--ch-sub)" }}>Close</button>
      </div>

      {loading && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>Evaluating…</div>}
      {error && <div className="text-sm" style={{ color: "var(--ch-fail)" }}>{error}</div>}
      {localError && <div className="text-sm mb-2" style={{ color: "var(--ch-fail)" }}>{localError}</div>}

      {checks && (
        <div className="space-y-1.5">
          {checks.map((chk) => {
            const colors = CHECK_RESULT_COLORS[chk.result];
            const existingWaiver = waiverByCheck(chk.code);
            const canWaiveThis = chk.blocking && chk.result === "fail" && !existingWaiver;
            return (
              <div key={chk.code} className="border rounded-lg px-2.5 py-2" style={{ borderColor: "var(--ch-line)" }}>
                <div className="flex items-center gap-2 flex-wrap">
                  {pill(chk.result.replace(/_/g, " "), colors.bg, colors.fg)}
                  {chk.blocking && pill("blocking", "var(--ch-fail-bg)", "var(--ch-fail)")}
                  <span className="text-xs font-semibold" style={{ color: "var(--ch-ink)" }}>{chk.description}</span>
                </div>
                {(chk.requiredValue || chk.actualValue) && (
                  <div className="text-[11px] mt-1" style={{ color: "var(--ch-sub)" }}>
                    {chk.requiredValue && <>Required: {chk.requiredValue} </>}
                    {chk.actualValue && <>· Actual: {chk.actualValue}</>}
                  </div>
                )}
                {chk.recommendedAction && <div className="text-[11px] mt-1" style={{ color: "var(--ch-sub)" }}>{chk.recommendedAction}</div>}
                {canRequest && canWaiveThis && crewId && (
                  <button onClick={() => setWaiverFormFor(waiverFormFor === chk.code ? null : chk.code)} className="text-xs font-semibold ch-link-navy mt-1.5">
                    {waiverFormFor === chk.code ? "Cancel waiver request" : "Request waiver"}
                  </button>
                )}
                {waiverFormFor === chk.code && crewId && (
                  <WaiverRequestForm
                    checkCode={chk.code}
                    description={chk.description}
                    onCancel={() => setWaiverFormFor(null)}
                    onSubmit={(fd) => {
                      setLocalError(null);
                      setBusy(true);
                      startTransition(async () => {
                        const res = await requestWaiver(positionId, crewId, requestId, fd);
                        setBusy(false);
                        if (res?.error) {
                          setLocalError(res.error);
                          return;
                        }
                        setWaiverFormFor(null);
                        onRefresh();
                      });
                    }}
                    busy={busy}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {waivers && waivers.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-semibold mb-1.5" style={{ color: "var(--ch-ink)" }}>Compliance waivers</div>
          <div className="space-y-1.5">
            {waivers.map((w) => {
              const statusColors =
                w.status === "approved"
                  ? { bg: "var(--ch-pass-bg)", fg: "var(--ch-pass)" }
                  : w.status === "rejected" || w.status === "cancelled"
                    ? { bg: "var(--ch-fail-bg)", fg: "var(--ch-fail)" }
                    : { bg: "#fef3e2", fg: "#b45309" };
              return (
                <div key={w.id} className="border rounded-lg px-2.5 py-2 text-xs" style={{ borderColor: "var(--ch-line)" }}>
                  <div className="flex items-center gap-2 flex-wrap">
                    {pill(w.status, statusColors.bg, statusColors.fg)}
                    <span className="font-semibold" style={{ color: "var(--ch-ink)" }}>{CHECK_DESCRIPTIONS[w.check_code as CheckCode] ?? w.check_code}</span>
                  </div>
                  <div className="mt-1" style={{ color: "var(--ch-sub)" }}>{w.justification}</div>
                  {w.attachment_url && (
                    <div className="mt-1">
                      <a href={w.attachment_url} target="_blank" rel="noreferrer" className="ch-link-navy font-semibold">Supporting attachment</a>
                    </div>
                  )}
                  <div className="mt-1" style={{ color: "var(--ch-sub)" }}>
                    Requested by {w.requested_by_name} on {w.requested_at.slice(0, 10)}
                    {w.expires_at && <> · Expires {w.expires_at}</>}
                  </div>
                  {w.decided_by_name && (
                    <div style={{ color: "var(--ch-sub)" }}>
                      Decided by {w.decided_by_name}{w.decided_at ? ` on ${w.decided_at.slice(0, 10)}` : ""}{w.decision_note ? ` — ${w.decision_note}` : ""}
                    </div>
                  )}
                  {canApprove && w.status === "pending" && (
                    <div className="flex items-center gap-2 mt-1.5">
                      <button
                        onClick={() => {
                          setLocalError(null);
                          startTransition(async () => {
                            const fd = new FormData();
                            const res = await decideWaiver(w.id, requestId, true, fd);
                            if (res?.error) setLocalError(res.error);
                            else onRefresh();
                          });
                        }}
                        className="text-xs font-semibold"
                        style={{ color: "var(--ch-pass)" }}
                      >
                        Approve
                      </button>
                      <RejectWaiverButton
                        onReject={(note) => {
                          setLocalError(null);
                          startTransition(async () => {
                            const fd = new FormData();
                            fd.set("decisionNote", note);
                            const res = await decideWaiver(w.id, requestId, false, fd);
                            if (res?.error) setLocalError(res.error);
                            else onRefresh();
                          });
                        }}
                      />
                    </div>
                  )}
                  {canRequest && w.status === "pending" && (
                    <button
                      onClick={() => {
                        startTransition(async () => {
                          const res = await cancelWaiver(w.id, requestId);
                          if (res?.error) setLocalError(res.error);
                          else onRefresh();
                        });
                      }}
                      className="text-xs font-semibold mt-1.5"
                      style={{ color: "var(--ch-sub)" }}
                    >
                      Withdraw
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function WaiverRequestForm({
  checkCode,
  description,
  onCancel,
  onSubmit,
  busy,
}: {
  checkCode: CheckCode;
  description: string;
  onCancel: () => void;
  onSubmit: (fd: FormData) => void;
  busy: boolean;
}) {
  const [justification, setJustification] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  const submit = () => {
    if (!justification.trim()) return;
    const fd = new FormData();
    fd.set("checkCode", checkCode);
    fd.set("requirementDescription", description);
    fd.set("justification", justification.trim());
    fd.set("attachmentUrl", attachmentUrl.trim());
    fd.set("expiresAt", expiresAt);
    onSubmit(fd);
  };

  return (
    <div className="mt-2 border-t pt-2" style={{ borderColor: "var(--ch-line)" }}>
      <textarea
        className={`${inputCls} w-full mb-2`}
        style={inputStyle}
        placeholder="Justification for waiving this requirement (required)"
        rows={2}
        value={justification}
        onChange={(e) => setJustification(e.target.value)}
      />
      <div className="grid gap-2 sm:grid-cols-2 mb-2">
        <input
          className={`${inputCls} w-full`}
          style={inputStyle}
          placeholder="Supporting attachment URL (optional)"
          value={attachmentUrl}
          onChange={(e) => setAttachmentUrl(e.target.value)}
        />
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Expires (optional)
          <input type="date" className={`${inputCls} w-full mt-1`} style={inputStyle} value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
        </label>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={submit} disabled={!justification.trim() || busy} className="ch-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50">
          Submit waiver request
        </button>
        <button onClick={onCancel} className="text-xs font-semibold" style={{ color: "var(--ch-sub)" }}>Cancel</button>
      </div>
    </div>
  );
}

function RejectWaiverButton({ onReject }: { onReject: (note: string) => void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-xs font-semibold" style={{ color: "var(--ch-fail)" }}>
        Reject
      </button>
    );
  }
  return (
    <span className="flex items-center gap-1.5">
      <input
        className={`${inputCls}`}
        style={{ ...inputStyle, width: 160 }}
        placeholder="Reason (required)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <button
        onClick={() => {
          if (!note.trim()) return;
          onReject(note.trim());
          setOpen(false);
          setNote("");
        }}
        disabled={!note.trim()}
        className="text-xs font-semibold disabled:opacity-40"
        style={{ color: "var(--ch-fail)" }}
      >
        Confirm reject
      </button>
    </span>
  );
}

// Phase 6: boarding is a captured event — actual travel/onboard times,
// vessel acknowledgement, reference, supporting document. This is the
// only thing that creates the active crew_assignment.
function BoardingForm({ crewName, onSubmit, onCancel }: { crewName: string; onSubmit: (fd: FormData) => void; onCancel: () => void }) {
  const [actualDepartureAt, setActualDepartureAt] = useState("");
  const [actualArrivalAt, setActualArrivalAt] = useState("");
  const [actualOnboardAt, setActualOnboardAt] = useState(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16));
  const [vesselAcknowledged, setVesselAcknowledged] = useState(false);
  const [vesselAcknowledgedBy, setVesselAcknowledgedBy] = useState("");
  const [boardingReference, setBoardingReference] = useState("");
  const [shift, setShift] = useState("");
  const [remarks, setRemarks] = useState("");
  const [supportingDocumentUrl, setSupportingDocumentUrl] = useState("");

  const submit = () => {
    if (!actualOnboardAt) return;
    const fd = new FormData();
    fd.set("actualDepartureAt", actualDepartureAt);
    fd.set("actualArrivalAt", actualArrivalAt);
    fd.set("actualOnboardAt", actualOnboardAt);
    if (vesselAcknowledged) fd.set("vesselAcknowledged", "on");
    fd.set("vesselAcknowledgedBy", vesselAcknowledgedBy);
    fd.set("boardingReference", boardingReference);
    fd.set("shift", shift);
    fd.set("remarks", remarks);
    fd.set("supportingDocumentUrl", supportingDocumentUrl);
    onSubmit(fd);
  };

  return (
    <div>
      <div className="text-sm font-semibold mb-2" style={{ color: "var(--ch-ink)" }}>Confirm boarding — {crewName}</div>
      <div className="grid gap-3 sm:grid-cols-3 mb-3">
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Actual departure
          <input type="datetime-local" className={`${inputCls} w-full mt-1`} style={inputStyle} value={actualDepartureAt} onChange={(e) => setActualDepartureAt(e.target.value)} />
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Actual arrival
          <input type="datetime-local" className={`${inputCls} w-full mt-1`} style={inputStyle} value={actualArrivalAt} onChange={(e) => setActualArrivalAt(e.target.value)} />
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Actual onboard (required)
          <input type="datetime-local" className={`${inputCls} w-full mt-1`} style={inputStyle} value={actualOnboardAt} onChange={(e) => setActualOnboardAt(e.target.value)} />
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Boarding reference
          <input className={`${inputCls} w-full mt-1`} style={inputStyle} value={boardingReference} onChange={(e) => setBoardingReference(e.target.value)} placeholder="Vessel / agent reference" />
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Shift
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={shift} onChange={(e) => setShift(e.target.value)}>
            <option value="">—</option>
            <option value="day">Day</option>
            <option value="night">Night</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Supporting document URL
          <input className={`${inputCls} w-full mt-1`} style={inputStyle} value={supportingDocumentUrl} onChange={(e) => setSupportingDocumentUrl(e.target.value)} placeholder="Optional" />
        </label>
      </div>
      <div className="flex items-center gap-3 flex-wrap mb-3">
        <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--ch-ink)" }}>
          <input type="checkbox" checked={vesselAcknowledged} onChange={(e) => setVesselAcknowledged(e.target.checked)} /> Vessel acknowledged
        </label>
        <input className={`${inputCls} w-64`} style={inputStyle} value={vesselAcknowledgedBy} onChange={(e) => setVesselAcknowledgedBy(e.target.value)} placeholder="Acknowledged by (name / role)" />
      </div>
      <textarea className={`${inputCls} w-full mb-3`} style={inputStyle} rows={2} placeholder="Remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      <div className="flex items-center gap-2">
        <button onClick={submit} disabled={!actualOnboardAt} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">Confirm boarding</button>
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-line)" }}>Cancel</button>
      </div>
    </div>
  );
}

function VacantForm({ onConfirm, onCancel }: { onConfirm: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState("");
  return (
    <div>
      <textarea className={`${inputCls} w-full mb-2`} style={inputStyle} placeholder="Reason this position is being left vacant" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="flex items-center gap-2">
        <button onClick={() => onConfirm(reason)} disabled={!reason.trim()} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">Confirm vacant</button>
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-line)" }}>Cancel</button>
      </div>
    </div>
  );
}
