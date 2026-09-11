"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveDailyLog,
  verifyDailyLog,
  unverifyDailyLog,
  closePeriod,
  approvePeriod,
  markBillingReady,
  reopenPeriod,
  addCostEntry,
  deleteCostEntry,
  saveBillingTerms,
  deleteProjectBillingOverride,
  addAdjustment,
  decideAdjustment,
  deleteAdjustment,
} from "./actions";
import {
  COST_CATEGORIES,
  BILLING_MODELS,
  PERIOD_STATUS_LABELS,
  LOG_STATUS_LABELS,
  shiftMonth,
  fmtMoney,
  type BillingTerms,
  type BillingSummary,
  type CostBreakdown,
  type CrewCostRow,
  type ContainerCostRow,
  type LogTotals,
  type Profitability,
} from "@/lib/ops";

export type DailyLog = {
  id: string;
  offshore_site_id: string;
  entry_date: string;
  status: string;
  client_pob: number;
  crew_pob: number;
  breakfast_count: number;
  lunch_count: number;
  dinner_count: number;
  night_meal_count: number;
  special_meals: number;
  packed_meals: number;
  att_onboard: number;
  att_on_duty: number;
  att_off_duty: number;
  att_sick: number;
  att_training: number;
  att_travel: number;
  att_overtime_hours: number;
  att_emergency_duty: number;
  catering_delivered: boolean;
  housekeeping_completed: boolean;
  laundry_kg: number | null;
  special_events: string | null;
  service_interruptions: string | null;
  client_complaints: number;
  client_complaint_notes: string | null;
  food_waste_kg: number | null;
  non_conformities: number;
  non_conformity_notes: string | null;
  remarks: string | null;
  rejection_reason: string | null;
  submitted_by_name: string;
  verified_by_name: string;
};
export type CostEntry = { id: string; costDate: string; category: string; description: string; amount: number; currency: string; reference: string | null; siteName: string | null; byName: string };
export type Adjustment = { id: string; kind: string; description: string; amount: number; currency: string; reference: string | null; status: string; byName: string; decidedByName: string | null };
export type PeriodInfo = {
  status: string;
  closedByName: string | null;
  closedAt: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  billingReadyAt: string | null;
  reopenCount: number;
  history: { from: string | null; to: string; reason: string | null; byName: string; at: string }[];
};
type ProjectOpt = { id: string; label: string; status: string; contractId: string; contractLabel: string; currency: string | null };
type Perms = { enter: boolean; verify: boolean; close: boolean; commercial: boolean };
type TermsProp = (BillingTerms & { id: string; isProjectOverride: boolean }) | null;

const inputCls = "border rounded-lg px-3 py-2 text-sm";
const inputStyle = { borderColor: "var(--ch-line)" };
const cardCls = "bg-white border rounded-xl";
const cardStyle = { borderColor: "var(--ch-line)" };
const lbl = "text-xs";
const lblStyle = { color: "var(--ch-sub)" };

