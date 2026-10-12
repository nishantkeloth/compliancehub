// Visa dates — the pure half. Given the rules of a visa type and the dates on
// a visa, work out the two dates people ask about: the latest day the person
// can enter the country, and how long they may stay once they have.
//
// All dates are ISO "YYYY-MM-DD" strings and are handled in UTC so a time
// zone can never shift a day.

export const VISA_STATUSES = [
  { value: "applied", label: "Applied" },
  { value: "approved", label: "Approved" },
  { value: "awaiting_entry", label: "Awaiting entry" },
  { value: "entered", label: "Entered" },
  { value: "cancelled", label: "Cancelled" },
] as const;
export type VisaStatus = (typeof VISA_STATUSES)[number]["value"];

export const VISA_STATUS_LABEL: Record<string, string> = Object.fromEntries(VISA_STATUSES.map((s) => [s.value, s.label]));

export type VisaTypeRule = {
  entry_valid_days: number | null;
  stay_basis: "until_expiry" | "days_from_entry";
  stay_days: number | null;
  entry_type: "single" | "multiple" | null;
};

export type VisaDates = {
  /** Last day the person can enter on this visa, or null when it cannot be worked out. */
  entryDeadline: string | null;
  /** Last day the person may stay, or null when it cannot be worked out. */
  stayUntil: string | null;
};

function parse(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(t) ? null : t;
}
function fmt(t: number): string {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function addDaysISO(iso: string, days: number): string | null {
  const t = parse(iso);
  return t == null ? null : fmt(t + days * 86400000);
}

/** Whole days from a to b (positive when b is later). */
export function daysBetween(a: string, b: string): number | null {
  const ta = parse(a);
  const tb = parse(b);
  return ta == null || tb == null ? null : Math.round((tb - ta) / 86400000);
}

export function computeVisaDates(
  rule: VisaTypeRule | null | undefined,
  dates: { issueDate: string | null; expiryDate: string | null; entryDate: string | null }
): VisaDates {
  if (!rule) return { entryDeadline: null, stayUntil: null };

  // Entry deadline: N days after issue, but never later than the visa's own expiry.
  let entryDeadline: string | null = null;
  if (rule.entry_valid_days != null && dates.issueDate) {
    entryDeadline = addDaysISO(dates.issueDate, rule.entry_valid_days);
    if (entryDeadline && dates.expiryDate && parse(dates.expiryDate)! < parse(entryDeadline)!) entryDeadline = dates.expiryDate;
  }

  // Stay: a number of days after the actual entry, or simply until expiry.
  let stayUntil: string | null = null;
  if (rule.stay_basis === "days_from_entry") {
    if (rule.stay_days != null && dates.entryDate) stayUntil = addDaysISO(dates.entryDate, rule.stay_days);
  } else {
    stayUntil = dates.expiryDate || null;
  }
  return { entryDeadline, stayUntil };
}

/** "14, 7, 3" -> [14, 7, 3] (largest first, whole positive numbers only). */
export function parseDayList(text: string): number[] {
  const nums = text
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0 && n <= 3650);
  return Array.from(new Set(nums)).sort((a, b) => b - a);
}
export function formatDayList(days: number[] | null | undefined): string {
  return (days ?? []).join(", ");
}

/* ---------------- Assessing a visa as of today ---------------- */

export type VisaState =
  | "cancelled"
  | "expired"
  | "entry_missed"
  | "stay_ended"
  | "enter_soon"
  | "awaiting_entry"
  | "pending"
  | "expiring"
  | "valid"
  | "unknown";
export type VisaSeverity = "ok" | "warning" | "critical" | "expired" | "none";

export type VisaAssessInput = {
  status: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  entryDate: string | null;
  rule: VisaTypeRule | null;
  expiryReminderDays: number[];
  entryReminderDays: number[];
};

export type VisaAssessment = {
  state: VisaState;
  severity: VisaSeverity;
  /** Short label for a status pill. */
  label: string;
  /** One sentence for people, e.g. "Enter within 12 days (by 04 Dec 2026)". */
  detail: string;
  entryDeadline: string | null;
  stayUntil: string | null;
  daysToEntryDeadline: number | null;
  daysToExpiry: number | null;
  daysToStayEnd: number | null;
};

const CRITICAL_DAYS = 14;

function niceDate(iso: string | null): string {
  if (!iso) return "—";
  const t = parse(iso);
  if (t == null) return iso;
  return new Date(t).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}
