// Visa reminders — the loading and sending half. Called once a day from the
// send-reminders cron (a separate cron entry would not fit the Hobby plan's limit).
//
// For every company: work out which visas need a reminder (planVisaReminders),
// email one digest to the notification recipients, add bell items for people who
// manage crew documents, and remember which reminder steps went out so each one
// is sent once.

import { companyFromAddress, sendEmail } from "@/lib/email";
import { addBellNotifications, escapeHtml, niceDay, siteUrl, usersWithPermission, type BellInput } from "@/lib/notify";
import { planVisaReminders, type ReminderItem, type VisaInput } from "@/lib/visa-reminder-plan";

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped supabase client, same pattern as the cron routes */

export type VisaReminderResult = {
  orgsChecked: number;
  actionItems: number;
  newSteps: number;
  emailsSent: number;
  bellCreated: number;
  errors: string[];
};

const MAX_ROWS_PER_GROUP = 40;

async function fetchAll(build: (from: number, to: number) => any): Promise<any[]> {
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error || !data) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function daysText(item: ReminderItem): string {
  if (item.daysLeft < 0) return `${plural(-item.daysLeft, "day")} ago`;
  if (item.daysLeft === 0) return "today";
  return plural(item.daysLeft, "day");
}

function dateLabel(item: ReminderItem): string {
  return item.clock === "entry" ? "Enter by" : item.clock === "stay" ? "Stay until" : "Expires";
}

function groupHtml(title: string, color: string, bg: string, items: ReminderItem[], showReason: boolean): string {
  if (items.length === 0) return "";
  const shown = items.slice(0, MAX_ROWS_PER_GROUP);
  const rows = shown
    .map(
      (it) => `<tr>
        <td style="padding:6px 8px 6px 0;border-bottom:1px solid #e3e8ee;">${escapeHtml(it.crewName)}</td>
        <td style="padding:6px 8px 6px 0;border-bottom:1px solid #e3e8ee;">${escapeHtml(it.visaName)}</td>
        <td style="padding:6px 8px 6px 0;border-bottom:1px solid #e3e8ee;white-space:nowrap;">${dateLabel(it)} ${niceDay(it.targetDate)}</td>
        <td style="padding:6px 8px 6px 0;border-bottom:1px solid #e3e8ee;white-space:nowrap;">${daysText(it)}</td>
        <td style="padding:6px 0;border-bottom:1px solid #e3e8ee;">${escapeHtml(showReason ? it.reason : `${it.stepDays}-day reminder`)}</td>
      </tr>`
    )
    .join("");
  const more = items.length > shown.length ? `<p style="margin:6px 0;color:#6b7686;font-size:12px;">…and ${items.length - shown.length} more. Open the Visa Tracker to see them all.</p>` : "";
  return `
    <h3 style="margin:18px 0 6px;font-size:14px;"><span style="background:${bg};color:${color};padding:2px 8px;border-radius:10px;font-size:12px;margin-right:6px;">${escapeHtml(title)}</span></h3>
    <table style="border-collapse:collapse;width:100%;font-size:13px;">
      <tr style="color:#6b7686;text-align:left;"><th style="padding:4px 8px 4px 0;font-weight:500;">Crew</th><th style="padding:4px 8px 4px 0;font-weight:500;">Visa</th><th style="padding:4px 8px 4px 0;font-weight:500;">Date</th><th style="padding:4px 8px 4px 0;font-weight:500;">When</th><th style="padding:4px 0;font-weight:500;">${showReason ? "Issue" : "Step"}</th></tr>
      ${rows}
    </table>${more}`;
}

