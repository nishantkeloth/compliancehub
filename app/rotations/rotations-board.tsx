"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { confirmSignoff, extendRotation, createCrewChangeRequest, decideCrewChangeRequest, cancelCrewChangeRequest, previewRelieverReadiness } from "./actions";
import type { ReadinessCheck, OverallOutcome } from "@/lib/readiness";

export type ActiveAssignment = {
  id: string;
  crewId: string;
  crewName: string;
  employeeCode: string | null;
  roleName: string | null;
  deploymentStatus: string;
  siteName: string;
  mobilizationNumber: string | null;
  mobilizationRequestId: string | null;
  startDate: string;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  status: string;
  shift: string | null;
  rotationCycleNumber: number | null;
  rotationName: string | null;
  daysOn: number | null;
  daysOff: number | null;
  relieverCrewId: string | null;
  relieverName: string | null;
  relieverOnboardDate: string | null;
  relieverMobilizationDate: string | null;
  handoverOverlapDays: number | null;
  daysToSignoff: number | null;
  overdue: boolean;
  signingOffThisWeek: boolean;
  missingReliever: boolean;
  hasOpenChangeRequest: boolean;
};
export type JoiningRow = { positionId: string; requestId: string; mobilizationNumber: string | null; crewName: string; jobRoleName: string; siteName: string; onboardDate: string; overdue: boolean; relieving: string | null };
export type TransitRow = { positionId: string; requestId: string; mobilizationNumber: string | null; crewName: string; siteName: string; onboardDate: string | null; stranded: boolean };
export type ChangeRequest = {
  id: string;
  assignmentId: string;
  currentCrewName: string;
  relieverName: string | null;
  siteName: string;
  reason: string;
  plannedChangeDate: string;
  isEmergency: boolean;
  status: string;
  relieverReadiness: string | null;
  mobilizationRequestId: string | null;
  mobilizationNumber: string | null;
  requestedByName: string;
  decidedByName: string | null;
  decisionNote: string | null;
  createdAt: string;
};
export type ExtensionRow = { id: string; crewName: string; siteName: string; previousEnd: string | null; newEnd: string; reason: string; byName: string; createdAt: string };
export type CrewOption = { id: string; name: string; code: string | null; roleId: string | null; roleName: string | null; deploymentStatus: string; availabilityDate: string | null };

const inputCls = "border rounded-lg px-3 py-2 text-sm";
const inputStyle = { borderColor: "var(--ch-line)" };
const cardCls = "bg-white border rounded-xl";
const cardStyle = { borderColor: "var(--ch-line)" };

function pill(text: string, bg: string, fg: string) {
  return (
    <span className="text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5" style={{ background: bg, color: fg }}>
      {text}
    </span>
  );
}
const OUTCOME_COLORS: Record<string, { bg: string; fg: string; label: string }> = {
  ready: { bg: "var(--ch-pass-bg)", fg: "var(--ch-pass)", label: "Ready" },
  ready_with_warning: { bg: "#fef3e2", fg: "#b45309", label: "Ready (warnings)" },
  overridden: { bg: "var(--ch-navy-soft)", fg: "var(--ch-navy)", label: "Ready (waived)" },
  not_ready: { bg: "var(--ch-fail-bg)", fg: "var(--ch-fail)", label: "Not ready" },
};
const CCR_COLORS: Record<string, { bg: string; fg: string }> = {
  pending_approval: { bg: "#fef3e2", fg: "#b45309" },
  approved: { bg: "var(--ch-pass-bg)", fg: "var(--ch-pass)" },
  completed: { bg: "var(--ch-navy-soft)", fg: "var(--ch-navy)" },
  rejected: { bg: "var(--ch-fail-bg)", fg: "var(--ch-fail)" },
  cancelled: { bg: "var(--ch-paper)", fg: "var(--ch-sub)" },
};

