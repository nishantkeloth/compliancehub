// Phase 8 — operations cost, billing and profitability maths. Pure
// functions over already-fetched rows (same role as lib/containers.ts),
// so the Operations page, exports and any future ERP/Zoho hand-off all
// agree on the numbers.
//
// Definitions (documented in claude/phase8-operations-billing.md):
//  * Crew cost = Σ over crew_assignments linked to the project (or to one
//    of its vessels) of (days of the assignment falling inside the month)
//    × crew_profiles.day_rate. Assignments still open run to today.
//  * Container cost for a month = rental pro-rated to the deployed days
//    inside the month (rented containers only) + shipping / customs-port /
//    handling of movements dispatched in that month.
//  * Billable person-days = Σ over VERIFIED daily logs of
//    max(POB on the chosen basis, minimum billable POB). Unverified
//    (draft / submitted / rejected) days never bill.
//  * Billing models: per-person-day (rate × person-days, or per-meal
//    rates × meal counts when those are set), fixed monthly fee, lump sum
//    (in its billing month), cost-plus (all costs × (1 + markup)),
//    management fee (all costs passed through + monthly fee), mixed
//    (person-day/meal component + fixed fee + management fee, whichever
//    are set). Approved additional services are added and approved
//    deductions subtracted to give the proposed invoice value.

export const COST_CATEGORIES: { value: string; label: string }[] = [
  { value: "travel", label: "Travel" },
  { value: "visa_medical", label: "Visa & medical" },
  { value: "provision", label: "Provisions" },
  { value: "equipment", label: "Equipment" },
  { value: "other_mobilization", label: "Other mobilization" },
  { value: "other", label: "Other" },
];

export const BILLING_MODELS: { value: string; label: string }[] = [
  { value: "per_person_day", label: "Per person per day" },
  { value: "fixed_monthly", label: "Fixed monthly fee" },
  { value: "lump_sum", label: "Lump sum" },
  { value: "cost_plus", label: "Actual cost plus markup" },
  { value: "management_fee", label: "Management fee" },
  { value: "mixed", label: "Mixed model" },
];

export const PERIOD_STATUS_LABELS: Record<string, string> = {
  open: "Open",
  closed: "Closed (awaiting commercial approval)",
  commercially_approved: "Commercially approved",
  billing_ready: "Billing-ready",
};

export const LOG_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  verified: "Verified",
  rejected: "Rejected",
};

const DAY_MS = 86400000;

export function monthBounds(month: string) {
  // month = "YYYY-MM" or "YYYY-MM-01"
  const [y, m] = month.slice(0, 7).split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), days: end.getUTCDate(), key: start.toISOString().slice(0, 10) };
}
export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.slice(0, 7).split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}
function daysInclusive(a: string, b: string) {
  if (b < a) return 0;
  return Math.round((new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) / DAY_MS) + 1;
}
function overlapDays(startA: string, endA: string, startB: string, endB: string) {
  const s = startA > startB ? startA : startB;
  const e = endA < endB ? endA : endB;
  return daysInclusive(s, e);
}

/* ================= Crew cost ================= */

export type AssignmentCostInput = {
  id: string;
  crew_id: string;
  crew_name: string;
  role_name: string | null;
  site_name: string | null;
  start_date: string;
  end_date: string | null;
  actual_start_date: string | null;
  actual_end_date: string | null;
  day_rate: number | null;
  currency: string | null;
};
export type CrewCostRow = { assignmentId: string; crewId: string; crewName: string; roleName: string | null; siteName: string | null; days: number; dayRate: number | null; cost: number; missingRate: boolean };

export function crewCostForMonth(assignments: AssignmentCostInput[], month: string, today: string): { rows: CrewCostRow[]; total: number; personDays: number; missingRates: number } {
  const { start, end } = monthBounds(month);
  const cap = today < end ? today : end;
  const rows: CrewCostRow[] = [];
  for (const a of assignments) {
    const s = a.actual_start_date ?? a.start_date;
    const e = a.actual_end_date ?? a.end_date ?? cap;
    const days = overlapDays(s, e, start, cap);
    if (days <= 0) continue;
    const rate = a.day_rate != null ? Number(a.day_rate) : null;
    rows.push({
      assignmentId: a.id,
      crewId: a.crew_id,
      crewName: a.crew_name,
      roleName: a.role_name,
      siteName: a.site_name,
      days,
      dayRate: rate,
      cost: rate != null ? days * rate : 0,
      missingRate: rate == null,
    });
  }
  rows.sort((x, y) => y.cost - x.cost);
  return {
    rows,
    total: rows.reduce((n, r) => n + r.cost, 0),
    personDays: rows.reduce((n, r) => n + r.days, 0),
    missingRates: rows.filter((r) => r.missingRate).length,
  };
}