const LOG_COLORS: Record<string, { bg: string; fg: string }> = {
  draft: { bg: "var(--ch-paper)", fg: "var(--ch-sub)" },
  submitted: { bg: "#fef3e2", fg: "#b45309" },
  verified: { bg: "var(--ch-pass-bg)", fg: "var(--ch-pass)" },
  rejected: { bg: "var(--ch-fail-bg)", fg: "var(--ch-fail)" },
  missing: { bg: "#fff", fg: "var(--ch-sub)" },
};
const PERIOD_COLORS: Record<string, { bg: string; fg: string }> = {
  open: { bg: "var(--ch-paper)", fg: "var(--ch-sub)" },
  closed: { bg: "#fef3e2", fg: "#b45309" },
  commercially_approved: { bg: "var(--ch-navy-soft)", fg: "var(--ch-navy)" },
  billing_ready: { bg: "var(--ch-pass-bg)", fg: "var(--ch-pass)" },
};
function pill(text: string, c: { bg: string; fg: string }) {
  return (
    <span className="text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5 whitespace-nowrap" style={{ background: c.bg, color: c.fg }}>
      {text}
    </span>
  );
}
function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function OperationsBoard(props: {
  projects: ProjectOpt[];
  project: ProjectOpt;
  sites: { id: string; name: string }[];
  siteId: string | null;
  month: string;
  daysInMonth: number;
  today: string;
  logs: DailyLog[];
  period: PeriodInfo;
  perms: Perms;
  initialTab: string | null;
  totals: LogTotals;
  crewCost: { rows: CrewCostRow[]; total: number; personDays: number; missingRates: number };
  containerCost: { rows: ContainerCostRow[]; total: number };
  costEntries: CostEntry[];
  costs: CostBreakdown;
  terms: TermsProp;
  billing: BillingSummary;
  adjustments: Adjustment[];
  profit: Profitability;
  exportCsv: string;
  exportJson: string;
}) {
  const { projects, project, sites, siteId, month, period, perms } = props;
  const router = useRouter();
  const [, startTransition] = useTransition();
  const tabs = perms.commercial ? (["daily", "costs", "billing", "profit"] as const) : (["daily"] as const);
  const [tab, setTab] = useState<(typeof tabs)[number]>(tabs.includes(props.initialTab as any) ? (props.initialTab as any) : "daily");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState("");

  const nav = (next: { project?: string; site?: string; month?: string }) => {
    const q = new URLSearchParams();
    q.set("project", next.project ?? project.id);
    if (next.site ?? siteId) q.set("site", (next.site ?? siteId) as string);
    q.set("month", next.month ?? month);
    q.set("tab", tab);
    router.push(`/operations?${q.toString()}`);
  };
  const run = (fn: () => Promise<{ error?: string } | undefined>, after?: () => void) => {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await fn();
      if (res?.error) {
        setError(res.error);
        return;
      }
      after?.();
      router.refresh();
    });
  };

  const isOpen = period.status === "open";
  const periodColors = PERIOD_COLORS[period.status] ?? PERIOD_COLORS.open;
  const monthLabel = new Date(month + "-01T00:00:00Z").toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <div>
      {/* Selector row */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <select className={inputCls} style={inputStyle} value={project.id} onChange={(e) => nav({ project: e.target.value, site: "" })}>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.label}{p.status !== "active" ? ` (${p.status})` : ""}</option>
          ))}
        </select>
        <select className={inputCls} style={inputStyle} value={siteId ?? ""} onChange={(e) => nav({ site: e.target.value })}>
          {sites.length === 0 && <option value="">No vessels linked to this project</option>}
          {sites.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <div className="flex items-center gap-1">
          <button onClick={() => nav({ month: shiftMonth(month, -1) })} className="rounded-lg border px-2.5 py-2 text-sm" style={{ borderColor: "var(--ch-line)" }}>‹</button>
          <span className="text-sm font-semibold px-1" style={{ color: "var(--ch-ink)" }}>{monthLabel}</span>
          <button onClick={() => nav({ month: shiftMonth(month, 1) })} className="rounded-lg border px-2.5 py-2 text-sm" style={{ borderColor: "var(--ch-line)" }}>›</button>
        </div>
        <span className="text-xs" style={{ color: "var(--ch-sub)" }}>Contract: {project.contractLabel || "—"}</span>
      </div>

      {/* Period status bar */}
      <div className={`${cardCls} p-3 mb-4 flex items-center gap-2 flex-wrap`} style={cardStyle}>
        <span className="text-xs font-semibold" style={{ color: "var(--ch-sub)" }}>Period</span>
        {pill(PERIOD_STATUS_LABELS[period.status] ?? period.status, periodColors)}
        <span className="text-xs" style={{ color: "var(--ch-sub)" }}>
          {props.totals.verifiedDays} verified · {props.totals.unverifiedDays} unverified day(s)
          {period.reopenCount > 0 && <> · reopened {period.reopenCount}×</>}
        </span>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          {perms.close && isOpen && <button onClick={() => run(() => closePeriod(project.id, month))} className="ch-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold">Close month</button>}
          {perms.commercial && period.status === "closed" && <button onClick={() => run(() => approvePeriod(project.id, month))} className="ch-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold">Commercially approve</button>}
          {perms.commercial && period.status === "commercially_approved" && <button onClick={() => run(() => markBillingReady(project.id, month))} className="ch-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold">Mark billing-ready</button>}
          {perms.commercial && !isOpen && (
            <button onClick={() => setReopenOpen((v) => !v)} className="text-xs font-semibold" style={{ color: "var(--ch-fail)" }}>Reopen…</button>
          )}
        </div>
        {reopenOpen && (
          <div className="w-full flex items-center gap-2 flex-wrap pt-2 border-t" style={{ borderColor: "var(--ch-line)" }}>
            <input className={`${inputCls} flex-1 min-w-[200px]`} style={inputStyle} placeholder="Reason for reopening (required, audited)" value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} />
            <button onClick={() => run(() => reopenPeriod(project.id, month, reopenReason), () => { setReopenOpen(false); setReopenReason(""); })} disabled={!reopenReason.trim()} className="rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>Reopen period</button>
          </div>
        )}
        {period.history.length > 0 && (
          <div className="w-full text-[11px] pt-1" style={{ color: "var(--ch-sub)" }}>
            {period.history.map((h, i) => (
              <span key={i}>{i > 0 && " · "}{h.to.replace(/_/g, " ")} by {h.byName} {h.at.slice(0, 10)}{h.reason ? ` (${h.reason})` : ""}</span>
            ))}
          </div>
        )}
      </div>

      {error && <div className="text-sm mb-3 rounded-lg px-3 py-2" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>{error}</div>}
      {notice && <div className="text-sm mb-3 rounded-lg px-3 py-2" style={{ background: "#fef3e2", color: "#b45309" }}>{notice}</div>}

      <div className="flex items-center gap-1 rounded-lg border p-1 mb-4 w-fit bg-white flex-wrap" style={{ borderColor: "var(--ch-line)" }}>
        {tabs.map((t) => (
          <button key={t} onClick={() => setTab(t)} className="px-3 py-1.5 rounded-md text-xs font-semibold" style={tab === t ? { background: "var(--ch-navy)", color: "#fff" } : { color: "var(--ch-sub)" }}>
            {t === "daily" ? "Daily log" : t === "costs" ? "Costs" : t === "billing" ? "Billing" : "Profitability"}
          </button>
        ))}
      </div>

      {tab === "daily" && <DailyTab {...props} run={run} isOpen={isOpen} />}
      {tab === "costs" && perms.commercial && <CostsTab {...props} run={run} isOpen={isOpen} />}
      {tab === "billing" && perms.commercial && <BillingTab {...props} run={run} setNotice={setNotice} />}
      {tab === "profit" && perms.commercial && <ProfitTab {...props} />}
    </div>
  );
}

type Run = (fn: () => Promise<{ error?: string } | undefined>, after?: () => void) => void;

/* ================= Daily log ================= */