function band(days: number, warnWithin: number): VisaSeverity {
  if (days < 0) return "expired";
  if (days <= CRITICAL_DAYS) return "critical";
  if (days <= warnWithin) return "warning";
  return "ok";
}
function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function assessVisa(input: VisaAssessInput, today: string): VisaAssessment {
  const { entryDeadline, stayUntil } = computeVisaDates(input.rule, {
    issueDate: input.issueDate,
    expiryDate: input.expiryDate,
    entryDate: input.entryDate,
  });
  const daysToEntryDeadline = entryDeadline ? daysBetween(today, entryDeadline) : null;
  const daysToExpiry = input.expiryDate ? daysBetween(today, input.expiryDate) : null;
  const daysToStayEnd = stayUntil ? daysBetween(today, stayUntil) : null;
  const base = { entryDeadline, stayUntil, daysToEntryDeadline, daysToExpiry, daysToStayEnd };
  const make = (state: VisaState, severity: VisaSeverity, label: string, detail: string): VisaAssessment => ({ state, severity, label, detail, ...base });

  if (input.status === "cancelled") return make("cancelled", "none", "Cancelled", "This visa has been cancelled.");

  const entered = !!input.entryDate || input.status === "entered";
  const daysBased = input.rule?.stay_basis === "days_from_entry";
  const warnWithin = Math.max(30, ...input.expiryReminderDays);

  // Once inside the country on a visa whose stay is counted from entry, the
  // stay clock — not the visa's own expiry date — is what matters.
  if (entered && daysBased) {
    if (!input.entryDate) return make("unknown", "warning", "Enter the entry date", "Marked as entered, but no entry date is recorded, so the stay cannot be worked out.");
    if (daysToStayEnd == null) return make("unknown", "none", "Stay unknown", "The stay length is not set for this visa type.");
    const sev = band(daysToStayEnd, warnWithin);
    if (sev === "expired") return make("stay_ended", "expired", "Stay ended", `Permitted stay ended ${plural(-daysToStayEnd, "day")} ago (${niceDate(stayUntil)}).`);
    return make(sev === "ok" ? "valid" : "expiring", sev, sev === "ok" ? "Valid" : "Stay ending", `Stay allowed until ${niceDate(stayUntil)} (${plural(daysToStayEnd, "day")} left).`);
  }

  // Not yet entered, with an entry deadline to meet.
  if (!entered && entryDeadline && daysToEntryDeadline != null) {
    if (daysToEntryDeadline < 0) {
      return make("entry_missed", "expired", "Entry deadline passed", `Had to enter by ${niceDate(entryDeadline)} — ${plural(-daysToEntryDeadline, "day")} ago. A new visa is likely needed.`);
    }
    const warnEntry = Math.max(CRITICAL_DAYS, ...input.entryReminderDays);
    const sev = band(daysToEntryDeadline, warnEntry);
    return make(
      sev === "ok" ? "awaiting_entry" : "enter_soon",
      sev,
      sev === "ok" ? "Awaiting entry" : "Enter soon",
      `Must enter by ${niceDate(entryDeadline)} (${plural(daysToEntryDeadline, "day")} left).`
    );
  }

  // Everything else is judged by the visa's own expiry date.
  if (daysToExpiry != null) {
    const sev = band(daysToExpiry, warnWithin);
    if (sev === "expired") return make("expired", "expired", "Expired", `Expired ${plural(-daysToExpiry, "day")} ago (${niceDate(input.expiryDate)}).`);
    return make(sev === "ok" ? "valid" : "expiring", sev, sev === "ok" ? "Valid" : "Expiring", `Valid until ${niceDate(input.expiryDate)} (${plural(daysToExpiry, "day")} left).`);
  }

  if (input.status === "applied") return make("pending", "none", "Applied", "Application made; no issue or expiry dates yet.");
  if (input.status === "approved") return make("pending", "none", "Approved", "Approved; no issue or expiry dates yet.");
  return make("unknown", "none", "No dates", "No expiry date is recorded for this visa.");
}

/* ---------------- Planned arrival against the visa ---------------- */

export type ArrivalCheckInput = {
  plannedArrival: string | null;
  /** The mobilization position's visa choice: mission / resident / seaman / visit. */
  positionVisaCode: string | null;
  visa: {
    status: string | null;
    issueDate: string | null;
    expiryDate: string | null;
    entryDate: string | null;
    typeName: string | null;
    typeMobilizationCode: string | null;
    rule: VisaTypeRule | null;
  } | null;
};

/** Plain-language problems between a person's planned arrival and the visa on their profile. */
export function arrivalWarnings(input: ArrivalCheckInput): string[] {
  const out: string[] = [];
  const v = input.visa;
  if (!v) {
    out.push("No visa is recorded on this person's profile yet.");
    return out;
  }
  if (v.status === "cancelled") out.push("The visa on file is marked cancelled.");

  if (input.positionVisaCode && v.typeMobilizationCode && input.positionVisaCode !== v.typeMobilizationCode) {
    out.push(`This position expects a ${input.positionVisaCode} visa, but the visa on the profile is a ${v.typeName ?? v.typeMobilizationCode} visa.`);
  }

  const arrival = input.plannedArrival;
  if (!arrival) return out;
  const { entryDeadline } = computeVisaDates(v.rule, { issueDate: v.issueDate, expiryDate: v.expiryDate, entryDate: v.entryDate });
  const alreadyEntered = !!v.entryDate || v.status === "entered";
  if (!alreadyEntered && entryDeadline && arrival > entryDeadline) {
    out.push(`Planned arrival (${niceDate(arrival)}) is after the visa's entry deadline (${niceDate(entryDeadline)}).`);
  }
  if (!alreadyEntered && v.expiryDate && arrival > v.expiryDate) {
    out.push(`Planned arrival (${niceDate(arrival)}) is after the visa expires (${niceDate(v.expiryDate)}).`);
  }
  if (v.issueDate && arrival < v.issueDate) {
    out.push(`Planned arrival (${niceDate(arrival)}) is before the visa issue date (${niceDate(v.issueDate)}).`);
  }
  return out;
}