/* ================= Container cost ================= */

export type ContainerCostInput = {
  id: string;
  container_code: string;
  ownership: string;
  rental_rate: number | null;
  rate_basis: string | null;
};
export type MovementCostInput = {
  id: string;
  container_id: string;
  status: string;
  dispatch_date: string | null;
  return_date: string | null;
  created_at: string;
  shipping_cost: number | null;
  customs_port_cost: number | null;
  handling_cost: number | null;
};
export type ContainerCostRow = { movementId: string; containerCode: string; daysInMonth: number; rental: number; oneOff: number; total: number };

export function containerCostForMonth(containers: ContainerCostInput[], movements: MovementCostInput[], month: string, today: string): { rows: ContainerCostRow[]; total: number } {
  const { start, end } = monthBounds(month);
  const byId = new Map(containers.map((c) => [c.id, c]));
  const rows: ContainerCostRow[] = [];
  for (const m of movements) {
    if (m.status === "cancelled") continue;
    const c = byId.get(m.container_id);
    if (!c) continue;
    let daysInMonth = 0;
    let rental = 0;
    if (m.dispatch_date) {
      const e = m.return_date ?? (today < end ? today : end);
      daysInMonth = overlapDays(m.dispatch_date, e, start, end);
      if (c.ownership === "rented" && c.rental_rate && daysInMonth > 0) {
        const rate = Number(c.rental_rate);
        rental = c.rate_basis === "weekly" ? (daysInMonth / 7) * rate : c.rate_basis === "monthly" ? (daysInMonth / 30) * rate : daysInMonth * rate;
      }
    }
    const attributionDate = (m.dispatch_date ?? m.created_at.slice(0, 10));
    const oneOff = attributionDate >= start && attributionDate <= end ? Number(m.shipping_cost ?? 0) + Number(m.customs_port_cost ?? 0) + Number(m.handling_cost ?? 0) : 0;
    if (daysInMonth === 0 && oneOff === 0) continue;
    rows.push({ movementId: m.id, containerCode: c.container_code, daysInMonth, rental, oneOff, total: rental + oneOff });
  }
  return { rows, total: rows.reduce((n, r) => n + r.total, 0) };
}

/* ================= Daily log aggregation ================= */

export type DailyLogInput = {
  id: string;
  entry_date: string;
  offshore_site_id: string;
  status: string;
  client_pob: number;
  crew_pob: number;
  breakfast_count: number;
  lunch_count: number;
  dinner_count: number;
  night_meal_count: number;
  special_meals: number;
  packed_meals: number;
  att_overtime_hours: number;
  client_complaints: number;
  non_conformities: number;
  service_interruptions: string | null;
  catering_delivered: boolean;
  housekeeping_completed: boolean;
};

export type LogTotals = {
  verifiedDays: number;
  unverifiedDays: number;
  clientPersonDays: number;
  crewPersonDays: number;
  totalPersonDays: number;
  breakfasts: number;
  lunches: number;
  dinners: number;
  nightMeals: number;
  specialMeals: number;
  packedMeals: number;
  overtimeHours: number;
  complaints: number;
  nonConformities: number;
  interruptions: number;
  cateringMissed: number;
  housekeepingMissed: number;
};

export function totalsFromLogs(logs: DailyLogInput[]): LogTotals {
  const t: LogTotals = { verifiedDays: 0, unverifiedDays: 0, clientPersonDays: 0, crewPersonDays: 0, totalPersonDays: 0, breakfasts: 0, lunches: 0, dinners: 0, nightMeals: 0, specialMeals: 0, packedMeals: 0, overtimeHours: 0, complaints: 0, nonConformities: 0, interruptions: 0, cateringMissed: 0, housekeepingMissed: 0 };
  for (const l of logs) {
    if (l.status !== "verified") {
      t.unverifiedDays += 1;
      continue;
    }
    t.verifiedDays += 1;
    t.clientPersonDays += l.client_pob;
    t.crewPersonDays += l.crew_pob;
    t.totalPersonDays += l.client_pob + l.crew_pob;
    t.breakfasts += l.breakfast_count;
    t.lunches += l.lunch_count;
    t.dinners += l.dinner_count;
    t.nightMeals += l.night_meal_count;
    t.specialMeals += l.special_meals;
    t.packedMeals += l.packed_meals;
    t.overtimeHours += Number(l.att_overtime_hours ?? 0);
    t.complaints += l.client_complaints;
    t.nonConformities += l.non_conformities;
    if (l.service_interruptions) t.interruptions += 1;
    if (!l.catering_delivered) t.cateringMissed += 1;
    if (!l.housekeeping_completed) t.housekeepingMissed += 1;
  }
  return t;
}

