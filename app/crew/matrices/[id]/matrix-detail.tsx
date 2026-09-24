"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  updateCrewMatrixHeader,
  deleteCrewMatrix,
  getMatrixSiteActiveAssignments,
  submitForApproval,
  approveInternal,
  rejectInternal,
  returnForCorrection,
  approveClient,
  rejectClient,
  approveCurrentStage,
  rejectCurrentStage,
  returnCurrentStageForCorrection,
  activateCrewMatrix,
  cancelCrewMatrix,
  createNewVersion,
} from "../actions";
import { StatusPill } from "@/app/contracts/contracts-manager";
import AiReviewPanel from "./ai-review-panel";
import LinesEditor, { type Line, type Ref, type DocTypeRef } from "./lines-editor";
import StaffingPlanView, { type StaffingCrew, type FieldDef } from "./staffing-plan";
import SendMatrixWizard from "./send-matrix-wizard";
import SharingHistoryPanel from "./sharing-history-panel";

type Matrix = {
  id: string;
  matrix_number: string | null;
  version_number: number;
  title: string;
  status: string;
  project_id: string;
  offshore_site_id: string;
  project_name: string;
  site_name: string;
  effective_from: string | null;
  effective_to: string | null;
  expected_pob: number | null;
  notes: string | null;
  client_approval_reference: string | null;
  rejection_reason: string | null;
  approved_at: string | null;
  created_at?: string | null;
};
type HistoryRow = { id: string; old_status: string | null; new_status: string; changed_at: string; comment: string | null };
type VersionRow = { id: string; version_number: number; status: string; created_at: string };
type WorkflowStage = { name: string; sequence: number; totalStages: number; approverLabel: string | null };

const inputCls = "border rounded-lg px-3 py-2 text-sm";
const inputStyle = { borderColor: "var(--ch-line)" };
const cardCls = "bg-white border rounded-xl";
const cardStyle = { borderColor: "var(--ch-line)" };