function DailyTab({ project, siteId, sites, month, daysInMonth, today, logs, perms, run, isOpen }: { project: ProjectOpt; siteId: string | null; sites: { id: string; name: string }[]; month: string; daysInMonth: number; today: string; logs: DailyLog[]; perms: Perms; run: Run; isOpen: boolean }) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const siteLogs = logs.filter((l) => l.offshore_site_id === siteId);
  const byDate: Record<string, DailyLog> = Object.fromEntries(siteLogs.map((l) => [l.entry_date, l]));
  const dates = Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
  const selectedLog = selectedDate ? byDate[selectedDate] ?? null : null;

  if (!siteId) return <div className="text-sm" style={{ color: "var(--ch-sub)" }}>Link a vessel/site to this project (Crew Setup → Offshore Sites) to start logging.</div>;

  return (
    <div className="space-y-4">
      <div className={`${cardCls} p-3`} style={cardStyle}>
        <div className="text-xs mb-2" style={{ color: "var(--ch-sub)" }}>{sites.find((s) => s.id === siteId)?.name} — tap a day to enter or review.</div>
        <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))" }}>
          {dates.map((d) => {
            const l = byDate[d];
            const status = l?.status ?? "missing";
            const c = LOG_COLORS[status];
            const future = d > today;
            return (
              <button
                key={d}
                onClick={() => setSelectedDate(d)}
                disabled={future && !l}
                className="rounded-lg border px-1.5 py-1.5 text-left disabled:opacity-40"
                style={{ borderColor: selectedDate === d ? "var(--ch-navy)" : "var(--ch-line)", background: c.bg }}
              >
                <div className="text-xs font-bold" style={{ color: "var(--ch-ink)" }}>{Number(d.slice(-2))}</div>
                <div className="text-[10px] font-semibold uppercase" style={{ color: c.fg }}>{l ? LOG_STATUS_LABELS[l.status] : future ? "—" : "missing"}</div>
                {l && <div className="text-[10px]" style={{ color: "var(--ch-sub)" }}>POB {l.client_pob + l.crew_pob}</div>}
              </button>
            );
          })}
        </div>
      </div>

      {selectedDate && (
        <DailyLogForm
          key={`${siteId}-${selectedDate}-${selectedLog?.status ?? "new"}`}
          projectId={project.id}
          siteId={siteId}
          date={selectedDate}
          log={selectedLog}
          perms={perms}
          isOpen={isOpen}
          run={run}
          onClose={() => setSelectedDate(null)}
        />
      )}

      {siteLogs.length > 0 && (
        <div className={`${cardCls} p-3`} style={cardStyle}>
          <div className="text-sm font-bold mb-2" style={{ color: "var(--ch-ink)" }}>Month summary — {sites.find((s) => s.id === siteId)?.name}</div>
          <div style={{ overflowX: "auto" }}>
            <table className="text-xs w-full min-w-[720px]">
              <thead>
                <tr style={{ color: "var(--ch-sub)" }}>
                  {["Date", "Status", "Client POB", "Crew POB", "B", "L", "D", "N", "Special", "Packed", "OT hrs", "Complaints", "NCs"].map((h) => <th key={h} className="text-left py-1 font-semibold pr-2">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {siteLogs.map((l) => (
                  <tr key={l.id} className="border-t cursor-pointer" style={{ borderColor: "var(--ch-line)", color: "var(--ch-ink)" }} onClick={() => setSelectedDate(l.entry_date)}>
                    <td className="py-1 pr-2">{l.entry_date}</td>
                    <td className="py-1 pr-2">{pill(LOG_STATUS_LABELS[l.status], LOG_COLORS[l.status])}</td>
                    <td className="py-1 pr-2">{l.client_pob}</td><td className="py-1 pr-2">{l.crew_pob}</td>
                    <td className="py-1 pr-2">{l.breakfast_count}</td><td className="py-1 pr-2">{l.lunch_count}</td><td className="py-1 pr-2">{l.dinner_count}</td><td className="py-1 pr-2">{l.night_meal_count}</td>
                    <td className="py-1 pr-2">{l.special_meals}</td><td className="py-1 pr-2">{l.packed_meals}</td><td className="py-1 pr-2">{l.att_overtime_hours}</td>
                    <td className="py-1 pr-2">{l.client_complaints}</td><td className="py-1 pr-2">{l.non_conformities}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function DailyLogForm({ projectId, siteId, date, log, perms, isOpen, run, onClose }: { projectId: string; siteId: string; date: string; log: DailyLog | null; perms: Perms; isOpen: boolean; run: Run; onClose: () => void }) {
  const [v, setV] = useState<Record<string, string | boolean>>({
    clientPob: String(log?.client_pob ?? ""),
    crewPob: String(log?.crew_pob ?? ""),
    breakfastCount: String(log?.breakfast_count ?? ""),
    lunchCount: String(log?.lunch_count ?? ""),
    dinnerCount: String(log?.dinner_count ?? ""),
    nightMealCount: String(log?.night_meal_count ?? ""),
    specialMeals: String(log?.special_meals ?? ""),
    packedMeals: String(log?.packed_meals ?? ""),
    attOnboard: String(log?.att_onboard ?? ""),
    attOnDuty: String(log?.att_on_duty ?? ""),
    attOffDuty: String(log?.att_off_duty ?? ""),
    attSick: String(log?.att_sick ?? ""),
    attTraining: String(log?.att_training ?? ""),
    attTravel: String(log?.att_travel ?? ""),
    attOvertimeHours: String(log?.att_overtime_hours ?? ""),
    attEmergencyDuty: String(log?.att_emergency_duty ?? ""),
    cateringDelivered: log?.catering_delivered ?? true,
    housekeepingCompleted: log?.housekeeping_completed ?? true,
    laundryKg: log?.laundry_kg != null ? String(log.laundry_kg) : "",
    specialEvents: log?.special_events ?? "",
    serviceInterruptions: log?.service_interruptions ?? "",
    clientComplaints: String(log?.client_complaints ?? ""),
    clientComplaintNotes: log?.client_complaint_notes ?? "",
    foodWasteKg: log?.food_waste_kg != null ? String(log.food_waste_kg) : "",
    nonConformities: String(log?.non_conformities ?? ""),
    nonConformityNotes: log?.non_conformity_notes ?? "",
    remarks: log?.remarks ?? "",
  });
  const [rejectReason, setRejectReason] = useState("");
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV((p) => ({ ...p, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value }));
  const editable = isOpen && perms.enter && (!log || log.status !== "verified" || perms.verify);

  const fd = () => {
    const f = new FormData();
    for (const [k, val] of Object.entries(v)) {
      if (typeof val === "boolean") {
        if (val) f.set(k, "on");
      } else f.set(k, val);
    }
    return f;
  };
  const num = (k: string, label: string) => (
    <label className={lbl} style={lblStyle}>
      {label}
      <input type="number" min={0} inputMode="numeric" className={`${inputCls} w-full mt-1`} style={inputStyle} value={v[k] as string} onChange={set(k)} disabled={!editable} />
    </label>
  );
  const text = (k: string, label: string, placeholder?: string) => (
    <label className={`${lbl} block`} style={lblStyle}>
      {label}
      <input className={`${inputCls} w-full mt-1`} style={inputStyle} value={v[k] as string} onChange={set(k)} placeholder={placeholder} disabled={!editable} />
    </label>
  );
  const section = (title: string) => <div className="text-[11px] font-bold uppercase tracking-wide mt-3 mb-1.5" style={{ color: "var(--ch-navy)" }}>{title}</div>;

  return (
    <div className={`${cardCls} p-4`} style={cardStyle}>
      <div className="flex items-center gap-2 flex-wrap mb-1">
        <div className="text-sm font-bold" style={{ color: "var(--ch-ink)" }}>{date}</div>
        {log ? pill(LOG_STATUS_LABELS[log.status], LOG_COLORS[log.status]) : pill("new", LOG_COLORS.draft)}
        {!isOpen && pill("period closed", PERIOD_COLORS.closed)}
        {log?.status === "rejected" && log.rejection_reason && <span className="text-xs" style={{ color: "var(--ch-fail)" }}>Rejected: {log.rejection_reason}</span>}
        {log?.status === "verified" && <span className="text-xs" style={{ color: "var(--ch-sub)" }}>verified by {log.verified_by_name}</span>}
        <button onClick={onClose} className="ml-auto text-xs font-semibold" style={{ color: "var(--ch-sub)" }}>Close</button>
      </div>

      {section("POB & meals")}
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
        {num("clientPob", "Client POB")}
        {num("crewPob", "Catering crew POB")}
        {num("breakfastCount", "Breakfast")}
        {num("lunchCount", "Lunch")}
        {num("dinnerCount", "Dinner")}
        {num("nightMealCount", "Night meal")}
        {num("specialMeals", "Special meals")}
        {num("packedMeals", "Packed meals")}
      </div>

      {section("Crew attendance")}
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
        {num("attOnboard", "Onboard")}
        {num("attOnDuty", "On duty")}
        {num("attOffDuty", "Off duty")}
        {num("attSick", "Sick")}
        {num("attTraining", "Training")}
        {num("attTravel", "Travel")}
        {num("attOvertimeHours", "Overtime (hrs)")}
        {num("attEmergencyDuty", "Emergency duty")}
      </div>

      {section("Service delivery")}
      <div className="flex items-center gap-4 flex-wrap mb-2">
        <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--ch-ink)" }}>
          <input type="checkbox" checked={v.cateringDelivered as boolean} onChange={set("cateringDelivered")} disabled={!editable} /> Catering delivered
        </label>
        <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--ch-ink)" }}>
          <input type="checkbox" checked={v.housekeepingCompleted as boolean} onChange={set("housekeepingCompleted")} disabled={!editable} /> Housekeeping completed
        </label>
      </div>
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
        {num("laundryKg", "Laundry (kg)")}
        {num("foodWasteKg", "Food waste (kg)")}
        {num("clientComplaints", "Client complaints")}
        {num("nonConformities", "Non-conformities")}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 mt-2">
        {text("specialEvents", "Special events")}
        {text("serviceInterruptions", "Service interruptions", "None")}
        {text("clientComplaintNotes", "Complaint details")}
        {text("nonConformityNotes", "Non-conformity details")}
      </div>
      <label className={`${lbl} block mt-2`} style={lblStyle}>
        Remarks
        <textarea className={`${inputCls} w-full mt-1`} style={inputStyle} rows={2} value={v.remarks as string} onChange={set("remarks")} disabled={!editable} />
      </label>

      <div className="flex items-center gap-2 flex-wrap mt-3">
        {editable && (
          <>
            <button onClick={() => run(() => saveDailyLog(projectId, siteId, date, fd(), false))} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-line)" }}>Save draft</button>
            <button onClick={() => run(() => saveDailyLog(projectId, siteId, date, fd(), true), onClose)} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold">Save &amp; submit</button>
          </>
        )}
        {perms.verify && isOpen && log?.status === "submitted" && (
          <>
            <button onClick={() => run(() => verifyDailyLog(log.id, true), onClose)} className="rounded-lg px-4 py-2 text-sm font-semibold" style={{ background: "var(--ch-pass-bg)", color: "var(--ch-pass)" }}>Verify</button>
            <input className={`${inputCls} w-48`} style={inputStyle} placeholder="Rejection reason" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
            <button onClick={() => run(() => verifyDailyLog(log.id, false, rejectReason), onClose)} disabled={!rejectReason.trim()} className="text-sm font-semibold disabled:opacity-40" style={{ color: "var(--ch-fail)" }}>Reject</button>
          </>
        )}
        {perms.verify && isOpen && log?.status === "verified" && (
          <>
            <input className={`${inputCls} w-48`} style={inputStyle} placeholder="Reason to un-verify" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
            <button onClick={() => run(() => unverifyDailyLog(log.id, rejectReason), onClose)} disabled={!rejectReason.trim()} className="text-sm font-semibold disabled:opacity-40" style={{ color: "var(--ch-fail)" }}>Un-verify</button>
          </>
        )}
      </div>
    </div>
  );
}

/* ================= Costs ================= */

function CostsTab({ project, sites, month, crewCost, containerCost, costEntries, costs, perms, run, isOpen }: { project: ProjectOpt; sites: { id: string; name: string }[]; month: string; crewCost: { rows: CrewCostRow[]; total: number; personDays: number; missingRates: number }; containerCost: { rows: ContainerCostRow[]; total: number }; costEntries: CostEntry[]; costs: CostBreakdown; perms: Perms; run: Run; isOpen: boolean }) {
  const cur = project.currency ?? "USD";
  const [showAdd, setShowAdd] = useState(false);
  const [f, setF] = useState({ category: "provision", description: "", amount: "", costDate: `${month}-01`, reference: "", offshoreSiteId: "" });
  const tiles: [string, number][] = [
    ["Crew (from assignments)", costs.crew],
    ["Travel", costs.travel],
    ["Visa & medical", costs.visaMedical],
    ["Provisions", costs.provision],
    ["Containers", costs.container],
    ["Equipment", costs.equipment],
    ["Other mobilization", costs.otherMobilization],
    ["Other", costs.other],
  ];
  return (
    <div className="space-y-4">
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-4 lg:grid-cols-8">
        {tiles.map(([l, v]) => (
          <div key={l} className={`${cardCls} p-3`} style={cardStyle}>
            <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--ch-sub)" }}>{l}</div>
            <div className="text-sm font-bold" style={{ color: "var(--ch-ink)" }}>{fmtMoney(v, cur)}</div>
          </div>
        ))}
      </div>
      <div className={`${cardCls} p-3 flex items-center gap-3 flex-wrap`} style={cardStyle}>
        <span className="text-sm font-bold" style={{ color: "var(--ch-ink)" }}>Total project/vessel cost this month: {fmtMoney(costs.total, cur)}</span>
        {crewCost.missingRates > 0 && <span className="text-xs" style={{ color: "var(--ch-fail)" }}>{crewCost.missingRates} crew member(s) have no day rate — crew cost is understated.</span>}
      </div>

      <div className={`${cardCls} p-4`} style={cardStyle}>
        <div className="text-sm font-bold mb-2" style={{ color: "var(--ch-ink)" }}>Crew cost — {crewCost.personDays} person-days from assignments</div>
        {crewCost.rows.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No crew assignments on this project in {month}.</div>}
        <div className="space-y-1">
          {crewCost.rows.map((r) => (
            <div key={r.assignmentId} className="text-xs flex items-center gap-2 flex-wrap border-t py-1.5" style={{ borderColor: "var(--ch-line)" }}>
              <span className="font-semibold" style={{ color: "var(--ch-ink)" }}>{r.crewName}</span>
              <span style={{ color: "var(--ch-sub)" }}>{r.roleName ?? "—"} · {r.siteName ?? "—"} · {r.days}d × {r.dayRate != null ? fmtMoney(r.dayRate) : <b style={{ color: "var(--ch-fail)" }}>no rate</b>}</span>
              <span className="ml-auto font-semibold" style={{ color: "var(--ch-ink)" }}>{fmtMoney(r.cost, cur)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className={`${cardCls} p-4`} style={cardStyle}>
        <div className="text-sm font-bold mb-2" style={{ color: "var(--ch-ink)" }}>Container cost — from container movements</div>
        {containerCost.rows.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No container movements on this project in {month}.</div>}
        {containerCost.rows.map((r) => (
          <div key={r.movementId} className="text-xs flex items-center gap-2 flex-wrap border-t py-1.5" style={{ borderColor: "var(--ch-line)" }}>
            <span className="font-mono font-semibold" style={{ color: "var(--ch-ink)" }}>{r.containerCode}</span>
            <span style={{ color: "var(--ch-sub)" }}>{r.daysInMonth}d in month · rental {fmtMoney(r.rental)} · shipping/port/handling {fmtMoney(r.oneOff)}</span>
            <span className="ml-auto font-semibold" style={{ color: "var(--ch-ink)" }}>{fmtMoney(r.total, cur)}</span>
          </div>
        ))}
      </div>

      <div className={`${cardCls} p-4`} style={cardStyle}>
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-bold" style={{ color: "var(--ch-ink)" }}>Other costs (entered)</div>
          {(perms.enter || perms.commercial) && isOpen && <button onClick={() => setShowAdd((s) => !s)} className="text-xs font-semibold ch-link-navy">{showAdd ? "Close" : "+ Add cost"}</button>}
        </div>
        {showAdd && (
          <div className="border rounded-lg p-3 mb-3" style={{ borderColor: "var(--ch-line)" }}>
            <div className="grid gap-2 sm:grid-cols-3">
              <select className={inputCls} style={inputStyle} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
                {COST_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
              <input type="date" className={inputCls} style={inputStyle} value={f.costDate} onChange={(e) => setF({ ...f, costDate: e.target.value })} />
              <input type="number" min={0} step="0.01" className={inputCls} style={inputStyle} placeholder={`Amount (${cur})`} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
              <input className={`${inputCls} sm:col-span-2`} style={inputStyle} placeholder="Description (required)" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
              <input className={inputCls} style={inputStyle} placeholder="Invoice / reference" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />
              <select className={inputCls} style={inputStyle} value={f.offshoreSiteId} onChange={(e) => setF({ ...f, offshoreSiteId: e.target.value })}>
                <option value="">Whole project</option>
                {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <button
              onClick={() => {
                const fd = new FormData();
                fd.set("category", f.category); fd.set("costDate", f.costDate); fd.set("amount", f.amount); fd.set("description", f.description.trim()); fd.set("reference", f.reference); fd.set("offshoreSiteId", f.offshoreSiteId); fd.set("currency", cur);
                run(() => addCostEntry(project.id, fd), () => { setShowAdd(false); setF({ ...f, description: "", amount: "", reference: "" }); });
              }}
              disabled={!f.description.trim() || !f.amount}
              className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold mt-2 disabled:opacity-50"
            >
              Add
            </button>
          </div>
        )}
        {costEntries.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No manual cost entries this month.</div>}
        {costEntries.map((c) => (
          <div key={c.id} className="text-xs flex items-center gap-2 flex-wrap border-t py-1.5" style={{ borderColor: "var(--ch-line)" }}>
            <span style={{ color: "var(--ch-sub)" }}>{c.costDate}</span>
            <span className="font-semibold" style={{ color: "var(--ch-ink)" }}>{COST_CATEGORIES.find((x) => x.value === c.category)?.label ?? c.category}</span>
            <span style={{ color: "var(--ch-sub)" }}>{c.description}{c.reference ? ` · ${c.reference}` : ""}{c.siteName ? ` · ${c.siteName}` : ""}</span>
            <span className="ml-auto font-semibold" style={{ color: "var(--ch-ink)" }}>{fmtMoney(c.amount, c.currency)}</span>
            {(perms.enter || perms.commercial) && isOpen && <button onClick={() => run(() => deleteCostEntry(c.id))} className="text-xs" style={{ color: "var(--ch-fail)" }}>✕</button>}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ================= Billing ================= */

function BillingTab({ project, month, terms, billing, adjustments, period, perms, totals, exportCsv, exportJson, run, setNotice }: { project: ProjectOpt; month: string; terms: TermsProp; billing: BillingSummary; adjustments: Adjustment[]; period: PeriodInfo; perms: Perms; totals: LogTotals; exportCsv: string; exportJson: string; run: Run; setNotice: (s: string | null) => void }) {
  const [editTerms, setEditTerms] = useState(!terms);
  const [adj, setAdj] = useState({ kind: "additional_service", description: "", amount: "", reference: "" });
  const cur = billing.currency;
  const canExport = ["commercially_approved", "billing_ready"].includes(period.status);

  return (
    <div className="space-y-4">
      {billing.warnings.length > 0 && (
        <div className="text-xs rounded-lg px-3 py-2 space-y-0.5" style={{ background: "#fef3e2", color: "#b45309" }}>
          {billing.warnings.map((w, i) => <div key={i}>{w}</div>)}
        </div>
      )}

      <div className={`${cardCls} p-4`} style={cardStyle}>
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <div className="text-sm font-bold" style={{ color: "var(--ch-ink)" }}>Billing terms</div>
          {terms && pill(terms.isProjectOverride ? "project override" : "contract default", PERIOD_COLORS.commercially_approved)}
          {terms && <span className="text-xs" style={{ color: "var(--ch-sub)" }}>{BILLING_MODELS.find((m) => m.value === terms.billing_model)?.label}</span>}
          <button onClick={() => setEditTerms((v) => !v)} className="ml-auto text-xs font-semibold ch-link-navy">{editTerms ? "Close" : "Edit"}</button>
        </div>
        {editTerms && <BillingTermsForm project={project} terms={terms} run={run} onDone={() => setEditTerms(false)} />}
      </div>

      <div className={`${cardCls} p-4`} style={cardStyle}>
        <div className="text-sm font-bold mb-2" style={{ color: "var(--ch-ink)" }}>Billing summary — {month}</div>
        <div className="grid gap-2 grid-cols-2 sm:grid-cols-4 mb-3 text-xs" style={{ color: "var(--ch-sub)" }}>
          <div>Billable person-days <b style={{ color: "var(--ch-ink)" }}>{billing.billablePersonDays}</b></div>
          <div>Billable service days <b style={{ color: "var(--ch-ink)" }}>{billing.billableServiceDays}</b></div>
          <div>Meals (B/L/D/N) <b style={{ color: "var(--ch-ink)" }}>{totals.breakfasts}/{totals.lunches}/{totals.dinners}/{totals.nightMeals}</b></div>
          <div>Special / packed <b style={{ color: "var(--ch-ink)" }}>{totals.specialMeals} / {totals.packedMeals}</b></div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="text-xs w-full min-w-[520px]">
            <tbody>
              {billing.lines.map((l, i) => (
                <tr key={i} className="border-t" style={{ borderColor: "var(--ch-line)", color: "var(--ch-ink)" }}>
                  <td className="py-1.5">{l.label}</td>
                  <td className="py-1.5 text-right" style={{ color: "var(--ch-sub)" }}>{l.quantity != null ? `${l.quantity} ${l.unit ?? ""}` : ""}</td>
                  <td className="py-1.5 text-right" style={{ color: "var(--ch-sub)" }}>{l.rate != null ? fmtMoney(l.rate) : ""}</td>
                  <td className="py-1.5 text-right font-semibold">{fmtMoney(l.amount, cur)}</td>
                </tr>
              ))}
              <tr className="border-t" style={{ borderColor: "var(--ch-line)", color: "var(--ch-ink)" }}><td className="py-1.5" colSpan={3}>Base revenue</td><td className="py-1.5 text-right font-semibold">{fmtMoney(billing.baseRevenue, cur)}</td></tr>
              <tr className="border-t" style={{ borderColor: "var(--ch-line)", color: "var(--ch-ink)" }}><td className="py-1.5" colSpan={3}>Additional approved services</td><td className="py-1.5 text-right">{fmtMoney(billing.additionalServices, cur)}</td></tr>
              <tr className="border-t" style={{ borderColor: "var(--ch-line)", color: "var(--ch-ink)" }}><td className="py-1.5" colSpan={3}>Deductions / service failures</td><td className="py-1.5 text-right" style={{ color: "var(--ch-fail)" }}>−{fmtMoney(billing.deductions, cur)}</td></tr>
              <tr className="border-t" style={{ borderColor: "var(--ch-ink)", color: "var(--ch-ink)" }}><td className="py-2 font-bold" colSpan={3}>Proposed invoice value</td><td className="py-2 text-right font-bold text-sm">{fmtMoney(billing.proposedInvoice, cur)}</td></tr>
            </tbody>
          </table>
        </div>
        <div className="text-xs mt-2" style={{ color: "var(--ch-sub)" }}>
          Supporting records: {totals.verifiedDays} verified daily logs{totals.unverifiedDays ? `, ${totals.unverifiedDays} unverified (excluded)` : ""} · service interruptions {totals.interruptions} · complaints {totals.complaints} · non-conformities {totals.nonConformities}
        </div>
        <div className="flex items-center gap-2 flex-wrap mt-3">
          <button onClick={() => download(`billing-${project.label.replace(/\s+/g, "_")}-${month}.csv`, exportCsv, "text/csv")} disabled={!canExport} className="ch-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50">Export CSV</button>
          <button onClick={() => download(`billing-${project.label.replace(/\s+/g, "_")}-${month}.json`, exportJson, "application/json")} disabled={!canExport} className="rounded-lg px-3 py-1.5 text-xs font-semibold border disabled:opacity-50" style={{ borderColor: "var(--ch-line)" }}>Export JSON (ERP / Zoho)</button>
          {!canExport && <button onClick={() => setNotice("Exports are available once the period is commercially approved.")} className="text-xs" style={{ color: "var(--ch-sub)" }}>Why disabled?</button>}
        </div>
      </div>

      <div className={`${cardCls} p-4`} style={cardStyle}>
        <div className="text-sm font-bold mb-2" style={{ color: "var(--ch-ink)" }}>Additional services & deductions</div>
        {(perms.close || perms.commercial) && !["commercially_approved", "billing_ready"].includes(period.status) && (
          <div className="grid gap-2 sm:grid-cols-4 mb-3">
            <select className={inputCls} style={inputStyle} value={adj.kind} onChange={(e) => setAdj({ ...adj, kind: e.target.value })}>
              <option value="additional_service">Additional service (+)</option>
              <option value="deduction">Deduction / service failure (−)</option>
            </select>
            <input className={`${inputCls} sm:col-span-2`} style={inputStyle} placeholder="Description" value={adj.description} onChange={(e) => setAdj({ ...adj, description: e.target.value })} />
            <input type="number" min={0} step="0.01" className={inputCls} style={inputStyle} placeholder={`Amount (${cur})`} value={adj.amount} onChange={(e) => setAdj({ ...adj, amount: e.target.value })} />
            <input className={`${inputCls} sm:col-span-3`} style={inputStyle} placeholder="Reference (PO, client approval, incident)" value={adj.reference} onChange={(e) => setAdj({ ...adj, reference: e.target.value })} />
            <button
              onClick={() => {
                const fd = new FormData();
                fd.set("kind", adj.kind); fd.set("description", adj.description.trim()); fd.set("amount", adj.amount); fd.set("reference", adj.reference); fd.set("currency", cur);
                run(() => addAdjustment(project.id, month, fd), () => setAdj({ ...adj, description: "", amount: "", reference: "" }));
              }}
              disabled={!adj.description.trim() || !adj.amount}
              className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
            >
              Propose
            </button>
          </div>
        )}
        {adjustments.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>None this month.</div>}
        {adjustments.map((a) => (
          <div key={a.id} className="text-xs flex items-center gap-2 flex-wrap border-t py-1.5" style={{ borderColor: "var(--ch-line)" }}>
            {pill(a.kind === "deduction" ? "deduction" : "additional", a.kind === "deduction" ? LOG_COLORS.rejected : LOG_COLORS.verified)}
            {pill(a.status, a.status === "approved" ? LOG_COLORS.verified : a.status === "rejected" ? LOG_COLORS.rejected : LOG_COLORS.submitted)}
            <span className="font-semibold" style={{ color: "var(--ch-ink)" }}>{a.description}</span>
            <span style={{ color: "var(--ch-sub)" }}>{a.reference ?? ""} · by {a.byName}{a.decidedByName ? ` · decided by ${a.decidedByName}` : ""}</span>
            <span className="ml-auto font-semibold" style={{ color: "var(--ch-ink)" }}>{a.kind === "deduction" ? "−" : "+"}{fmtMoney(a.amount, a.currency)}</span>
            {perms.commercial && a.status === "proposed" && (
              <>
                <button onClick={() => run(() => decideAdjustment(a.id, true))} className="text-xs font-semibold" style={{ color: "var(--ch-pass)" }}>Approve</button>
                <button onClick={() => run(() => decideAdjustment(a.id, false))} className="text-xs font-semibold" style={{ color: "var(--ch-fail)" }}>Reject</button>
              </>
            )}
            {(perms.close || perms.commercial) && a.status === "proposed" && <button onClick={() => run(() => deleteAdjustment(a.id))} className="text-xs" style={{ color: "var(--ch-sub)" }}>✕</button>}
          </div>
        ))}
      </div>
    </div>
  );
}

function BillingTermsForm({ project, terms, run, onDone }: { project: ProjectOpt; terms: TermsProp; run: Run; onDone: () => void }) {
  const [scope, setScope] = useState<"contract" | "project">(terms?.isProjectOverride ? "project" : "contract");
  const [v, setV] = useState<Record<string, string>>({
    billingModel: terms?.billing_model ?? "per_person_day",
    currency: terms?.currency ?? project.currency ?? "USD",
    pobBasis: terms?.pob_basis ?? "client_pob",
    minimumBillablePob: terms?.minimum_billable_pob != null ? String(terms.minimum_billable_pob) : "",
    ratePerPersonDay: terms?.rate_per_person_day != null ? String(terms.rate_per_person_day) : "",
    rateBreakfast: terms?.rate_breakfast != null ? String(terms.rate_breakfast) : "",
    rateLunch: terms?.rate_lunch != null ? String(terms.rate_lunch) : "",
    rateDinner: terms?.rate_dinner != null ? String(terms.rate_dinner) : "",
    rateNightMeal: terms?.rate_night_meal != null ? String(terms.rate_night_meal) : "",
    rateSpecialMeal: terms?.rate_special_meal != null ? String(terms.rate_special_meal) : "",
    ratePackedMeal: terms?.rate_packed_meal != null ? String(terms.rate_packed_meal) : "",
    fixedMonthlyFee: terms?.fixed_monthly_fee != null ? String(terms.fixed_monthly_fee) : "",
    lumpSumAmount: terms?.lump_sum_amount != null ? String(terms.lump_sum_amount) : "",
    lumpSumBillingMonth: terms?.lump_sum_billing_month ? terms.lump_sum_billing_month.slice(0, 7) : "",
    markupPct: terms?.markup_pct != null ? String(terms.markup_pct) : "",
    managementFeeMonthly: terms?.management_fee_monthly != null ? String(terms.management_fee_monthly) : "",
    monthlyBudgetCost: terms?.monthly_budget_cost != null ? String(terms.monthly_budget_cost) : "",
    monthlyBudgetRevenue: terms?.monthly_budget_revenue != null ? String(terms.monthly_budget_revenue) : "",
    notes: terms?.notes ?? "",
  });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV((p) => ({ ...p, [k]: e.target.value }));
  const m = v.billingModel;
  const showPpd = ["per_person_day", "mixed"].includes(m);
  const showFixed = ["fixed_monthly", "mixed"].includes(m);
  const showLump = m === "lump_sum";
  const showMarkup = ["cost_plus", "mixed"].includes(m);
  const showMgmt = ["management_fee", "mixed"].includes(m);
  const field = (k: string, label: string, type = "number") => (
    <label className={lbl} style={lblStyle}>
      {label}
      <input type={type} step={type === "number" ? "0.01" : undefined} className={`${inputCls} w-full mt-1`} style={inputStyle} value={v[k]} onChange={set(k)} />
    </label>
  );
  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap mb-2 text-xs" style={{ color: "var(--ch-ink)" }}>
        <label className="flex items-center gap-1"><input type="radio" checked={scope === "contract"} onChange={() => setScope("contract")} /> Contract default ({project.contractLabel || "contract"})</label>
        <label className="flex items-center gap-1"><input type="radio" checked={scope === "project"} onChange={() => setScope("project")} /> Override for this project only</label>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className={lbl} style={lblStyle}>
          Billing model
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={v.billingModel} onChange={set("billingModel")}>
            {BILLING_MODELS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
          </select>
        </label>
        {field("currency", "Currency", "text")}
        {showPpd && (
          <label className={lbl} style={lblStyle}>
            POB basis
            <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={v.pobBasis} onChange={set("pobBasis")}>
              <option value="client_pob">Client POB</option>
              <option value="total_pob">Client + catering crew POB</option>
            </select>
          </label>
        )}
        {showPpd && field("minimumBillablePob", "Minimum billable POB / day")}
        {showPpd && field("ratePerPersonDay", "Rate per person per day")}
        {showPpd && field("rateBreakfast", "Rate per breakfast (optional, replaces PPD)")}
        {showPpd && field("rateLunch", "Rate per lunch")}
        {showPpd && field("rateDinner", "Rate per dinner")}
        {showPpd && field("rateNightMeal", "Rate per night meal")}
        {showPpd && field("rateSpecialMeal", "Rate per special meal")}
        {showPpd && field("ratePackedMeal", "Rate per packed meal")}
        {showFixed && field("fixedMonthlyFee", "Fixed monthly fee")}
        {showLump && field("lumpSumAmount", "Lump sum amount")}
        {showLump && field("lumpSumBillingMonth", "Lump sum billing month", "month")}
        {showMarkup && field("markupPct", "Markup % on actual cost")}
        {showMgmt && field("managementFeeMonthly", "Management fee per month")}
        {field("monthlyBudgetCost", "Monthly budget — cost")}
        {field("monthlyBudgetRevenue", "Monthly budget — revenue")}
      </div>
      <textarea className={`${inputCls} w-full mt-2`} style={inputStyle} rows={2} placeholder="Notes" value={v.notes} onChange={set("notes")} />
      <div className="flex items-center gap-2 mt-3 flex-wrap">
        <button
          onClick={() => {
            const fd = new FormData();
            for (const [k, val] of Object.entries(v)) fd.set(k, val);
            run(() => saveBillingTerms(project.contractId, scope === "project" ? project.id : null, fd), onDone);
          }}
          className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold"
        >
          Save terms
        </button>
        {terms?.isProjectOverride && <button onClick={() => run(() => deleteProjectBillingOverride(project.id), onDone)} className="text-xs font-semibold" style={{ color: "var(--ch-fail)" }}>Remove project override</button>}
        <button onClick={onDone} className="text-xs font-semibold" style={{ color: "var(--ch-sub)" }}>Cancel</button>
      </div>
    </div>
  );
}

/* ================= Profitability ================= */

function ProfitTab({ profit, billing, totals }: { profit: Profitability; billing: BillingSummary; totals: LogTotals }) {
  const cur = billing.currency;
  const t = (label: string, value: string, tone?: "ok" | "fail") => (
    <div key={label} className={`${cardCls} p-3`} style={cardStyle}>
      <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--ch-sub)" }}>{label}</div>
      <div className="text-sm font-bold" style={{ color: tone === "ok" ? "var(--ch-pass)" : tone === "fail" ? "var(--ch-fail)" : "var(--ch-ink)" }}>{value}</div>
    </div>
  );
  const variance = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : ""}${fmtMoney(v, cur)}`);
  return (
    <div className="space-y-4">
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
        {t("Revenue (proposed invoice)", fmtMoney(profit.revenue, cur))}
        {t("Crew cost", fmtMoney(profit.crewCost, cur))}
        {t("Provision cost", fmtMoney(profit.provisionCost, cur))}
        {t("Logistics / container cost", fmtMoney(profit.logisticsCost, cur))}
        {t("Other direct cost", fmtMoney(profit.otherDirectCost, cur))}
        {t("Total cost", fmtMoney(profit.totalCost, cur))}
        {t("Gross margin", fmtMoney(profit.grossMargin, cur), profit.grossMargin >= 0 ? "ok" : "fail")}
        {t("Margin %", profit.marginPct != null ? `${profit.marginPct.toFixed(1)}%` : "—", profit.marginPct == null ? undefined : profit.marginPct >= 0 ? "ok" : "fail")}
        {t("Person-days (verified)", String(profit.personDays))}
        {t("Cost per person-day", profit.costPerPersonDay != null ? fmtMoney(profit.costPerPersonDay, cur) : "—")}
        {t("Revenue per person-day", profit.revenuePerPersonDay != null ? fmtMoney(profit.revenuePerPersonDay, cur) : "—")}
        {t("Service days", String(totals.verifiedDays))}
      </div>
      <div className={`${cardCls} p-4`} style={cardStyle}>
        <div className="text-sm font-bold mb-2" style={{ color: "var(--ch-ink)" }}>Budget vs actual</div>
        {profit.budgetCost == null && profit.budgetRevenue == null ? (
          <div className="text-sm" style={{ color: "var(--ch-sub)" }}>Set monthly budget cost / revenue in Billing terms to see variance.</div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 text-sm" style={{ color: "var(--ch-ink)" }}>
            <div>Cost: budget {fmtMoney(profit.budgetCost, cur)} · actual {fmtMoney(profit.totalCost, cur)} · variance <b style={{ color: (profit.costVariance ?? 0) > 0 ? "var(--ch-fail)" : "var(--ch-pass)" }}>{variance(profit.costVariance)}</b></div>
            <div>Revenue: budget {fmtMoney(profit.budgetRevenue, cur)} · actual {fmtMoney(profit.revenue, cur)} · variance <b style={{ color: (profit.revenueVariance ?? 0) < 0 ? "var(--ch-fail)" : "var(--ch-pass)" }}>{variance(profit.revenueVariance)}</b></div>
          </div>
        )}
      </div>
      <p className="text-xs" style={{ color: "var(--ch-sub)" }}>
        Revenue is the proposed invoice for the month (verified days only). Crew cost comes from assignments × day rate; container cost from container movements; other costs from manual entries. Logistics = containers + travel + other mobilization.
      </p>
    </div>
  );
}