/* ================= Billing ================= */

export type BillingTerms = {
  billing_model: string;
  currency: string;
  pob_basis: string;
  minimum_billable_pob: number | null;
  rate_per_person_day: number | null;
  rate_breakfast: number | null;
  rate_lunch: number | null;
  rate_dinner: number | null;
  rate_night_meal: number | null;
  rate_special_meal: number | null;
  rate_packed_meal: number | null;
  fixed_monthly_fee: number | null;
  lump_sum_amount: number | null;
  lump_sum_billing_month: string | null;
  markup_pct: number | null;
  management_fee_monthly: number | null;
  monthly_budget_cost: number | null;
  monthly_budget_revenue: number | null;
  notes?: string | null;
};

export type CostBreakdown = {
  crew: number;
  travel: number;
  visaMedical: number;
  provision: number;
  container: number;
  equipment: number;
  otherMobilization: number;
  other: number;
  total: number;
};

export function costBreakdown(crewTotal: number, containerTotal: number, entries: { category: string; amount: number }[]): CostBreakdown {
  const sum = (cat: string) => entries.filter((e) => e.category === cat).reduce((n, e) => n + Number(e.amount), 0);
  const b: CostBreakdown = {
    crew: crewTotal,
    travel: sum("travel"),
    visaMedical: sum("visa_medical"),
    provision: sum("provision"),
    container: containerTotal,
    equipment: sum("equipment"),
    otherMobilization: sum("other_mobilization"),
    other: sum("other"),
    total: 0,
  };
  b.total = b.crew + b.travel + b.visaMedical + b.provision + b.container + b.equipment + b.otherMobilization + b.other;
  return b;
}

export type BillingLine = { label: string; quantity: number | null; unit: string | null; rate: number | null; amount: number };
export type BillingSummary = {
  model: string;
  currency: string;
  billablePersonDays: number;
  billableServiceDays: number;
  lines: BillingLine[];
  baseRevenue: number;
  additionalServices: number;
  deductions: number;
  proposedInvoice: number;
  warnings: string[];
};

function n(x: number | null | undefined) {
  return x == null ? 0 : Number(x);
}

