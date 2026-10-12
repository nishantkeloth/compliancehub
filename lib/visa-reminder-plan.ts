// Visa reminders — the pure half. Given each person's visas as of today, decide
// which ones need a reminder right now. No database or email in here, so it can
// be tested on its own; lib/visa-reminders.ts does the loading and sending.
//
// Two kinds of item:
//   "action"  the visa has lapsed (expired, entry deadline passed, stay ended).
//             Listed every day until it is fixed.
//   "step"    a reminder step from the visa type has been reached (for example 30
//             days before expiry). Sent once; if a run was missed, the most urgent
//             step reached is sent and the earlier ones are marked as done.

import { assessVisa, type VisaAssessInput, type VisaState } from "./visa";

export type VisaInput = VisaAssessInput & {
  docId: string;
  crewId: string;
  crewName: string;
  typeName: string | null;
  country: string | null;
};

export type ReminderItem = {
  docId: string;
  crewId: string;
  crewName: string;
  visaName: string;
  kind: "action" | "step";
  /** Which clock the item counts: expiry, stay end or entry deadline. */
  clock: "expiry" | "stay" | "entry";
  /** The step reached (days before), or 0 for an action item. */
  stepDays: number;
  /** The date being counted down to (or that has passed). */
  targetDate: string;
  /** Days until targetDate; negative once it has passed. */
  daysLeft: number;
  state: VisaState;
  /** Plain-language reason, e.g. "Visa expired" or "30-day reminder". */
  reason: string;
};

const PAST: ReadonlySet<string> = new Set(["expired", "entry_missed", "stay_ended", "cancelled"]);
const LAPSED: ReadonlySet<string> = new Set(["expired", "entry_missed", "stay_ended"]);

type Assessed = { input: VisaInput; a: ReturnType<typeof assessVisa> };

/** The one visa that counts for a person: the newest live one, else the one that ended last. */
export function pickCurrentVisa(list: Assessed[]): Assessed | null {
  if (list.length === 0) return null;
  const live = list.filter((x) => !PAST.has(x.a.state));
  if (live.length) {
    return [...live].sort((x, y) => (y.input.issueDate ?? "9999").localeCompare(x.input.issueDate ?? "9999"))[0];
  }
  const key = (x: Assessed) => x.a.entryDeadline ?? x.input.expiryDate ?? x.a.stayUntil ?? x.input.issueDate ?? "";
  return [...list].sort((x, y) => key(y).localeCompare(key(x)))[0];
}

function stepsReached(days: number, steps: number[]): number[] {
  return steps.filter((d) => days >= 0 && days <= d).sort((x, y) => x - y);
}

export function planVisaReminders(visas: VisaInput[], today: string): { items: ReminderItem[]; reachedSteps: Map<string, number[]> } {
  const byCrew = new Map<string, Assessed[]>();
  for (const v of visas) {
    const a = assessVisa(v, today);
    const list = byCrew.get(v.crewId);
    if (list) list.push({ input: v, a });
    else byCrew.set(v.crewId, [{ input: v, a }]);
  }

  const items: ReminderItem[] = [];
  // Every step already reached for a visa, keyed "docId|clock", so the caller can mark
  // the earlier ones as done when it sends the most urgent one.
  const reachedSteps = new Map<string, number[]>();

  for (const list of byCrew.values()) {
    const pick = pickCurrentVisa(list);
    if (!pick) continue;
    const { input: v, a } = pick;
    const base = { docId: v.docId, crewId: v.crewId, crewName: v.crewName, visaName: [v.country, v.typeName].filter(Boolean).join(" ") || "Visa", state: a.state };

    if (LAPSED.has(a.state)) {
      let clock: ReminderItem["clock"] = "expiry";
      let target = v.expiryDate;
      let days = a.daysToExpiry;
      let reason = "Visa expired";
      if (a.state === "entry_missed") {
        clock = "entry";
        target = a.entryDeadline;
        days = a.daysToEntryDeadline;
        reason = "Entry deadline passed";
      } else if (a.state === "stay_ended") {
        clock = "stay";
        target = a.stayUntil;
        days = a.daysToStayEnd;
        reason = "Permitted stay ended";
      }
      if (target && days != null) items.push({ ...base, kind: "action", clock, stepDays: 0, targetDate: target, daysLeft: days, reason });
      continue;
    }
    if (a.state === "cancelled" || a.state === "pending" || a.state === "unknown") continue;

    const entered = !!v.entryDate || v.status === "entered";
    let clock: ReminderItem["clock"];
    let target: string | null;
    let days: number | null;
    let steps: number[];
    if (entered && v.rule?.stay_basis === "days_from_entry") {
      clock = "stay";
      target = a.stayUntil;
      days = a.daysToStayEnd;
      steps = v.expiryReminderDays;
    } else if (!entered && a.entryDeadline) {
      clock = "entry";
      target = a.entryDeadline;
      days = a.daysToEntryDeadline;
      steps = v.entryReminderDays;
    } else {
      clock = "expiry";
      target = v.expiryDate;
      days = a.daysToExpiry;
      steps = v.expiryReminderDays;
    }
    if (!target || days == null) continue;

    const reached = stepsReached(days, steps);
    if (reached.length === 0) continue;
    reachedSteps.set(`${v.docId}|${clock}`, reached);
    const step = reached[0];
    const what = clock === "entry" ? "entry deadline" : clock === "stay" ? "stay ending" : "expiry";
    items.push({ ...base, kind: "step", clock, stepDays: step, targetDate: target, daysLeft: days, reason: `${step}-day reminder (${what})` });
  }

  return { items, reachedSteps };
}
