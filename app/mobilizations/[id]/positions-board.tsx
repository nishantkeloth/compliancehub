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
  type Candidate,
} from "../actions";

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
  const [panel, setPanel] = useState<"none" | "select" | "replace" | "vacant" | "compliance" | "approval">("none");
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [reasonText, setReasonText] = useState("");

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
            <button onClick={() => run(() => confirmBoarding(position.id, requestId))} className="text-xs font-semibold" style={{ color: "var(--ch-pass)" }}>Confirm boarding</button>
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