export function billingSummary(terms: BillingTerms | null, logs: DailyLogInput[], costs: CostBreakdown, adjustments: { kind: string; status: string; amount: number }[], month: string): BillingSummary {
  const totals = totalsFromLogs(logs);
  const warnings: string[] = [];
  if (!terms) warnings.push("No billing terms configured for this project's contract — base revenue is 0.");
  if (totals.unverifiedDays > 0) warnings.push(`${totals.unverifiedDays} daily log(s) are not verified and are excluded from billing.`);

  const verified = logs.filter((l) => l.status === "verified");
  const minPob = n(terms?.minimum_billable_pob);
  const billablePersonDays = verified.reduce((acc, l) => {
    const pob = terms?.pob_basis === "total_pob" ? l.client_pob + l.crew_pob : l.client_pob;
    return acc + Math.max(pob, minPob);
  }, 0);
  const billableServiceDays = verified.length;

  const lines: BillingLine[] = [];
  const cur = terms?.currency ?? "USD";
  const model = terms?.billing_model ?? "per_person_day";

  const personDayComponent = () => {
    const hasMealRates = [terms?.rate_breakfast, terms?.rate_lunch, terms?.rate_dinner, terms?.rate_night_meal].some((r) => r != null);
    if (hasMealRates) {
      const mealLine = (label: string, qty: number, rate: number | null | undefined) => {
        if (rate == null) return;
        lines.push({ label, quantity: qty, unit: "meals", rate: n(rate), amount: qty * n(rate) });
      };
      mealLine("Breakfasts", totals.breakfasts, terms?.rate_breakfast);
      mealLine("Lunches", totals.lunches, terms?.rate_lunch);
      mealLine("Dinners", totals.dinners, terms?.rate_dinner);
      mealLine("Night meals", totals.nightMeals, terms?.rate_night_meal);
      mealLine("Special meals", totals.specialMeals, terms?.rate_special_meal);
      mealLine("Packed meals", totals.packedMeals, terms?.rate_packed_meal);
    } else {
      const rate = n(terms?.rate_per_person_day);
      if (terms && !rate) warnings.push("Rate per person per day is not set.");
      lines.push({ label: `Billable person-days (${terms?.pob_basis === "total_pob" ? "client + crew POB" : "client POB"}${minPob ? `, min ${minPob}` : ""})`, quantity: billablePersonDays, unit: "person-days", rate, amount: billablePersonDays * rate });
      const extra = (label: string, qty: number, rate: number | null | undefined) => {
        if (rate == null || !qty) return;
        lines.push({ label, quantity: qty, unit: "meals", rate: n(rate), amount: qty * n(rate) });
      };
      extra("Special meals", totals.specialMeals, terms?.rate_special_meal);
      extra("Packed meals", totals.packedMeals, terms?.rate_packed_meal);
    }
  };
  const fixedComponent = () => {
    if (terms?.fixed_monthly_fee != null) lines.push({ label: "Fixed monthly fee", quantity: 1, unit: "month", rate: n(terms.fixed_monthly_fee), amount: n(terms.fixed_monthly_fee) });
  };
  const managementComponent = () => {
    if (terms?.management_fee_monthly != null) lines.push({ label: "Management fee", quantity: 1, unit: "month", rate: n(terms.management_fee_monthly), amount: n(terms.management_fee_monthly) });
  };
  const passThrough = () => {
    lines.push({ label: "Actual costs (pass-through)", quantity: null, unit: null, rate: null, amount: costs.total });
  };

  switch (model) {
    case "per_person_day":
      personDayComponent();
      break;
    case "fixed_monthly":
      fixedComponent();
      if (terms && terms.fixed_monthly_fee == null) warnings.push("Fixed monthly fee is not set.");
      break;
    case "lump_sum": {
      const billMonth = terms?.lump_sum_billing_month?.slice(0, 7);
      if (terms?.lump_sum_amount != null && billMonth === month.slice(0, 7)) {
        lines.push({ label: "Lump sum", quantity: 1, unit: "contract", rate: n(terms.lump_sum_amount), amount: n(terms.lump_sum_amount) });
      } else if (terms) {
        warnings.push(billMonth ? `Lump sum is billed in ${billMonth}; nothing falls in this month.` : "Lump sum billing month is not set.");
      }
      break;
    }
    case "cost_plus": {
      passThrough();
      const markup = n(terms?.markup_pct);
      lines.push({ label: `Markup ${markup}%`, quantity: null, unit: null, rate: null, amount: (costs.total * markup) / 100 });
      if (terms && terms.markup_pct == null) warnings.push("Markup % is not set.");
      break;
    }
    case "management_fee":
      passThrough();
      managementComponent();
      if (terms && terms.management_fee_monthly == null) warnings.push("Management fee is not set.");
      break;
    case "mixed":
      if (terms?.rate_per_person_day != null || terms?.rate_breakfast != null || terms?.rate_lunch != null || terms?.rate_dinner != null) personDayComponent();
      fixedComponent();
      managementComponent();
      if (terms?.markup_pct != null) {
        passThrough();
        lines.push({ label: `Markup ${n(terms.markup_pct)}%`, quantity: null, unit: null, rate: null, amount: (costs.total * n(terms.markup_pct)) / 100 });
      }
      break;
  }

  const baseRevenue = lines.reduce((s, l) => s + l.amount, 0);
  const additionalServices = adjustments.filter((a) => a.kind === "additional_service" && a.status === "approved").reduce((s, a) => s + Number(a.amount), 0);
  const deductions = adjustments.filter((a) => a.kind === "deduction" && a.status === "approved").reduce((s, a) => s + Number(a.amount), 0);
  const pending = adjustments.filter((a) => a.status === "proposed").length;
  if (pending) warnings.push(`${pending} billing adjustment(s) still proposed — decide them before commercial approval.`);

  return {
    model,
    currency: cur,
    billablePersonDays,
    billableServiceDays,
    lines,
    baseRevenue,
    additionalServices,
    deductions,
    proposedInvoice: baseRevenue + additionalServices - deductions,
    warnings,
  };
}

/* ================= Profitability ================= */

export type Profitability = {
  revenue: number;
  crewCost: number;
  provisionCost: number;
  logisticsCost: number;
  otherDirectCost: number;
  totalCost: number;
  grossMargin: number;
  marginPct: number | null;
  budgetCost: number | null;
  budgetRevenue: number | null;
  costVariance: number | null;
  revenueVariance: number | null;
  personDays: number;
  costPerPersonDay: number | null;
  revenuePerPersonDay: number | null;
};