export function buildVisaDigest(
  today: string,
  actions: ReminderItem[],
  steps: ReminderItem[]
): { subject: string; html: string; text: string } {
  const soon = steps.filter((s) => s.daysLeft <= 14).sort((a, b) => a.daysLeft - b.daysLeft);
  const later = steps.filter((s) => s.daysLeft > 14).sort((a, b) => a.daysLeft - b.daysLeft);
  const sortedActions = [...actions].sort((a, b) => a.daysLeft - b.daysLeft);

  const subject =
    actions.length > 0
      ? `Visa reminders for ${niceDay(today)}: ${plural(actions.length, "visa")} need action`
      : `Visa reminders for ${niceDay(today)}: ${plural(steps.length, "reminder step")} reached`;

  const badges = [
    actions.length ? `<span style="background:#fbe9e9;color:#c62f2f;padding:4px 10px;border-radius:6px;font-weight:600;font-size:12px;margin-right:6px;">${actions.length} need action</span>` : "",
    soon.length ? `<span style="background:#fdf1d9;color:#a86400;padding:4px 10px;border-radius:6px;font-weight:600;font-size:12px;margin-right:6px;">${soon.length} within 14 days</span>` : "",
    later.length ? `<span style="background:#e6eefa;color:#2a62b4;padding:4px 10px;border-radius:6px;font-weight:600;font-size:12px;">${later.length} earlier reminder${later.length === 1 ? "" : "s"}</span>` : "",
  ].join("");

  const html = `
    <h2 style="margin:0 0 4px;font-size:18px;">Visa reminders</h2>
    <p style="margin:4px 0;">${escapeHtml(niceDay(today))}. These are the visas that need attention across the active crew.</p>
    <p style="margin:10px 0;">${badges}</p>
    ${groupHtml("Action needed", "#c62f2f", "#fbe9e9", sortedActions, true)}
    ${groupHtml("Expiring soon", "#a86400", "#fdf1d9", soon, false)}
    ${groupHtml("Heads up", "#2a62b4", "#e6eefa", later, false)}
    <p style="margin:18px 0 6px;"><a href="${siteUrl()}/crew/visas" style="background:#0b6e7f;color:#ffffff;padding:8px 14px;border-radius:6px;font-weight:600;font-size:13px;text-decoration:none;">Open Visa Tracker</a></p>
    <p style="color:#6b7686;font-size:12px;">Sent once a day, only when something needs attention. Each reminder step is sent once per visa; items under Action needed are listed every day until they are fixed.</p>`;

  const line = (it: ReminderItem) => `${it.crewName} - ${it.visaName} - ${dateLabel(it)} ${niceDay(it.targetDate)} (${daysText(it)}) - ${it.reason}`;
  const text = [
    `Visa reminders for ${niceDay(today)}`,
    "",
    actions.length ? `ACTION NEEDED (${actions.length})\n${sortedActions.slice(0, MAX_ROWS_PER_GROUP).map(line).join("\n")}` : "",
    soon.length ? `EXPIRING SOON (${soon.length})\n${soon.slice(0, MAX_ROWS_PER_GROUP).map(line).join("\n")}` : "",
    later.length ? `HEADS UP (${later.length})\n${later.slice(0, MAX_ROWS_PER_GROUP).map(line).join("\n")}` : "",
    `Visa Tracker: ${siteUrl()}/crew/visas`,
  ]
    .filter(Boolean)
    .join("\n\n");

  return { subject, html, text };
}

function namesPreview(items: ReminderItem[]): string {
  const names = Array.from(new Set(items.map((i) => i.crewName)));
  const shown = names.slice(0, 3).join(", ");
  return names.length > 3 ? `${shown} and ${names.length - 3} more` : shown;
}