export default function MatrixDetail({
  matrix,
  lines,
  history,
  versions,
  jobRoles,
  skills,
  rotationTemplates,
  documentTypes,
  staffingCrew,
  candidateStaffingCrew,
  matrixRegion,
  customFieldDefinitions,
  canManage,
  canAssignCrew,
  canShareMatrix,
  canSubmit,
  canApproveInternal,
  canApproveClient,
  workflowStage,
  canActCurrentStage,
  aiVisible = false,
}: {
  matrix: Matrix;
  lines: Line[];
  history: HistoryRow[];
  versions: VersionRow[];
  jobRoles: Ref[];
  skills: Ref[];
  rotationTemplates: Ref[];
  documentTypes: DocTypeRef[];
  staffingCrew: StaffingCrew[];
  candidateStaffingCrew: StaffingCrew[];
  matrixRegion?: string | null;
  customFieldDefinitions: FieldDef[];
  canManage: boolean;
  canAssignCrew: boolean;
  canShareMatrix: boolean;
  canSubmit: boolean;
  canApproveInternal: boolean;
  canApproveClient: boolean;
  workflowStage: WorkflowStage | null;
  canActCurrentStage: boolean;
  aiVisible?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  // Separate transition for the Staffing Plan's own Regenerate button — kept
  // apart from the general `run`/startTransition above so its "Regenerating…"
  // state doesn't flicker on while an unrelated workflow action is pending.
  const [staffingPending, startStaffingTransition] = useTransition();
  type TabKey = "overview" | "lines" | "staffing" | "versions";
  const VALID_TABS: TabKey[] = ["overview", "lines", "staffing", "versions"];
  // Regenerate calls router.refresh(), which re-suspends this page while the
  // server component re-fetches — React remounts the client tree when that
  // resolves, which would silently reset a plain useState("overview") back
  // to the first tab (confirmed by testing: clicking Regenerate from
  // Staffing Plan bounced the view back to Overview). Seeding from — and
  // writing to — the `tab` URL param means the remounted component reads
  // the same tab straight back out of the URL instead of losing it.
  const tabFromUrl = searchParams.get("tab") as TabKey | null;
  const [tab, setTabState] = useState<TabKey>(tabFromUrl && VALID_TABS.includes(tabFromUrl) ? tabFromUrl : "overview");
  const setTab = (key: TabKey) => {
    setTabState(key);
    const params = new URLSearchParams(searchParams.toString());
    if (key === "overview") params.delete("tab");
    else params.set("tab", key);
    const qs = params.toString();
    router.replace(`/crew/matrices/${matrix.id}${qs ? `?${qs}` : ""}`, { scroll: false });
  };
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Also reachable from the Staffing Plan tab (same wizard/history panel,
  // separate open/close state) — this copy lives at the top level so
  // "Send Matrix to Client" is visible on the main screen (e.g. Overview)
  // without switching tabs first.
  const [shareModal, setShareModal] = useState<"send" | "history" | null>(null);

  const isDraft = matrix.status === "draft";
  // "Send Matrix to Client" — only once this version has actually been
  // through the approval workflow (or is the currently-active version),
  // not while it's still draft/pending. Matches FINAL_STATUSES in
  // share-actions.ts (which still lets a share already in flight for an
  // older, since-superseded matrix render its history correctly — this
  // only gates starting a NEW send from here).
  const canSendToClient = matrix.status === "approved" || matrix.status === "active";
  const orderedLines = [...lines].sort((a, b) => a.line_number - b.line_number);

  const totalHeadcount = lines.reduce((sum, l) => sum + (l.required_headcount ?? 0), 0);
  const totalDay = lines.reduce((sum, l) => sum + (l.day_shift_quantity ?? 0), 0);
  const totalNight = lines.reduce((sum, l) => sum + (l.night_shift_quantity ?? 0), 0);
  const totalOther = lines.reduce((sum, l) => sum + (l.other_shift_quantity ?? 0), 0);
  const roleTotals = Array.from(
    lines.reduce((map, l) => {
      map.set(l.job_role_name, (map.get(l.job_role_name) ?? 0) + (l.required_headcount ?? 0));
      return map;
    }, new Map<string, number>())
  );

  const validationIssues: string[] = [];
  if (lines.length === 0) validationIssues.push("This matrix has no manning lines yet.");
  if (matrix.expected_pob != null && totalHeadcount !== matrix.expected_pob) {
    validationIssues.push(`Manning line headcount totals ${totalHeadcount}, which doesn't match expected POB of ${matrix.expected_pob}.`);
  }
  for (const l of lines) {
    if (l.client_approval_required && matrix.status === "draft") {
      // informational only — surfaced in the validation summary, not blocking
    }
  }

  const tabs: { key: typeof tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "lines", label: `Manning Lines (${lines.length})` },
    { key: "staffing", label: "Staffing Plan" },
    { key: "versions", label: `Versions (${versions.length})` },
  ];

  const run = (fn: () => Promise<{ error?: string } | undefined>) => {
    setError(null);
    setBusy(true);
    startTransition(async () => {
      const res = await fn();
      setBusy(false);
      if (res?.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  const submitDelete = async () => {
    setError(null);
    setBusy(true);
    // Deleting never touches crew_assignments by default — anyone currently
    // Assigned on this matrix's Staffing Plan stays assigned to the site
    // (see getMatrixSiteActiveAssignments / deleteCrewMatrix in actions.ts
    // for why: a site can have more than one matrix, so we never assume the
    // site's active crew belongs to *this* one). Check first so the confirm
    // can offer to unassign them too, rather than finding out after the
    // matrix — and the Staffing Plan tab that would let someone unassign
    // them — is already gone.
    const check = await getMatrixSiteActiveAssignments(matrix.id);
    setBusy(false);
    if ("error" in check) {
      setError(check.error);
      return;
    }

    let unassignSiteCrew = false;
    if (check.count > 0 && check.blockingMatrix) {
      // These assignments belong to another matrix that's currently active
      // at this site (often the very version this draft was branched from)
      // — never offer to unassign here, so a forgetful click can't touch a
      // live deployment. The system decides this, not the person clicking.
      const bm = check.blockingMatrix;
      if (
        !window.confirm(
          `Delete draft "${matrix.title}"? This can't be undone.\n\n${check.count} crew member${check.count === 1 ? " is" : "s are"} currently assigned to this site, under the active matrix "${bm.title}" (${bm.matrixNumber} v${bm.versionNumber}). They won't be affected — unassigning isn't offered here since they belong to that active matrix, not this draft.`
        )
      )
        return;
    } else if (check.count > 0) {
      const names = `${check.names.slice(0, 5).join(", ")}${check.count > 5 ? `, +${check.count - 5} more` : ""}`;
      if (
        !window.confirm(
          `Delete draft "${matrix.title}"? This can't be undone.\n\n${check.count} crew member${check.count === 1 ? " is" : "s are"} currently assigned to this site (${names}), with no active matrix claiming them.`
        )
      )
        return;
      unassignSiteCrew = window.confirm(
        `Also unassign ${check.count === 1 ? "this crew member" : "these crew members"} from the site now?\n\nOK = unassign & delete — they'll be marked onshore and removed from the site's active roster.\nCancel = delete the matrix only and leave them assigned as-is.`
      );
    } else {
      if (!window.confirm(`Delete draft "${matrix.title}"? This can't be undone.`)) return;
    }

    setBusy(true);
    startTransition(async () => {
      const res = await deleteCrewMatrix(matrix.id, unassignSiteCrew);
      setBusy(false);
      if (res?.error) {
        setError(res.error);
        return;
      }
      router.push("/crew/matrices");
    });
  };

  // The Staffing Plan tab shows a server-fetched snapshot (crew_assignments /
  // crew_documents / crew_profiles as of when this page loaded). Switching
  // tabs is purely client-side state, so it never picks up documents or
  // assignments that changed after the page loaded — e.g. someone just added
  // crew_assignments or crew_documents elsewhere in the app. Regenerate
  // re-runs the page's server component in place (router.refresh()) without
  // losing the currently-selected tab or scroll position.
  const regenerateStaffingPlan = () => {
    startStaffingTransition(() => {
      router.refresh();
    });
  };

  const submitNewVersion = () => {
    setError(null);
    setBusy(true);
    startTransition(async () => {
      const res = await createNewVersion(matrix.id);
      setBusy(false);
      if (res?.error) {
        setError(res.error);
        return;
      }
      if (res?.id) router.push(`/crew/matrices/${res.id}`);
    });
  };

  return (
    <div>
      <div className="mb-4 flex items-center gap-2 flex-wrap">
        <Link href="/crew/matrices" className="text-xs font-semibold ch-link-navy">← All crew matrices</Link>
      </div>

      <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            {matrix.matrix_number && (
              <span className="text-[10px] font-mono font-bold rounded px-1.5 py-0.5" style={{ background: "var(--ch-navy-soft)", color: "var(--ch-navy)" }}>
                {matrix.matrix_number} · v{matrix.version_number}
              </span>
            )}
            <h1 className="text-lg font-semibold" style={{ color: "var(--ch-ink)" }}>{matrix.title}</h1>
            <StatusPill status={matrix.status} />
            {matrix.status === "pending_approval" && workflowStage && (
              <span className="text-xs font-medium" style={{ color: "var(--ch-sub)" }}>
                Stage {workflowStage.sequence} of {workflowStage.totalStages}: {workflowStage.name}
                {workflowStage.approverLabel && ` — assigned to ${workflowStage.approverLabel}`}
              </span>
            )}
          </div>
          <div className="text-xs mt-1" style={{ color: "var(--ch-sub)" }}>
            {matrix.site_name} · {matrix.project_name}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {canShareMatrix && (
            <>
              <button
                onClick={() => setShareModal("send")}
                disabled={!canSendToClient}
                title={canSendToClient ? undefined : "Available once this matrix is Approved or Active."}
                className="text-sm font-semibold rounded-lg px-4 py-2 border disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ borderColor: "var(--ch-navy)", color: "var(--ch-navy)" }}
              >
                Send Matrix to Client
              </button>
              <button
                onClick={() => setShareModal("history")}
                className="text-sm font-semibold rounded-lg px-4 py-2 border"
                style={{ borderColor: "var(--ch-line)", color: "var(--ch-sub)" }}
              >
                Sharing History
              </button>
            </>
          )}
          {isDraft && canManage && !editing && (
            <>
              <button onClick={() => setEditing(true)} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold">Edit</button>
              <button onClick={submitDelete} disabled={busy} className="rounded-lg px-4 py-2 text-sm font-semibold border disabled:opacity-50" style={{ borderColor: "var(--ch-fail)", color: "var(--ch-fail)" }}>
                {busy ? "Checking…" : "Delete"}
              </button>
            </>
          )}
          {/* Edit also unlocks the Lines tab's checkboxes/requirements (see
              LinesEditor's editingEnabled prop) — on that tab there's no
              header form with its own Save/Cancel to turn edit mode back off,
              so this gives every tab a way out of it. */}
          {isDraft && canManage && editing && tab !== "overview" && (
            <button onClick={() => setEditing(false)} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-line)", color: "var(--ch-sub)" }}>
              Done editing
            </button>
          )}
        </div>
      </div>

      {matrix.rejection_reason && ["rejected", "draft"].includes(matrix.status) && (
        <div className="text-sm mb-4 rounded-lg px-3 py-2" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>
          <strong>Last comment:</strong> {matrix.rejection_reason}
        </div>
      )}
      {error && (
        <div className="text-sm mb-4 rounded-lg px-3 py-2" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>{error}</div>
      )}

      <WorkflowActions
        status={matrix.status}
        canManage={canManage}
        canSubmit={canSubmit}
        canApproveInternal={canApproveInternal}
        canApproveClient={canApproveClient}
        pendingApprovalStage={workflowStage}
        canActCurrentStage={canActCurrentStage}
        busy={busy}
        hasLines={lines.length > 0}
        onSubmit={() => run(() => submitForApproval(matrix.id))}
        onApproveInternal={(comment) => run(() => approveInternal(matrix.id, comment))}
        onRejectInternal={(reason) => run(() => rejectInternal(matrix.id, reason))}
        onReturnForCorrection={(comment) => run(() => returnForCorrection(matrix.id, comment))}
        onApproveClient={(ref) => run(() => approveClient(matrix.id, ref))}
        onRejectClient={(reason) => run(() => rejectClient(matrix.id, reason))}
        onApproveStage={(comment) => run(() => approveCurrentStage(matrix.id, comment))}
        onRejectStage={(reason) => run(() => rejectCurrentStage(matrix.id, reason))}
        onReturnStage={(comment) => run(() => returnCurrentStageForCorrection(matrix.id, comment))}
        onActivate={() => run(() => activateCrewMatrix(matrix.id))}
        onCancel={() => run(() => cancelCrewMatrix(matrix.id))}
        onNewVersion={submitNewVersion}
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
          <MatrixForm
            matrix={matrix}
            onCancel={() => setEditing(false)}
            onSubmit={(fd) => {
              setError(null);
              setEditing(false);
              startTransition(async () => {
                const res = await updateCrewMatrixHeader(matrix.id, fd);
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
              <div className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: "var(--ch-sub)" }}>Plan</div>
              <Row label="Effective dates" value={`${matrix.effective_from ?? "…"} – ${matrix.effective_to ?? "…"}`} />
              <Row label="Expected POB" value={matrix.expected_pob} />
              <Row label="Total required headcount (manning lines)" value={totalHeadcount} />
              <Row label="Day / Night / Other shift" value={`${totalDay} / ${totalNight} / ${totalOther}`} />
              {matrix.client_approval_reference && <Row label="Client approval reference" value={matrix.client_approval_reference} />}
              {matrix.approved_at && <Row label="Approved at" value={new Date(matrix.approved_at).toLocaleString()} />}
              {matrix.notes && (
                <div className="mt-3">
                  <div className="text-xs mb-1" style={{ color: "var(--ch-sub)" }}>Notes</div>
                  <div className="text-sm whitespace-pre-wrap" style={{ color: "var(--ch-ink)" }}>{matrix.notes}</div>
                </div>
              )}
            </div>
            <div className={`${cardCls} p-4`} style={cardStyle}>
              <div className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: "var(--ch-sub)" }}>Headcount by role</div>
              {roleTotals.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No manning lines yet.</div>}
              {roleTotals.map(([role, count]) => (
                <Row key={role} label={role} value={count} />
              ))}
              <div className="text-xs font-semibold mt-4 mb-2 uppercase tracking-wide" style={{ color: "var(--ch-sub)" }}>Validation summary</div>
              {validationIssues.length === 0 ? (
                <div className="text-sm" style={{ color: "var(--ch-pass)" }}>No issues found.</div>
              ) : (
                <ul className="text-sm list-disc pl-4" style={{ color: "var(--ch-fail)" }}>
                  {validationIssues.map((issue, i) => (
                    <li key={i}>{issue}</li>
                  ))}
                </ul>
              )}
              {aiVisible && canManage && <AiReviewPanel crewMatrixId={matrix.id} isDraft={isDraft} />}
            </div>
          </div>
        ))}

      {tab === "lines" && (
        <LinesEditor
          crewMatrixId={matrix.id}
          lines={lines}
          isDraft={isDraft}
          canManage={canManage}
          editingEnabled={editing}
          jobRoles={jobRoles}
          skills={skills}
          rotationTemplates={rotationTemplates}
          documentTypes={documentTypes}
        />
      )}

      {tab === "staffing" && (
        <div>
          <div className="flex items-center justify-end mb-2">
            <button
              onClick={regenerateStaffingPlan}
              disabled={staffingPending}
              className="text-xs font-semibold rounded-lg px-3 py-1.5 border disabled:opacity-50"
              style={{ borderColor: "var(--ch-line)", color: "var(--ch-ink)" }}
              title="Re-fetch crew assignments and documents for this staffing plan"
            >
              {staffingPending ? "Regenerating…" : "↻ Regenerate"}
            </button>
          </div>
          <StaffingPlanView
            crewMatrixId={matrix.id}
            matrixTitle={matrix.title}
            matrixNumber={matrix.matrix_number}
            matrixVersion={matrix.version_number}
            matrixStatus={matrix.status}
            lines={lines}
            documentTypes={documentTypes}
            crew={staffingCrew}
            candidateCrew={candidateStaffingCrew}
            matrixRegion={matrixRegion}
            customFieldDefinitions={customFieldDefinitions}
            canManage={canManage}
            canAssignCrew={canAssignCrew}
            canApproveInternal={canApproveInternal}
            statusHistory={history}
            matrixCreatedAt={matrix.created_at}
            allVersions={versions}
            onChanged={regenerateStaffingPlan}
          />
        </div>
      )}

      {tab === "versions" && (
        <div className="space-y-2">
          {versions.map((v) => (
            <div
              key={v.id}
              className={`${cardCls} p-3 flex items-center gap-3 flex-wrap`}
              style={v.id === matrix.id ? { ...cardStyle, background: "var(--ch-navy-soft)" } : cardStyle}
            >
              {v.id === matrix.id ? (
                <span className="text-sm font-semibold" style={{ color: "var(--ch-ink)" }}>v{v.version_number} (this version)</span>
              ) : (
                <Link href={`/crew/matrices/${v.id}`} className="text-sm font-semibold ch-link-navy">v{v.version_number}</Link>
              )}
              <StatusPill status={v.status} />
            </div>
          ))}
        </div>
      )}

      {shareModal === "send" && (
        <SendMatrixWizard
          crewMatrixId={matrix.id}
          matrixTitle={matrix.title}
          matrixNumber={matrix.matrix_number}
          matrixVersion={matrix.version_number}
          matrixStatus={matrix.status}
          lines={orderedLines}
          assignedCrew={staffingCrew}
          documentTypes={documentTypes}
          customFieldDefinitions={customFieldDefinitions}
          onClose={() => setShareModal(null)}
        />
      )}
      {shareModal === "history" && (
        <SharingHistoryPanel crewMatrixId={matrix.id} onClose={() => setShareModal(null)} />
      )}
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

function MatrixForm({ matrix, onSubmit, onCancel }: { matrix: Matrix; onSubmit: (fd: FormData) => void; onCancel: () => void }) {
  const [values, setValues] = useState({
    title: matrix.title,
    effectiveFrom: matrix.effective_from ?? "",
    effectiveTo: matrix.effective_to ?? "",
    expectedPob: matrix.expected_pob?.toString() ?? "",
    notes: matrix.notes ?? "",
  });
  const [submitted, setSubmitted] = useState(false);
  const set = (k: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));

  const save = () => {
    if (!values.title.trim() || submitted) return;
    const fd = new FormData();
    Object.entries(values).forEach(([k, v]) => fd.set(k, v));
    setSubmitted(true);
    onSubmit(fd);
  };

  return (
    <div className={`${cardCls} p-4`} style={cardStyle}>
      <input className={`${inputCls} w-full mb-3`} style={inputStyle} placeholder="Title" value={values.title} onChange={set("title")} />
      <div className="grid gap-3 sm:grid-cols-3 mb-3">
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Effective from
          <input type="date" className={`${inputCls} w-full mt-1`} style={inputStyle} value={values.effectiveFrom} onChange={set("effectiveFrom")} />
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Effective to
          <input type="date" className={`${inputCls} w-full mt-1`} style={inputStyle} value={values.effectiveTo} onChange={set("effectiveTo")} />
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Expected POB
          <input type="number" min="0" className={`${inputCls} w-full mt-1`} style={inputStyle} value={values.expectedPob} onChange={set("expectedPob")} />
        </label>
      </div>
      <textarea className={`${inputCls} w-full mb-3`} style={inputStyle} placeholder="Notes" rows={2} value={values.notes} onChange={set("notes")} />
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={submitted || !values.title.trim()} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">Save</button>
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-line)" }}>Cancel</button>
      </div>
    </div>
  );
}

function WorkflowActions({
  status,
  canManage,
  canSubmit,
  canApproveInternal,
  canApproveClient,
  pendingApprovalStage,
  canActCurrentStage,
  busy,
  hasLines,
  onSubmit,
  onApproveInternal,
  onRejectInternal,
  onReturnForCorrection,
  onApproveClient,
  onRejectClient,
  onApproveStage,
  onRejectStage,
  onReturnStage,
  onActivate,
  onCancel,
  onNewVersion,
}: {
  status: string;
  canManage: boolean;
  canSubmit: boolean;
  canApproveInternal: boolean;
  canApproveClient: boolean;
  pendingApprovalStage: WorkflowStage | null;
  canActCurrentStage: boolean;
  busy: boolean;
  hasLines: boolean;
  onSubmit: () => void;
  onApproveInternal: (comment: string) => void;
  onRejectInternal: (reason: string) => void;
  onReturnForCorrection: (comment: string) => void;
  onApproveClient: (ref: string) => void;
  onRejectClient: (reason: string) => void;
  onApproveStage: (comment: string) => void;
  onRejectStage: (reason: string) => void;
  onReturnStage: (comment: string) => void;
  onActivate: () => void;
  onCancel: () => void;
  onNewVersion: () => void;
}) {
  const [openAction, setOpenAction] = useState<string | null>(null);
  const [text, setText] = useState("");

  const close = () => {
    setOpenAction(null);
    setText("");
  };

  const btn = (label: string, onClick: () => void, variant: "primary" | "danger" | "outline" = "outline") => (
    <button
      key={label}
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

  if (status === "draft" && canSubmit) {
    buttons.push(btn(hasLines ? "Submit for approval" : "Submit for approval (add a manning line first)", onSubmit, "primary"));
  }
  if (status === "pending_internal_approval" && canApproveInternal) {
    buttons.push(btn("Approve", () => setOpenAction("approveInternal"), "primary"));
    buttons.push(btn("Reject", () => setOpenAction("rejectInternal"), "danger"));
    buttons.push(btn("Return for correction", () => setOpenAction("return")));
  }
  if (status === "pending_client_approval") {
    if (canApproveClient) {
      buttons.push(btn("Record client approval", () => setOpenAction("approveClient"), "primary"));
      buttons.push(btn("Reject (client)", () => setOpenAction("rejectClient"), "danger"));
    }
    if (canApproveInternal && canApproveClient) {
      buttons.push(btn("Return for correction", () => setOpenAction("return")));
    }
  }
  if (status === "pending_approval" && pendingApprovalStage) {
    if (canActCurrentStage) {
      buttons.push(btn(`Approve — ${pendingApprovalStage.name}`, () => setOpenAction("approveStage"), "primary"));
      buttons.push(btn("Reject", () => setOpenAction("rejectStage"), "danger"));
      buttons.push(btn("Return for correction", () => setOpenAction("returnStage")));
    }
  }
  if (status === "approved") {
    if (canManage) buttons.push(btn("Activate", onActivate, "primary"));
    if (canManage) buttons.push(btn("Create new version", onNewVersion));
    if (canManage) buttons.push(btn("Cancel", onCancel, "danger"));
  }
  if (["active", "superseded", "rejected"].includes(status) && canManage) {
    buttons.push(btn("Create new version", onNewVersion, status === "active" ? "outline" : "primary"));
  }

  if (buttons.length === 0 && !openAction) return null;

  return (
    <div className={`${cardCls} p-3 mb-2`} style={cardStyle}>
      <div className="flex items-center gap-2 flex-wrap">{buttons}</div>

      {openAction && (
        <div className="mt-3 pt-3 border-t" style={{ borderColor: "var(--ch-line)" }}>
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
          {openAction === "rejectInternal" && (
            <ActionForm
              label="Rejection reason (required)"
              placeholder="Why is this being rejected?"
              required
              confirmLabel="Confirm rejection"
              text={text}
              setText={setText}
              onConfirm={() => {
                onRejectInternal(text);
                close();
              }}
              onCancel={close}
            />
          )}
          {openAction === "return" && (
            <ActionForm
              label="Correction comment (optional)"
              placeholder="What needs to be corrected?"
              required={false}
              confirmLabel="Return to draft"
              text={text}
              setText={setText}
              onConfirm={() => {
                onReturnForCorrection(text);
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
          {openAction === "rejectClient" && (
            <ActionForm
              label="Rejection reason (required)"
              placeholder="Why did the client reject this?"
              required
              confirmLabel="Confirm rejection"
              text={text}
              setText={setText}
              onConfirm={() => {
                onRejectClient(text);
                close();
              }}
              onCancel={close}
            />
          )}
          {openAction === "approveStage" && (
            <ActionForm
              label={`Comment for "${pendingApprovalStage?.name ?? "this stage"}" (optional)`}
              placeholder="Optional comment"
              required={false}
              confirmLabel="Confirm approval"
              text={text}
              setText={setText}
              onConfirm={() => {
                onApproveStage(text);
                close();
              }}
              onCancel={close}
            />
          )}
          {openAction === "rejectStage" && (
            <ActionForm
              label="Rejection reason (required)"
              placeholder="Why is this being rejected?"
              required
              confirmLabel="Confirm rejection"
              text={text}
              setText={setText}
              onConfirm={() => {
                onRejectStage(text);
                close();
              }}
              onCancel={close}
            />
          )}
          {openAction === "returnStage" && (
            <ActionForm
              label="Correction comment (optional)"
              placeholder="What needs to be corrected?"
              required={false}
              confirmLabel="Return to draft"
              text={text}
              setText={setText}
              onConfirm={() => {
                onReturnStage(text);
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