export function profitability(billing: BillingSummary, costs: CostBreakdown, terms: BillingTerms | null, totals: LogTotals): Profitability {
  const revenue = billing.proposedInvoice;
  const logisticsCost = costs.container + costs.travel + costs.otherMobilization;
  const otherDirectCost = costs.visaMedical + costs.equipment + costs.other;
  const grossMargin = revenue - costs.total;
  const personDays = totals.totalPersonDays;
  return {
    revenue,
    crewCost: costs.crew,
    provisionCost: costs.provision,
    logisticsCost,
    otherDirectCost,
    totalCost: costs.total,
    grossMargin,
    marginPct: revenue > 0 ? (grossMargin / revenue) * 100 : null,
    budgetCost: terms?.monthly_budget_cost != null ? Number(terms.monthly_budget_cost) : null,
    budgetRevenue: terms?.monthly_budget_revenue != null ? Number(terms.monthly_budget_revenue) : null,
    costVariance: terms?.monthly_budget_cost != null ? costs.total - Number(terms.monthly_budget_cost) : null,
    revenueVariance: terms?.monthly_budget_revenue != null ? revenue - Number(terms.monthly_budget_revenue) : null,
    personDays,
    costPerPersonDay: personDays > 0 ? costs.total / personDays : null,
    revenuePerPersonDay: personDays > 0 ? revenue / personDays : null,
  };
}

export function fmtMoney(x: number | null | undefined, currency?: string | null) {
  if (x == null) return "—";
  const v = Math.round(x * 100) / 100;
  return `${currency ? currency + " " : ""}${v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/* ================= Export ================= */

function csvCell(v: unknown) {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function billingExportCsv(args: {
  projectLabel: string;
  contractLabel: string;
  siteLabels: Record<string, string>;
  month: string;
  periodStatus: string;
  billing: BillingSummary;
  costs: CostBreakdown;
  logs: DailyLogInput[];
  adjustments: { kind: string; status: string; amount: number; description: string; reference: string | null }[];
}): string {
  const rows: unknown[][] = [];
  rows.push(["ComplianceHub billing summary"]);
  rows.push(["Project", args.projectLabel]);
  rows.push(["Contract", args.contractLabel]);
  rows.push(["Period", args.month.slice(0, 7)]);
  rows.push(["Period status", args.periodStatus]);
  rows.push(["Billing model", args.billing.model]);
  rows.push(["Currency", args.billing.currency]);
  rows.push([]);
  rows.push(["Line", "Quantity", "Unit", "Rate", "Amount"]);
  for (const l of args.billing.lines) rows.push([l.label, l.quantity, l.unit, l.rate, l.amount.toFixed(2)]);
  rows.push(["Base revenue", "", "", "", args.billing.baseRevenue.toFixed(2)]);
  rows.push(["Additional approved services", "", "", "", args.billing.additionalServices.toFixed(2)]);
  rows.push(["Deductions / service failures", "", "", "", (-args.billing.deductions).toFixed(2)]);
  rows.push(["Proposed invoice value", "", "", "", args.billing.proposedInvoice.toFixed(2)]);
  rows.push([]);
  rows.push(["Adjustments", "Kind", "Status", "Reference", "Amount"]);
  for (const a of args.adjustments) rows.push([a.description, a.kind, a.status, a.reference ?? "", Number(a.amount).toFixed(2)]);
  rows.push([]);
  rows.push(["Cost summary", "Amount"]);
  rows.push(["Crew", args.costs.crew.toFixed(2)]);
  rows.push(["Travel", args.costs.travel.toFixed(2)]);
  rows.push(["Visa & medical", args.costs.visaMedical.toFixed(2)]);
  rows.push(["Provisions", args.costs.provision.toFixed(2)]);
  rows.push(["Containers", args.costs.container.toFixed(2)]);
  rows.push(["Equipment", args.costs.equipment.toFixed(2)]);
  rows.push(["Other mobilization", args.costs.otherMobilization.toFixed(2)]);
  rows.push(["Other", args.costs.other.toFixed(2)]);
  rows.push(["Total cost", args.costs.total.toFixed(2)]);
  rows.push([]);
  rows.push(["Supporting daily records"]);
  rows.push(["Date", "Vessel/site", "Status", "Client POB", "Crew POB", "Breakfast", "Lunch", "Dinner", "Night", "Special", "Packed", "Complaints", "Non-conformities"]);
  for (const l of [...args.logs].sort((a, b) => a.entry_date.localeCompare(b.entry_date))) {
    rows.push([l.entry_date, args.siteLabels[l.offshore_site_id] ?? l.offshore_site_id, l.status, l.client_pob, l.crew_pob, l.breakfast_count, l.lunch_count, l.dinner_count, l.night_meal_count, l.special_meals, l.packed_meals, l.client_complaints, l.non_conformities]);
  }
  return rows.map((r) => r.map(csvCell).join(",")).join("\n");
}
