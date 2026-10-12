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