export async function runVisaReminders(admin: any, today: string): Promise<VisaReminderResult> {
  const result: VisaReminderResult = { orgsChecked: 0, actionItems: 0, newSteps: 0, emailsSent: 0, bellCreated: 0, errors: [] };

  const { data: docTypes, error: dtErr } = await admin.from("document_types").select("id, org_id").eq("category", "visa");
  if (dtErr) {
    result.errors.push(`visa document types: ${dtErr.message}`);
    return result;
  }
  const typeIds = (docTypes ?? []).map((t: any) => t.id as string);
  if (typeIds.length === 0) return result;

  const docs = await fetchAll((from, to) =>
    admin
      .from("crew_documents")
      .select("id, org_id, crew_id, document_type_id, issue_date, expiry_date, entry_date, visa_country, visa_type_id, visa_status")
      .eq("is_active", true)
      .in("document_type_id", typeIds)
      .range(from, to)
  );
  if (docs.length === 0) return result;

  const [visaTypes, crew, logRows, settingsRows] = await Promise.all([
    fetchAll((from, to) => admin.from("visa_types").select("id, country, name, entry_valid_days, stay_basis, stay_days, entry_type, expiry_reminder_days, entry_reminder_days").range(from, to)),
    fetchAll((from, to) => admin.from("crew_profiles").select("id, org_id, full_name, employment_status").range(from, to)),
    fetchAll((from, to) => admin.from("visa_reminder_log").select("crew_document_id, kind, days_before, target_date").range(from, to)),
    admin
      .from("notification_settings")
      .select("org_id, recipient_emails, visa_reminders_enabled, last_visa_digest_sent_for")
      .then((r: any) => r.data ?? []),
  ]);

  const typeById = new Map<string, any>(visaTypes.map((t: any) => [t.id, t]));
  const crewById = new Map<string, any>(crew.map((c: any) => [c.id, c]));
  const logged = new Set<string>(logRows.map((l: any) => `${l.crew_document_id}|${l.kind}|${l.days_before}|${l.target_date}`));
  const settingsByOrg = new Map<string, any>(settingsRows.map((s: any) => [s.org_id, s]));

  const docsByOrg = new Map<string, any[]>();
  for (const d of docs) {
    const list = docsByOrg.get(d.org_id);
    if (list) list.push(d);
    else docsByOrg.set(d.org_id, [d]);
  }

  const bellPermissionCache = new Map<string, string[]>();

  for (const [orgId, orgDocs] of docsByOrg) {
    result.orgsChecked++;

    const inputs: VisaInput[] = [];
    for (const d of orgDocs) {
      const c = crewById.get(d.crew_id);
      if (!c || c.employment_status === "inactive" || c.employment_status === "terminated") continue;
      const t = d.visa_type_id ? typeById.get(d.visa_type_id) : null;
      inputs.push({
        docId: d.id,
        crewId: d.crew_id,
        crewName: c.full_name,
        typeName: t?.name ?? null,
        country: d.visa_country ?? t?.country ?? null,
        status: d.visa_status ?? null,
        issueDate: d.issue_date ?? null,
        expiryDate: d.expiry_date ?? null,
        entryDate: d.entry_date ?? null,
        rule: t ? { entry_valid_days: t.entry_valid_days ?? null, stay_basis: t.stay_basis, stay_days: t.stay_days ?? null, entry_type: t.entry_type ?? null } : null,
        expiryReminderDays: (t?.expiry_reminder_days as number[] | undefined) ?? [],
        entryReminderDays: (t?.entry_reminder_days as number[] | undefined) ?? [],
      });
    }

    const { items, reachedSteps } = planVisaReminders(inputs, today);
    const logKind = (it: ReminderItem) => (it.kind === "action" ? "action" : it.clock === "entry" ? "entry" : "expiry");
    const logKeyOf = (it: ReminderItem) => `${it.docId}|${logKind(it)}|${it.stepDays}|${it.targetDate}`;

    const actions = items.filter((i) => i.kind === "action");
    const newActions = actions.filter((i) => !logged.has(logKeyOf(i)));
    const newSteps = items.filter((i) => i.kind === "step" && !logged.has(logKeyOf(i)));
    result.actionItems += actions.length;
    result.newSteps += newSteps.length;
    if (actions.length === 0 && newSteps.length === 0) continue;

    let delivered = false;

    /* ---- Bell ---- */
    try {
      let userIds = bellPermissionCache.get(orgId);
      if (!userIds) {
        userIds = await usersWithPermission(admin, orgId, "crew.documents.manage");
        bellPermissionCache.set(orgId, userIds);
      }
      if (userIds.length > 0) {
        const bell: BellInput[] = [];
        for (const userId of userIds) {
          if (newActions.length > 0) {
            bell.push({
              orgId,
              userId,
              kind: "visa",
              severity: "critical",
              title: `${plural(newActions.length, "visa")} need${newActions.length === 1 ? "s" : ""} action`,
              body: `${namesPreview(newActions)}. Expired, entry deadline passed or stay ended.`,
              link: "/crew/visas",
              dedupeKey: `visa-action:${today}`,
            });
          }
          if (newSteps.length > 0) {
            const urgent = newSteps.some((s) => s.daysLeft <= 14);
            bell.push({
              orgId,
              userId,
              kind: "visa",
              severity: urgent ? "warning" : "info",
              title: `${plural(newSteps.length, "visa reminder")}`,
              body: `${namesPreview(newSteps)}.`,
              link: "/crew/visas",
              dedupeKey: `visa-steps:${today}`,
            });
          }
        }
        const { error } = await addBellNotifications(admin, bell);
        if (error) result.errors.push(`visa bell ${orgId}: ${error}`);
        else {
          result.bellCreated += bell.length;
          delivered = true;
        }
      }
    } catch (e) {
      result.errors.push(`visa bell ${orgId}: ${e instanceof Error ? e.message : String(e)}`);
    }

    /* ---- Email ---- */
    const settings = settingsByOrg.get(orgId);
    const recipients: string[] = settings?.recipient_emails ?? [];
    if (settings && settings.visa_reminders_enabled !== false && recipients.length > 0 && settings.last_visa_digest_sent_for !== today) {
      const { data: companyRow } = await admin.from("companies").select("name, notify_prefix").eq("id", orgId).single();
      const from = companyFromAddress(companyRow?.name ?? "ComplianceHub", companyRow?.notify_prefix ?? null);
      const digest = buildVisaDigest(today, actions, newSteps);
      let anySent = false;
      for (const to of recipients) {
        const { error } = await sendEmail({ from, to, subject: digest.subject, html: digest.html, text: digest.text });
        if (error) result.errors.push(`visa digest ${orgId} -> ${to}: ${error}`);
        else anySent = true;
      }
      if (anySent) {
        await admin.from("notification_settings").update({ last_visa_digest_sent_for: today }).eq("org_id", orgId);
        result.emailsSent++;
        delivered = true;
      }
    }

    /* ---- Remember what went out ---- */
    if (!delivered) continue;
    const logInsert: any[] = [];
    const seen = new Set<string>();
    const add = (docId: string, kind: string, days: number, target: string) => {
      const key = `${docId}|${kind}|${days}|${target}`;
      if (logged.has(key) || seen.has(key)) return;
      seen.add(key);
      logInsert.push({ org_id: orgId, crew_document_id: docId, kind, days_before: days, target_date: target, sent_on: today });
    };
    for (const a of newActions) add(a.docId, "action", 0, a.targetDate);
    for (const s of newSteps) {
      // Mark every step already reached, so the larger ones are not sent later.
      for (const d of reachedSteps.get(`${s.docId}|${s.clock}`) ?? [s.stepDays]) add(s.docId, logKind(s), d, s.targetDate);
    }
    for (let i = 0; i < logInsert.length; i += 500) {
      const { error } = await admin.from("visa_reminder_log").upsert(logInsert.slice(i, i + 500), { onConflict: "crew_document_id,kind,days_before,target_date", ignoreDuplicates: true });
      if (error) result.errors.push(`visa log ${orgId}: ${error.message}`);
    }
    for (const k of seen) logged.add(k);
  }

  return result;
}
