// Builds the cards for the Visas tab on a crew profile: each visa with its
// state, calculated dates, planned-arrival check, next reminder and a merged
// history (logged changes + uploaded file versions). Pure — the page fetches
// the rows and passes them in.

import {
  assessVisa,
  arrivalWarnings,
  nextReminder,
  daysBetween,
  addDaysISO,
  VISA_STATUS_LABEL,
  type VisaTypeRule,
  type VisaSeverity,
  type VisaState,
  type NextReminder,
} from "@/lib/visa";

export type CardDoc = {
  id: string;
  document_type_id: string;
  document_number: string | null;
  sponsor: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  entry_date: string | null;
  extension_date: string | null;
  notes: string | null;
  visa_country: string | null;
  visa_type_id: string | null;
  visa_application_date: string | null;
  visa_status: string | null;
};
export type CardType = {
  id: string;
  country: string;
  name: string;
  mobilization_code: string | null;
  entry_valid_days: number | null;
  stay_basis: "until_expiry" | "days_from_entry";
  stay_days: number | null;
  entry_type: "single" | "multiple" | null;
  expiry_reminder_days: number[];
  entry_reminder_days: number[];
};
export type CardVersion = {
  id: string;
  crew_document_id: string;
  version_number: number;
  document_number: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  created_at: string;
  uploaded_by: string | null;
};
export type CardEvent = { crew_document_id: string; summary: string; created_by: string | null; created_at: string };
export type PlannedArrival = { date: string; positionVisaCode: string | null; label: string };

export type HistoryItem = { at: string; text: string; by: string | null; kind: "event" | "file" };

export type VisaCard = {
  id: string;
  title: string; // "United Arab Emirates · Mission visa"
  documentTypeName: string;
  documentNumber: string | null;
  sponsor: string | null;
  recordedStatus: string | null;
  applicationDate: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  entryDate: string | null;
  extensionDate: string | null;
  state: VisaState;
  severity: VisaSeverity;
  label: string;
  active: boolean;
  /** Short note under the outcome for a past visa. */
  outcomeNote: string | null;
  /** When a past visa ended (expiry, missed entry deadline or end of stay). */
  endedOn: string | null;
  // Key figures for the card's calculation strip.
  mode: "enter_by" | "stay" | "validity" | "none";
  keyDate: string | null;
  keyDays: number | null;
  /** 0–100: how much of the window is left. */
  keyPercent: number | null;
  entryType: "single" | "multiple" | null;
  stayText: string | null;
  planned: { date: string; label: string; ok: boolean; messages: string[] } | null;
  nextReminder: (NextReminder & { text: string }) | null;
  latestVersionId: string | null;
  history: HistoryItem[];
};

function niceDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.slice(0, 10) + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}
function clampPct(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function buildVisaCards(input: {
  docs: CardDoc[];
  docTypeName: Record<string, string>;
  types: CardType[];
  versions: CardVersion[];
  events: CardEvent[];
  planned: PlannedArrival | null;
  nameById: Record<string, string>;
  today: string;
}): VisaCard[] {
  const typeById = new Map(input.types.map((t) => [t.id, t]));
  const cards: VisaCard[] = [];

  for (const d of input.docs) {
    const t = d.visa_type_id ? typeById.get(d.visa_type_id) ?? null : null;
    const rule: VisaTypeRule | null = t
      ? { entry_valid_days: t.entry_valid_days, stay_basis: t.stay_basis, stay_days: t.stay_days, entry_type: t.entry_type }
      : null;
    const a = assessVisa(
      {
        status: d.visa_status,
        issueDate: d.issue_date,
        expiryDate: d.expiry_date,
        entryDate: d.entry_date,
        rule,
        expiryReminderDays: t?.expiry_reminder_days ?? [],
        entryReminderDays: t?.entry_reminder_days ?? [],
      },
      input.today
    );
    const entered = !!d.entry_date || d.visa_status === "entered";
    const past = a.state === "expired" || a.state === "entry_missed" || a.state === "stay_ended" || a.state === "cancelled";

    // Calculation strip: which window matters right now.
    let mode: VisaCard["mode"] = "none";
    let keyDate: string | null = null;
    let keyDays: number | null = null;
    let keyPercent: number | null = null;
    if (!entered && a.entryDeadline && a.daysToEntryDeadline != null) {
      mode = "enter_by";
      keyDate = a.entryDeadline;
      keyDays = a.daysToEntryDeadline;
      const total = t?.entry_valid_days ?? null;
      keyPercent = total ? clampPct((a.daysToEntryDeadline / total) * 100) : null;
    } else if (entered && rule?.stay_basis === "days_from_entry" && a.stayUntil && a.daysToStayEnd != null) {
      mode = "stay";
      keyDate = a.stayUntil;
      keyDays = a.daysToStayEnd;
      keyPercent = rule.stay_days ? clampPct((a.daysToStayEnd / rule.stay_days) * 100) : null;
    } else if (d.expiry_date && a.daysToExpiry != null) {
      mode = "validity";
      keyDate = d.expiry_date;
      keyDays = a.daysToExpiry;
      const span = d.issue_date ? daysBetween(d.issue_date, d.expiry_date) : null;
      keyPercent = span && span > 0 ? clampPct((a.daysToExpiry / span) * 100) : null;
    }

    // "Then may stay until": a fixed date, or the rule plus an example.
    let stayText: string | null = null;
    if (rule) {
      if (rule.stay_basis === "until_expiry") stayText = d.expiry_date ? `until the visa expires (${niceDate(d.expiry_date)})` : null;
      else if (rule.stay_days != null) {
        if (entered && a.stayUntil) stayText = niceDate(a.stayUntil);
        else if (input.planned && !past) {
          const eg = addDaysISO(input.planned.date, rule.stay_days);
          stayText = `${rule.stay_days} days after entry` + (eg ? ` (${niceDate(eg)} if entry is on ${niceDate(input.planned.date)})` : "");
        } else stayText = `${rule.stay_days} days after entry`;
      }
    }

    // Planned arrival check — only while the person has not entered yet.
    let planned: VisaCard["planned"] = null;
    if (input.planned && !entered && !past) {
      const msgs = arrivalWarnings({
        plannedArrival: input.planned.date,
        positionVisaCode: input.planned.positionVisaCode,
        visa: {
          status: d.visa_status,
          issueDate: d.issue_date,
          expiryDate: d.expiry_date,
          entryDate: d.entry_date,
          typeName: t?.name ?? null,
          typeMobilizationCode: t?.mobilization_code ?? null,
          rule,
        },
      });
      planned = { date: input.planned.date, label: input.planned.label, ok: msgs.length === 0, messages: msgs };
    }

    const nr = nextReminder(
      {
        expiryDate: d.expiry_date,
        entryDeadline: a.entryDeadline,
        entered,
        cancelled: d.visa_status === "cancelled",
        expiryReminderDays: t?.expiry_reminder_days ?? [],
        entryReminderDays: t?.entry_reminder_days ?? [],
      },
      input.today
    );

    // Why a past visa is past, and when it ended.
    let outcomeNote: string | null = null;
    let endedOn: string | null = null;
    if (a.state === "expired") {
      endedOn = d.expiry_date;
      outcomeNote = d.expiry_date ? `Expired on ${niceDate(d.expiry_date)}` : null;
    } else if (a.state === "entry_missed") {
      endedOn = a.entryDeadline;
      outcomeNote = "Never used — the entry deadline passed";
    } else if (a.state === "stay_ended") {
      endedOn = a.stayUntil;
      outcomeNote = "Permitted stay ended";
    } else if (a.state === "cancelled") {
      outcomeNote = d.notes ? d.notes : null;
    }

    const versions = input.versions.filter((v) => v.crew_document_id === d.id).sort((x, y) => y.version_number - x.version_number);
    const history: HistoryItem[] = [
      ...input.events
        .filter((e) => e.crew_document_id === d.id)
        .map((e) => ({ at: e.created_at, text: e.summary, by: e.created_by ? input.nameById[e.created_by] ?? null : null, kind: "event" as const })),
      ...versions.map((v) => ({
        at: v.created_at,
        text:
          `Visa file uploaded — version ${v.version_number}` +
          (v.issue_date || v.expiry_date ? ` (${[v.issue_date ? `issue ${niceDate(v.issue_date)}` : null, v.expiry_date ? `expiry ${niceDate(v.expiry_date)}` : null].filter(Boolean).join(", ")})` : ""),
        by: v.uploaded_by ? input.nameById[v.uploaded_by] ?? null : null,
        kind: "file" as const,
      })),
    ].sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));

    cards.push({
      id: d.id,
      title: [d.visa_country ?? t?.country, t?.name].filter(Boolean).join(" · ") || input.docTypeName[d.document_type_id] || "Visa",
      documentTypeName: input.docTypeName[d.document_type_id] ?? "Visa",
      documentNumber: d.document_number,
      sponsor: d.sponsor,
      recordedStatus: d.visa_status ? VISA_STATUS_LABEL[d.visa_status] ?? d.visa_status : null,
      applicationDate: d.visa_application_date,
      issueDate: d.issue_date,
      expiryDate: d.expiry_date,
      entryDate: d.entry_date,
      extensionDate: d.extension_date,
      state: a.state,
      severity: a.severity,
      label: a.label,
      active: !past,
      outcomeNote,
      endedOn,
      mode,
      keyDate,
      keyDays,
      keyPercent,
      entryType: t?.entry_type ?? null,
      stayText,
      planned,
      nextReminder: nr
        ? { ...nr, text: `${nr.daysBefore} days before ${nr.kind === "expiry" ? "expiry" : "the entry deadline"}` }
        : null,
      latestVersionId: versions[0]?.id ?? null,
      history,
    });
  }

  // Newest first: by issue date, then by when it was recorded (input order is newest-first).
  const order = new Map(input.docs.map((d, i) => [d.id, i]));
  cards.sort((x, y) => {
    const ix = x.issueDate ?? "";
    const iy = y.issueDate ?? "";
    if (ix !== iy) return ix < iy ? 1 : -1;
    return (order.get(x.id) ?? 0) - (order.get(y.id) ?? 0);
  });
  return cards;
}