export default function RotationsBoard({
  active,
  joining,
  transit,
  changes,
  extensions,
  crewOptions,
  canManage,
  canApprove,
  canEmergency,
  focusAssignmentId,
  today,
}: {
  active: ActiveAssignment[];
  joining: JoiningRow[];
  transit: TransitRow[];
  changes: ChangeRequest[];
  extensions: ExtensionRow[];
  crewOptions: CrewOption[];
  canManage: boolean;
  canApprove: boolean;
  canEmergency: boolean;
  focusAssignmentId: string | null;
  today: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [tab, setTab] = useState<"dashboard" | "assignments" | "changes">(focusAssignmentId ? "assignments" : "dashboard");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "signing_off" | "overdue" | "missing_reliever">("all");

  const run = (fn: () => Promise<{ error?: string; warning?: string } | undefined>, after?: () => void) => {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await fn();
      if (res?.error) {
        setError(res.error);
        return;
      }
      if (res?.warning) setNotice(res.warning);
      after?.();
      router.refresh();
    });
  };

  const overdue = active.filter((a) => a.overdue);
  const signingOff = active.filter((a) => a.signingOffThisWeek);
  const missingReliever = active.filter((a) => a.missingReliever);
  const stranded = transit.filter((t) => t.stranded);

  const visibleAssignments = active.filter((a) =>
    filter === "all" ? true : filter === "signing_off" ? a.signingOffThisWeek : filter === "overdue" ? a.overdue : a.missingReliever
  );

  const tile = (label: string, value: number, tone: "ok" | "warn" | "fail" | "neutral", onClick?: () => void) => {
    const fg = tone === "ok" ? "var(--ch-pass)" : tone === "warn" ? "#b45309" : tone === "fail" ? "var(--ch-fail)" : "var(--ch-navy)";
    return (
      <button onClick={onClick} className={`${cardCls} p-4 text-left`} style={{ ...cardStyle, cursor: onClick ? "pointer" : "default" }}>
        <div className="text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: fg }}>{label}</div>
        <div className="text-2xl font-bold" style={{ color: "var(--ch-ink)" }}>{value}</div>
      </button>
    );
  };

  return (
    <div>
      <div className="flex items-center gap-1 rounded-lg border p-1 mb-4 w-fit bg-white" style={{ borderColor: "var(--ch-line)" }}>
        {(["dashboard", "assignments", "changes"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-3.5 py-1.5 rounded-md text-xs font-semibold"
            style={tab === t ? { background: "var(--ch-navy)", color: "#fff" } : { color: "var(--ch-sub)" }}
          >
            {t === "dashboard" ? "Dashboard" : t === "assignments" ? `Active assignments (${active.length})` : `Crew changes (${changes.filter((c) => c.status === "pending_approval").length} pending)`}
          </button>
        ))}
      </div>

      {error && <div className="text-sm mb-3 rounded-lg px-3 py-2" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>{error}</div>}
      {notice && <div className="text-sm mb-3 rounded-lg px-3 py-2" style={{ background: "#fef3e2", color: "#b45309" }}>{notice}</div>}

      {tab === "dashboard" && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {tile("Currently onboard", active.length, "ok", () => { setFilter("all"); setTab("assignments"); })}
            {tile("Joining this week", joining.length, "neutral")}
            {tile("Signing off this week", signingOff.length, "warn", () => { setFilter("signing_off"); setTab("assignments"); })}
            {tile("Overdue rotations", overdue.length, overdue.length ? "fail" : "ok", () => { setFilter("overdue"); setTab("assignments"); })}
            {tile("Missing relievers", missingReliever.length, missingReliever.length ? "fail" : "ok", () => { setFilter("missing_reliever"); setTab("assignments"); })}
            {tile("In transit", transit.length, "neutral")}
            {tile("Stranded / delayed", stranded.length, stranded.length ? "fail" : "ok")}
          </div>

          <Section title="Joining this week" empty="Nobody is due to board in the next 7 days.">
            {joining.map((j) => (
              <Link key={j.positionId} href={`/mobilizations/${j.requestId}`} className="block text-sm border rounded-lg px-3 py-2 hover:bg-gray-50" style={{ borderColor: "var(--ch-line)" }}>
                <span className="font-semibold" style={{ color: "var(--ch-ink)" }}>{j.crewName}</span>{" "}
                <span style={{ color: "var(--ch-sub)" }}>— {j.jobRoleName} · {j.siteName} · {j.mobilizationNumber ?? "—"} · onboard {j.onboardDate}</span>
                {j.relieving && <span className="text-xs ml-2" style={{ color: "var(--ch-sub)" }}>relieving {j.relieving}</span>}
                {j.overdue && <span className="ml-2">{pill("overdue", "var(--ch-fail-bg)", "var(--ch-fail)")}</span>}
              </Link>
            ))}
          </Section>

          <Section title="In transit" empty="No crew currently travelling.">
            {transit.map((t) => (
              <Link key={t.positionId} href={`/mobilizations/${t.requestId}`} className="block text-sm border rounded-lg px-3 py-2 hover:bg-gray-50" style={{ borderColor: "var(--ch-line)" }}>
                <span className="font-semibold" style={{ color: "var(--ch-ink)" }}>{t.crewName}</span>{" "}
                <span style={{ color: "var(--ch-sub)" }}>— to {t.siteName} · {t.mobilizationNumber ?? "—"} · expected onboard {t.onboardDate ?? "—"}</span>
                {t.stranded && <span className="ml-2">{pill("stranded / delayed", "var(--ch-fail-bg)", "var(--ch-fail)")}</span>}
              </Link>
            ))}
          </Section>

          <Section title="Upcoming rotations (next 30 days)" empty="No sign-offs due in the next 30 days.">
            {active
              .filter((a) => a.daysToSignoff != null && a.daysToSignoff <= 30)
              .map((a) => (
                <div key={a.id} className="text-sm border rounded-lg px-3 py-2 flex items-center gap-2 flex-wrap" style={{ borderColor: "var(--ch-line)" }}>
                  <span className="font-semibold" style={{ color: "var(--ch-ink)" }}>{a.crewName}</span>
                  <span style={{ color: "var(--ch-sub)" }}>— {a.roleName ?? "—"} · {a.siteName} · sign-off {a.plannedEndDate}</span>
                  {a.overdue ? pill(`${Math.abs(a.daysToSignoff ?? 0)}d overdue`, "var(--ch-fail-bg)", "var(--ch-fail)") : pill(`in ${a.daysToSignoff}d`, "var(--ch-paper)", "var(--ch-sub)")}
                  {a.relieverName ? (
                    <span className="text-xs" style={{ color: "var(--ch-sub)" }}>reliever {a.relieverName}{a.relieverOnboardDate ? ` (onboard ${a.relieverOnboardDate})` : ""}</span>
                  ) : (
                    pill("no reliever", "var(--ch-fail-bg)", "var(--ch-fail)")
                  )}
                  {a.status === "extended" && pill("extended", "var(--ch-navy-soft)", "var(--ch-navy)")}
                </div>
              ))}
          </Section>

          <Section title="Rotation extensions (audit)" empty="No rotation extensions recorded.">
            {extensions.map((e) => (
              <div key={e.id} className="text-sm border rounded-lg px-3 py-2" style={{ borderColor: "var(--ch-line)" }}>
                <span className="font-semibold" style={{ color: "var(--ch-ink)" }}>{e.crewName}</span>{" "}
                <span style={{ color: "var(--ch-sub)" }}>— {e.siteName} · {e.previousEnd ?? "—"} → {e.newEnd} · by {e.byName} on {e.createdAt.slice(0, 10)}</span>
                <div className="text-xs mt-0.5" style={{ color: "var(--ch-sub)" }}>{e.reason}</div>
              </div>
            ))}
          </Section>
        </div>
      )}

      {tab === "assignments" && (
        <div>
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            {(["all", "signing_off", "overdue", "missing_reliever"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className="text-xs font-semibold rounded-full px-3 py-1 border"
                style={filter === f ? { background: "var(--ch-navy)", color: "#fff", borderColor: "var(--ch-navy)" } : { borderColor: "var(--ch-line)", color: "var(--ch-sub)" }}
              >
                {f === "all" ? "All" : f === "signing_off" ? "Signing off this week" : f === "overdue" ? "Overdue" : "Missing reliever"}
              </button>
            ))}
          </div>
          {visibleAssignments.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No active assignments match.</div>}
          <div className="space-y-2">
            {visibleAssignments.map((a) => (
              <AssignmentRow
                key={a.id}
                a={a}
                crewOptions={crewOptions}
                canManage={canManage}
                canEmergency={canEmergency}
                initiallyOpen={a.id === focusAssignmentId ? "signoff" : "none"}
                today={today}
                run={run}
              />
            ))}
          </div>
        </div>
      )}

      {tab === "changes" && (
        <div className="space-y-2">
          {changes.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No crew change requests yet — raise one from an active assignment.</div>}
          {changes.map((c) => {
            const colors = CCR_COLORS[c.status] ?? CCR_COLORS.cancelled;
            const readiness = c.relieverReadiness ? OUTCOME_COLORS[c.relieverReadiness] : null;
            return (
              <div key={c.id} className={`${cardCls} p-3`} style={cardStyle}>
                <div className="flex items-center gap-2 flex-wrap">
                  {pill(c.status.replace(/_/g, " "), colors.bg, colors.fg)}
                  {c.isEmergency && pill("emergency", "var(--ch-fail-bg)", "var(--ch-fail)")}
                  <span className="text-sm font-semibold" style={{ color: "var(--ch-ink)" }}>{c.currentCrewName}</span>
                  <span className="text-sm" style={{ color: "var(--ch-sub)" }}>→ {c.relieverName ?? "reliever TBD"} · {c.siteName} · change on {c.plannedChangeDate}</span>
                  {readiness && pill(`reliever ${readiness.label}`, readiness.bg, readiness.fg)}
                  {c.mobilizationRequestId && (
                    <Link href={`/mobilizations/${c.mobilizationRequestId}`} className="text-xs font-semibold ch-link-navy">{c.mobilizationNumber ?? "Reliever mobilization"} ›</Link>
                  )}
                  <div className="ml-auto flex items-center gap-2">
                    {canApprove && c.status === "pending_approval" && (
                      <>
                        <button onClick={() => run(() => decideCrewChangeRequest(c.id, true, new FormData()))} className="text-xs font-semibold" style={{ color: "var(--ch-pass)" }}>Approve</button>
                        <RejectButton onReject={(note) => { const fd = new FormData(); fd.set("decisionNote", note); run(() => decideCrewChangeRequest(c.id, false, fd)); }} />
                      </>
                    )}
                    {canManage && ["pending_approval", "approved"].includes(c.status) && (
                      <button onClick={() => run(() => cancelCrewChangeRequest(c.id))} className="text-xs font-semibold" style={{ color: "var(--ch-sub)" }}>Cancel</button>
                    )}
                  </div>
                </div>
                <div className="text-xs mt-1" style={{ color: "var(--ch-sub)" }}>{c.reason}</div>
                <div className="text-xs mt-0.5" style={{ color: "var(--ch-sub)" }}>
                  Requested by {c.requestedByName} on {c.createdAt.slice(0, 10)}
                  {c.decidedByName && <> · decided by {c.decidedByName}{c.decisionNote ? ` — ${c.decisionNote}` : ""}</>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Section({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <div className={`${cardCls} p-4`} style={cardStyle}>
      <div className="text-sm font-bold mb-2" style={{ color: "var(--ch-ink)" }}>{title}</div>
      {children.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>{empty}</div>}
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function AssignmentRow({
  a,
  crewOptions,
  canManage,
  canEmergency,
  initiallyOpen,
  today,
  run,
}: {
  a: ActiveAssignment;
  crewOptions: CrewOption[];
  canManage: boolean;
  canEmergency: boolean;
  initiallyOpen: "none" | "signoff";
  today: string;
  run: (fn: () => Promise<{ error?: string; warning?: string } | undefined>, after?: () => void) => void;
}) {
  const [panel, setPanel] = useState<"none" | "signoff" | "extend" | "change">(initiallyOpen);

  return (
    <div className={cardCls} style={cardStyle}>
      <div className="p-3 flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold" style={{ color: "var(--ch-ink)" }}>{a.crewName}</span>
        {a.employeeCode && <span className="text-xs" style={{ color: "var(--ch-sub)" }}>{a.employeeCode}</span>}
        <span className="text-xs" style={{ color: "var(--ch-sub)" }}>{a.roleName ?? "—"} · {a.siteName}{a.shift ? ` · ${a.shift}` : ""}{a.rotationCycleNumber ? ` · cycle ${a.rotationCycleNumber}` : ""}</span>
        {a.status === "extended" && pill("extended", "var(--ch-navy-soft)", "var(--ch-navy)")}
        {a.overdue && pill("overdue", "var(--ch-fail-bg)", "var(--ch-fail)")}
        {a.missingReliever && pill("no reliever", "var(--ch-fail-bg)", "var(--ch-fail)")}
        {a.hasOpenChangeRequest && pill("change requested", "#fef3e2", "#b45309")}
        <div className="ml-auto flex items-center gap-2">
          {canManage && <button onClick={() => setPanel(panel === "change" ? "none" : "change")} className="text-xs font-semibold ch-link-navy">Request crew change</button>}
          {canManage && <button onClick={() => setPanel(panel === "extend" ? "none" : "extend")} className="text-xs font-semibold ch-link-navy">Extend</button>}
          {(canManage || canEmergency) && <button onClick={() => setPanel(panel === "signoff" ? "none" : "signoff")} className="text-xs font-semibold" style={{ color: "var(--ch-fail)" }}>Sign off</button>}
        </div>
      </div>
      <div className="px-3 pb-2 text-xs grid gap-1 sm:grid-cols-3" style={{ color: "var(--ch-sub)" }}>
        <div>Onboard since <b style={{ color: "var(--ch-ink)" }}>{a.startDate}</b>{a.plannedStartDate && a.plannedStartDate !== a.startDate ? ` (planned ${a.plannedStartDate})` : ""}</div>
        <div>Planned sign-off <b style={{ color: a.overdue ? "var(--ch-fail)" : "var(--ch-ink)" }}>{a.plannedEndDate ?? "—"}</b>{a.rotationName ? ` · ${a.rotationName}` : ""}{a.daysToSignoff != null ? ` (${a.daysToSignoff >= 0 ? `in ${a.daysToSignoff}d` : `${-a.daysToSignoff}d overdue`})` : ""}</div>
        <div>
          Reliever <b style={{ color: "var(--ch-ink)" }}>{a.relieverName ?? "—"}</b>
          {a.relieverMobilizationDate && <> · mobilize by {a.relieverMobilizationDate}</>}
          {a.handoverOverlapDays != null && <> · handover overlap {a.handoverOverlapDays}d</>}
        </div>
        {a.mobilizationRequestId && (
          <div><Link href={`/mobilizations/${a.mobilizationRequestId}`} className="ch-link-navy font-semibold">{a.mobilizationNumber ?? "Mobilization"} ›</Link></div>
        )}
      </div>

      {panel === "extend" && (
        <div className="border-t p-3" style={{ borderColor: "var(--ch-line)" }}>
          <ExtendForm currentEnd={a.plannedEndDate} onSubmit={(fd) => run(() => extendRotation(a.id, fd), () => setPanel("none"))} onCancel={() => setPanel("none")} />
        </div>
      )}
      {panel === "change" && (
        <div className="border-t p-3" style={{ borderColor: "var(--ch-line)" }}>
          <ChangeRequestForm a={a} crewOptions={crewOptions} today={today} onSubmit={(fd) => run(() => createCrewChangeRequest(fd), () => setPanel("none"))} onCancel={() => setPanel("none")} />
        </div>
      )}
      {panel === "signoff" && (
        <div className="border-t p-3" style={{ borderColor: "var(--ch-line)" }}>
          <SignoffForm a={a} crewOptions={crewOptions} canEmergency={canEmergency} onSubmit={(fd) => run(() => confirmSignoff(a.id, fd), () => setPanel("none"))} onCancel={() => setPanel("none")} />
        </div>
      )}
    </div>
  );
}

function ExtendForm({ currentEnd, onSubmit, onCancel }: { currentEnd: string | null; onSubmit: (fd: FormData) => void; onCancel: () => void }) {
  const [newEnd, setNewEnd] = useState("");
  const [reason, setReason] = useState("");
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2 mb-2">
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          New planned end date (currently {currentEnd ?? "—"})
          <input type="date" className={`${inputCls} w-full mt-1`} style={inputStyle} value={newEnd} onChange={(e) => setNewEnd(e.target.value)} />
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Reason (required, audited)
          <input className={`${inputCls} w-full mt-1`} style={inputStyle} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => { const fd = new FormData(); fd.set("newPlannedEndDate", newEnd); fd.set("reason", reason.trim()); onSubmit(fd); }}
          disabled={!newEnd || !reason.trim()}
          className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          Extend rotation
        </button>
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-line)" }}>Cancel</button>
      </div>
    </div>
  );
}

function ChangeRequestForm({ a, crewOptions, today, onSubmit, onCancel }: { a: ActiveAssignment; crewOptions: CrewOption[]; today: string; onSubmit: (fd: FormData) => void; onCancel: () => void }) {
  const [relieverId, setRelieverId] = useState("");
  const [plannedDate, setPlannedDate] = useState(a.plannedEndDate && a.plannedEndDate >= today ? a.plannedEndDate : today);
  const [reason, setReason] = useState("");
  const [isEmergency, setIsEmergency] = useState(false);
  const [preview, setPreview] = useState<{ outcome: OverallOutcome; checks: ReadinessCheck[] } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const roleId = crewOptions.find((c) => c.id === a.crewId)?.roleId ?? null;
  const candidates = crewOptions.filter((c) => c.id !== a.crewId);
  const sameRole = candidates.filter((c) => roleId && c.roleId === roleId);
  const others = candidates.filter((c) => !(roleId && c.roleId === roleId));

  const checkReadiness = () => {
    if (!relieverId) return;
    setLoadingPreview(true);
    setPreviewError(null);
    setPreview(null);
    previewRelieverReadiness(a.id, relieverId, plannedDate).then((res) => {
      setLoadingPreview(false);
      if ("error" in res) setPreviewError(res.error);
      else setPreview({ outcome: res.evaluation.overallOutcome, checks: res.evaluation.checks });
    });
  };

  const opt = (c: CrewOption) => (
    <option key={c.id} value={c.id}>
      {c.name}{c.code ? ` (${c.code})` : ""} — {c.deploymentStatus}{c.availabilityDate ? `, available ${c.availabilityDate}` : ""}
    </option>
  );

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-3 mb-2">
        <label className="text-xs sm:col-span-2" style={{ color: "var(--ch-sub)" }}>
          Proposed reliever
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={relieverId} onChange={(e) => { setRelieverId(e.target.value); setPreview(null); }}>
            <option value="">— decide later —</option>
            {sameRole.length > 0 && <optgroup label={`Same role (${a.roleName ?? "—"})`}>{sameRole.map(opt)}</optgroup>}
            {others.length > 0 && <optgroup label="Other roles">{others.map(opt)}</optgroup>}
          </select>
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Planned change date
          <input type="date" className={`${inputCls} w-full mt-1`} style={inputStyle} value={plannedDate} onChange={(e) => { setPlannedDate(e.target.value); setPreview(null); }} />
        </label>
      </div>
      <textarea className={`${inputCls} w-full mb-2`} style={inputStyle} rows={2} placeholder="Reason for the crew change (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="flex items-center gap-3 flex-wrap mb-2">
        <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--ch-ink)" }}>
          <input type="checkbox" checked={isEmergency} onChange={(e) => setIsEmergency(e.target.checked)} /> Emergency change
        </label>
        {relieverId && (
          <button onClick={checkReadiness} disabled={loadingPreview} className="text-xs font-semibold ch-link-navy disabled:opacity-50">
            {loadingPreview ? "Checking…" : "Check reliever readiness"}
          </button>
        )}
        {preview && (() => { const c = OUTCOME_COLORS[preview.outcome]; return pill(c.label, c.bg, c.fg); })()}
      </div>
      {previewError && <div className="text-xs mb-2" style={{ color: "var(--ch-fail)" }}>{previewError}</div>}
      {preview && (
        <div className="text-xs mb-2 space-y-0.5" style={{ color: "var(--ch-sub)" }}>
          {preview.checks.filter((c) => c.result === "fail" || c.result === "warning").map((c) => (
            <div key={c.code}>
              {pill(c.result, c.result === "fail" ? "var(--ch-fail-bg)" : "#fef3e2", c.result === "fail" ? "var(--ch-fail)" : "#b45309")}{" "}
              {c.blocking && pill("blocking", "var(--ch-fail-bg)", "var(--ch-fail)")} {c.recommendedAction ?? c.description}
            </div>
          ))}
          {preview.checks.every((c) => c.result !== "fail" && c.result !== "warning") && <div>All checks pass.</div>}
        </div>
      )}
      <div className="flex items-center gap-2">
        <button
          onClick={() => {
            const fd = new FormData();
            fd.set("assignmentId", a.id);
            fd.set("proposedRelieverCrewId", relieverId);
            fd.set("plannedChangeDate", plannedDate);
            fd.set("reason", reason.trim());
            if (isEmergency) fd.set("isEmergency", "on");
            onSubmit(fd);
          }}
          disabled={!plannedDate || !reason.trim()}
          className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          Submit for approval
        </button>
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-line)" }}>Cancel</button>
      </div>
    </div>
  );
}

function SignoffForm({ a, crewOptions, canEmergency, onSubmit, onCancel }: { a: ActiveAssignment; crewOptions: CrewOption[]; canEmergency: boolean; onSubmit: (fd: FormData) => void; onCancel: () => void }) {
  const [actualSignoffAt, setActualSignoffAt] = useState(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16));
  const [replacementConfirmed, setReplacementConfirmed] = useState(!!a.relieverCrewId);
  const [replacementCrewId, setReplacementCrewId] = useState(a.relieverCrewId ?? "");
  const [handoverCompleted, setHandoverCompleted] = useState(false);
  const [handoverNotes, setHandoverNotes] = useState("");
  const [returnTravelDetails, setReturnTravelDetails] = useState("");
  const [returnDep, setReturnDep] = useState("");
  const [returnArr, setReturnArr] = useState("");
  const [propertyReturned, setPropertyReturned] = useState(false);
  const [timesheetClosed, setTimesheetClosed] = useState(false);
  const [clearanceStatus, setClearanceStatus] = useState("cleared");
  const [clearanceNotes, setClearanceNotes] = useState("");
  const [performanceRating, setPerformanceRating] = useState("");
  const [performanceNotes, setPerformanceNotes] = useState("");
  const [returnToPoolDate, setReturnToPoolDate] = useState(() => {
    if (!a.daysOff) return "";
    const d = new Date();
    d.setDate(d.getDate() + a.daysOff);
    return d.toISOString().slice(0, 10);
  });
  const [isEmergency, setIsEmergency] = useState(false);
  const [emergencyReason, setEmergencyReason] = useState("");
  const [remarks, setRemarks] = useState("");

  const checklistOk = handoverCompleted && propertyReturned && timesheetClosed && clearanceStatus !== "flagged";
  const canSubmit = !!actualSignoffAt && (isEmergency ? !!emergencyReason.trim() : checklistOk);

  const submit = () => {
    const fd = new FormData();
    fd.set("actualSignoffAt", actualSignoffAt);
    if (replacementConfirmed) fd.set("replacementConfirmed", "on");
    fd.set("replacementCrewId", replacementCrewId);
    if (handoverCompleted) fd.set("handoverCompleted", "on");
    fd.set("handoverNotes", handoverNotes);
    fd.set("returnTravelDetails", returnTravelDetails);
    fd.set("returnTravelDepartureAt", returnDep);
    fd.set("returnTravelArrivalAt", returnArr);
    if (propertyReturned) fd.set("propertyReturned", "on");
    if (timesheetClosed) fd.set("timesheetClosed", "on");
    fd.set("clearanceStatus", clearanceStatus);
    fd.set("clearanceNotes", clearanceNotes);
    fd.set("performanceRating", performanceRating);
    fd.set("performanceNotes", performanceNotes);
    fd.set("returnToPoolDate", returnToPoolDate);
    if (isEmergency) fd.set("isEmergency", "on");
    fd.set("emergencyReason", emergencyReason.trim());
    fd.set("remarks", remarks);
    onSubmit(fd);
  };

  const check = (label: string, value: boolean, set: (v: boolean) => void) => (
    <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--ch-ink)" }}>
      <input type="checkbox" checked={value} onChange={(e) => set(e.target.checked)} /> {label}
    </label>
  );

  return (
    <div>
      <div className="text-sm font-semibold mb-2" style={{ color: "var(--ch-ink)" }}>Sign off — {a.crewName} from {a.siteName}</div>
      <div className="grid gap-3 sm:grid-cols-3 mb-3">
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Actual sign-off (planned {a.plannedEndDate ?? "—"})
          <input type="datetime-local" className={`${inputCls} w-full mt-1`} style={inputStyle} value={actualSignoffAt} onChange={(e) => setActualSignoffAt(e.target.value)} />
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Replacement
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={replacementCrewId} onChange={(e) => { setReplacementCrewId(e.target.value); setReplacementConfirmed(!!e.target.value); }}>
            <option value="">— none —</option>
            {crewOptions.filter((c) => c.id !== a.crewId).map((c) => (
              <option key={c.id} value={c.id}>{c.name}{c.code ? ` (${c.code})` : ""}</option>
            ))}
          </select>
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Return-to-pool availability date
          <input type="date" className={`${inputCls} w-full mt-1`} style={inputStyle} value={returnToPoolDate} onChange={(e) => setReturnToPoolDate(e.target.value)} />
        </label>
      </div>

      <div className="flex items-center gap-4 flex-wrap mb-2">
        {check("Replacement confirmed", replacementConfirmed, setReplacementConfirmed)}
        {check("Handover completed", handoverCompleted, setHandoverCompleted)}
        {check("Company property returned", propertyReturned, setPropertyReturned)}
        {check("Timesheet closed", timesheetClosed, setTimesheetClosed)}
      </div>
      <input className={`${inputCls} w-full mb-3`} style={inputStyle} placeholder="Handover notes" value={handoverNotes} onChange={(e) => setHandoverNotes(e.target.value)} />

      <div className="grid gap-3 sm:grid-cols-3 mb-3">
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Return travel
          <input className={`${inputCls} w-full mt-1`} style={inputStyle} placeholder="Flight / route / agent" value={returnTravelDetails} onChange={(e) => setReturnTravelDetails(e.target.value)} />
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Return departure
          <input type="datetime-local" className={`${inputCls} w-full mt-1`} style={inputStyle} value={returnDep} onChange={(e) => setReturnDep(e.target.value)} />
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Return arrival
          <input type="datetime-local" className={`${inputCls} w-full mt-1`} style={inputStyle} value={returnArr} onChange={(e) => setReturnArr(e.target.value)} />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 mb-3">
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Incident / disciplinary clearance
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={clearanceStatus} onChange={(e) => setClearanceStatus(e.target.value)}>
            <option value="cleared">Cleared</option>
            <option value="pending">Pending</option>
            <option value="flagged">Flagged</option>
          </select>
        </label>
        <label className="text-xs sm:col-span-2" style={{ color: "var(--ch-sub)" }}>
          Clearance notes
          <input className={`${inputCls} w-full mt-1`} style={inputStyle} value={clearanceNotes} onChange={(e) => setClearanceNotes(e.target.value)} />
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Performance rating (1–5)
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={performanceRating} onChange={(e) => setPerformanceRating(e.target.value)}>
            <option value="">—</option>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label className="text-xs sm:col-span-2" style={{ color: "var(--ch-sub)" }}>
          Performance notes
          <input className={`${inputCls} w-full mt-1`} style={inputStyle} value={performanceNotes} onChange={(e) => setPerformanceNotes(e.target.value)} />
        </label>
      </div>
      <textarea className={`${inputCls} w-full mb-3`} style={inputStyle} rows={2} placeholder="Remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} />

      {canEmergency && (
        <div className="mb-3 rounded-lg px-3 py-2" style={{ background: "var(--ch-fail-bg)" }}>
          <label className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: "var(--ch-fail)" }}>
            <input type="checkbox" checked={isEmergency} onChange={(e) => setIsEmergency(e.target.checked)} /> Emergency sign-off (bypasses the checklist — reason required, audited)
          </label>
          {isEmergency && (
            <input className={`${inputCls} w-full mt-2`} style={inputStyle} placeholder="Emergency reason" value={emergencyReason} onChange={(e) => setEmergencyReason(e.target.value)} />
          )}
        </div>
      )}
      {!isEmergency && !checklistOk && (
        <div className="text-xs mb-2" style={{ color: "var(--ch-sub)" }}>Handover, property return, timesheet, and a non-flagged clearance are required for a normal sign-off.</div>
      )}

      <div className="flex items-center gap-2">
        <button onClick={submit} disabled={!canSubmit} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
          {isEmergency ? "Record emergency sign-off" : "Confirm sign-off"}
        </button>
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-line)" }}>Cancel</button>
      </div>
    </div>
  );
}

function RejectButton({ onReject }: { onReject: (note: string) => void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  if (!open) return <button onClick={() => setOpen(true)} className="text-xs font-semibold" style={{ color: "var(--ch-fail)" }}>Reject</button>;
  return (
    <span className="flex items-center gap-1.5">
      <input className={inputCls} style={{ ...inputStyle, width: 160 }} placeholder="Reason (required)" value={note} onChange={(e) => setNote(e.target.value)} />
      <button onClick={() => { if (!note.trim()) return; onReject(note.trim()); setOpen(false); setNote(""); }} disabled={!note.trim()} className="text-xs font-semibold disabled:opacity-40" style={{ color: "var(--ch-fail)" }}>
        Confirm reject
      </button>
    </span>
  );
}
