import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, companyFromAddress } from "@/lib/email";
import { computeDocumentStatus } from "@/lib/document-status";
import { severityFromStatus, SEVERITY_RANK } from "@/lib/document-notifications";
import { loadAiContext, runAgent } from "@/lib/ai/router";

// Vercel's default serverless timeout is short; this run now also makes an
// AI call per org that needs a digest, so give it real headroom. (Hobby
// plans cap functions at 10s regardless of this setting — this only takes
// effect on plans that allow it.)
export const maxDuration = 60;

// Supabase's join inference sometimes returns an embedded relation as a
// single object and sometimes as a one-element array depending on the
// relationship — normalize both to an object.
function unwrap<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

const ESCALATE_AFTER_DAYS_OVERDUE = 3;

/* ---------------- Document-expiry digest composition (Phase 14) ---------------- */

const SYSTEM_DIGEST = `You compose a short daily email digest for ComplianceHub, an offshore-crew compliance platform. You'll be given a plain, already-priority-sorted list of crew documents that are expiring soon, critical, or expired.

Rules:
- Output PLAIN TEXT only — no HTML, no markdown headers. You may use **word** to bold a name or a severity word.
- Never invent a document, person, or date that isn't in the list you were given.
- Open with a one-line summary (counts by severity, and how many are for currently-mobilized crew).
- Then a short prioritized rundown, grouped: escalated/overdue items first, then critical, then expiring — a sentence or two per item is fine, don't just repeat the raw list format.
- Explicitly call out anything marked "CURRENTLY MOBILIZED" as business-critical — losing that document could pull someone off an active assignment.
- Keep the whole thing under 250 words. No sign-off, no greeting — this is an automated alert, not a letter.`;

type DigestItem = {
  notificationId: string;
  crewName: string;
  documentTypeName: string;
  severity: string;
  daysRemaining: number | null;
  escalated: boolean;
  mobilizedAt: string | null;
};

function renderFallbackDigest(items: DigestItem[]): string {
  // Used if the AI call fails for any reason — never let a broken model
  // call mean nobody hears about an expired visa.
  const lines = items
    .slice(0, 30)
    .map((it) => {
      const days = it.daysRemaining == null ? "" : it.daysRemaining < 0 ? ` (${Math.abs(it.daysRemaining)}d overdue)` : ` (${it.daysRemaining}d left)`;
      const mobilized = it.mobilizedAt ? ` — currently mobilized at ${it.mobilizedAt}` : "";
      const escalated = it.escalated ? " — ESCALATED" : "";
      return `${it.crewName} — ${it.documentTypeName} — ${it.severity}${days}${mobilized}${escalated}`;
    })
    .join("\n");
  return `${items.length} document${items.length === 1 ? "" : "s"} need attention today.\n\n${lines}`;
}

// Escape any HTML the model output might contain first, THEN apply a
// tiny markdown-lite conversion — this guarantees the email body can
// never carry a tag the model wasn't supposed to produce.
function digestTextToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const withBold = escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  const paragraphs = withBold
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("\n");
  return paragraphs;
}

function renderDigestHtml(digestText: string, itemCount: number): string {
  return `
    <p>ComplianceHub's daily document-expiry check found <strong>${itemCount}</strong> item${itemCount === 1 ? "" : "s"} needing attention.</p>
    ${digestTextToHtml(digestText)}
    <p style="color:#6b7686;font-size:12px;">Review and resolve these on the Operations Dashboard in ComplianceHub.</p>
  `;
}

// Triggered by Vercel Cron (see vercel.json) once a day. Protected by
// CRON_SECRET — Vercel automatically sends "Authorization: Bearer
// <CRON_SECRET>" to scheduled invocations when an env var with that exact
// name is set on the project. Handles both recurring inspection schedule
// reminders and corrective action due/overdue/escalation reminders in one
// run, to keep this to a single Vercel cron job.
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);
  const dueSoonCutoff = new Date();
  dueSoonCutoff.setUTCDate(dueSoonCutoff.getUTCDate() + 3);
  const dueSoonCutoffStr = dueSoonCutoff.toISOString().slice(0, 10);

  let scheduleSent = 0;
  let actionSent = 0;
  const errors: string[] = [];

  /* ---------------- Recurring inspection schedules ---------------- */

  const { data: schedules, error: scheduleErr } = await admin
    .from("inspection_schedules")
    .select(
      "id, org_id, assigned_to, created_by, next_due_date, reminder_due_soon_sent_for, reminder_overdue_sent_for, templates(name), sites(name), companies(name, notify_prefix)"
    )
    .eq("active", true)
    .lte("next_due_date", dueSoonCutoffStr);

  if (scheduleErr) {
    errors.push(`schedules query: ${scheduleErr.message}`);
  }

  for (const s of schedules ?? []) {
    const isOverdue = s.next_due_date < today;
    const alreadySentForThisCycle = isOverdue
      ? s.reminder_overdue_sent_for === s.next_due_date
      : s.reminder_due_soon_sent_for === s.next_due_date;
    if (alreadySentForThisCycle) continue;

    const recipientId = s.assigned_to ?? s.created_by;
    if (!recipientId) continue;

    const { data: userResult } = await admin.auth.admin.getUserById(recipientId);
    const email = userResult?.user?.email;
    if (!email) continue;

    const company = unwrap((s as any).companies) as { name: string; notify_prefix: string | null } | null;
    const template = unwrap((s as any).templates) as { name: string } | null;
    const site = unwrap((s as any).sites) as { name: string } | null;
    const from = companyFromAddress(company?.name ?? "ComplianceHub", company?.notify_prefix ?? null);

    const subject = isOverdue
      ? `Overdue: ${template?.name ?? "Inspection"} at ${site?.name ?? "site"}`
      : `Due soon: ${template?.name ?? "Inspection"} at ${site?.name ?? "site"}`;
    const html = `
      <p>${isOverdue ? "This recurring inspection is now overdue." : "This recurring inspection is coming up."}</p>
      <p><strong>${template?.name ?? "Inspection"}</strong> at <strong>${site?.name ?? "site"}</strong></p>
      <p>Due: ${s.next_due_date}</p>
    `;

    const { error: sendError } = await sendEmail({ from, to: email, subject, html });
    if (sendError) {
      errors.push(`schedule ${s.id}: ${sendError}`);
      continue;
    }

    await admin
      .from("inspection_schedules")
      .update(
        isOverdue
          ? { reminder_overdue_sent_for: s.next_due_date }
          : { reminder_due_soon_sent_for: s.next_due_date }
      )
      .eq("id", s.id);
    scheduleSent++;
  }

  /* ---------------- Corrective actions: due / overdue / escalate ---------------- */

  const { data: actions, error: actionErr } = await admin
    .from("corrective_actions")
    .select(
      "id, org_id, title, finding, due_date, status, owner_id, owner_name, reminder_due_soon_sent_for, reminder_overdue_sent_for, escalation_sent_for, sites(name), companies(name, notify_prefix)"
    )
    .in("status", ["open", "in_progress"])
    .lte("due_date", dueSoonCutoffStr);

  if (actionErr) {
    errors.push(`actions query: ${actionErr.message}`);
  }

  // org_id -> escalation recipient emails, computed once per org per run.
  const escalationRecipientsCache = new Map<string, string[]>();

  async function getEscalationRecipients(orgId: string): Promise<string[]> {
    if (escalationRecipientsCache.has(orgId)) return escalationRecipientsCache.get(orgId)!;

    const { data: roleRows } = await admin
      .from("roles")
      .select("id, role_permissions!inner(permission_key)")
      .eq("org_id", orgId)
      .eq("role_permissions.permission_key", "actions.close");
    const roleIds = (roleRows ?? []).map((r: any) => r.id);

    let emails: string[] = [];
    if (roleIds.length > 0) {
      const { data: profileRows } = await admin
        .from("profiles")
        .select("id")
        .eq("org_id", orgId)
        .in("role_id", roleIds);

      for (const p of profileRows ?? []) {
        const { data: userResult } = await admin.auth.admin.getUserById((p as any).id);
        const email = userResult?.user?.email;
        if (email) emails.push(email);
      }
    }

    escalationRecipientsCache.set(orgId, emails);
    return emails;
  }

  for (const a of actions ?? []) {
    const isOverdue = a.due_date < today;
    const daysOverdue = isOverdue
      ? Math.floor((Date.parse(today) - Date.parse(a.due_date)) / 86_400_000)
      : 0;

    const company = unwrap((a as any).companies) as { name: string; notify_prefix: string | null } | null;
    const site = unwrap((a as any).sites) as { name: string } | null;
    const from = companyFromAddress(company?.name ?? "ComplianceHub", company?.notify_prefix ?? null);

    // Individual reminder to the assignee (due-soon, or first overdue notice).
    const alreadySentIndividual = isOverdue
      ? a.reminder_overdue_sent_for === a.due_date
      : a.reminder_due_soon_sent_for === a.due_date;

    if (!alreadySentIndividual && a.owner_id) {
      const { data: userResult } = await admin.auth.admin.getUserById(a.owner_id);
      const email = userResult?.user?.email;
      if (email) {
        const subject = isOverdue
          ? `Overdue corrective action: ${a.title}`
          : `Corrective action due soon: ${a.title}`;
        const html = `
          <p>${isOverdue ? "This corrective action is now overdue." : "This corrective action is coming up."}</p>
          <p><strong>${a.title}</strong> at <strong>${site?.name ?? "site"}</strong></p>
          ${a.finding ? `<p>Finding: ${a.finding}</p>` : ""}
          <p>Due: ${a.due_date}</p>
        `;
        const { error: sendError } = await sendEmail({ from, to: email, subject, html });
        if (sendError) {
          errors.push(`action ${a.id}: ${sendError}`);
        } else {
          await admin
            .from("corrective_actions")
            .update(
              isOverdue
                ? { reminder_overdue_sent_for: a.due_date }
                : { reminder_due_soon_sent_for: a.due_date }
            )
            .eq("id", a.id);
          actionSent++;
        }
      }
    }

    // Escalation to everyone with actions.close in the org, once an action
    // has been overdue for ESCALATE_AFTER_DAYS_OVERDUE days.
    const alreadyEscalated = a.escalation_sent_for === a.due_date;
    if (isOverdue && daysOverdue >= ESCALATE_AFTER_DAYS_OVERDUE && !alreadyEscalated) {
      const recipients = await getEscalationRecipients(a.org_id);
      if (recipients.length > 0) {
        const subject = `Escalation: overdue corrective action — ${a.title}`;
        const html = `
          <p>A corrective action has been overdue for ${daysOverdue} day${daysOverdue === 1 ? "" : "s"} and is still open.</p>
          <p><strong>${a.title}</strong> at <strong>${site?.name ?? "site"}</strong></p>
          ${a.finding ? `<p>Finding: ${a.finding}</p>` : ""}
          <p>Due: ${a.due_date}${a.owner_name ? ` · Assigned to: ${a.owner_name}` : " · Unassigned"}</p>
        `;
        let anySent = false;
        for (const email of recipients) {
          const { error: sendError } = await sendEmail({ from, to: email, subject, html });
          if (sendError) {
            errors.push(`escalation ${a.id} -> ${email}: ${sendError}`);
          } else {
            anySent = true;
          }
        }
        if (anySent) {
          await admin.from("corrective_actions").update({ escalation_sent_for: a.due_date }).eq("id", a.id);
          actionSent++;
        }
      }
    }
  }

  /* ---------------- Document expiry: sweep + digest (Phase 14) ---------------- */

  let docNotifCreated = 0;
  let docNotifUpdated = 0;
  let docNotifResolved = 0;
  let digestsSent = 0;

  const { data: crewDocs, error: crewDocsErr } = await admin
    .from("crew_documents")
    .select(
      "id, org_id, crew_id, document_type_id, expiry_date, crew_profiles(full_name), document_types(name, category, warning_threshold_days)"
    )
    .eq("is_active", true)
    .not("expiry_date", "is", null);
  if (crewDocsErr) errors.push(`crew_documents query: ${crewDocsErr.message}`);

  // Every currently OPEN notification, keyed by the document it's for —
  // one round trip instead of a per-document lookup.
  const { data: openNotifRows, error: openNotifErr } = await admin
    .from("document_notifications")
    .select("id, org_id, crew_id, crew_document_id, severity, days_remaining, escalated_at, notified_count")
    .eq("status", "open");
  if (openNotifErr) errors.push(`document_notifications query: ${openNotifErr.message}`);
  const openByDoc = new Map<
    string,
    { id: string; severity: string; days_remaining: number | null; escalated_at: string | null; notified_count: number }
  >((openNotifRows ?? []).map((n) => [n.crew_document_id, n]));
  const notifiedCountById = new Map<string, number>((openNotifRows ?? []).map((n) => [n.id, n.notified_count ?? 0]));

  // Who's currently on an active assignment, org-wide — the business-impact
  // signal: an expiring document belonging to someone mobilized right now
  // outranks the same document for someone on the bench.
  const { data: activeAssignments } = await admin.from("crew_assignments").select("crew_id, offshore_sites(name)").is("end_date", null);
  const activeSiteByCrew = new Map<string, string | null>();
  for (const a of activeAssignments ?? []) {
    activeSiteByCrew.set((a as any).crew_id, unwrap<{ name?: string }>((a as any).offshore_sites)?.name ?? null);
  }

  const { data: notifSettingsRows } = await admin
    .from("notification_settings")
    .select("org_id, recipient_emails, escalate_after_days, digest_enabled, last_digest_sent_for");
  const notifSettingsByOrg = new Map(
    (notifSettingsRows ?? []).map((s) => [
      s.org_id,
      s as { org_id: string; recipient_emails: string[]; escalate_after_days: number; digest_enabled: boolean; last_digest_sent_for: string | null },
    ])
  );

  const seenDocIds = new Set<string>();
  const digestItemsByOrg = new Map<string, DigestItem[]>();

  for (const d of crewDocs ?? []) {
    seenDocIds.add(d.id);
    const docType = unwrap<{ name?: string; category?: string | null; warning_threshold_days?: number | null }>((d as any).document_types);
    const { status, daysRemaining } = computeDocumentStatus(d.expiry_date, docType?.warning_threshold_days ?? null, docType?.category ?? null);
    const severity = severityFromStatus(status);
    const existing = openByDoc.get(d.id);

    if (!severity) {
      if (existing) {
        await admin
          .from("document_notifications")
          .update({ status: "resolved", resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("id", existing.id);
        docNotifResolved++;
      }
      continue;
    }

    const settings = notifSettingsByOrg.get(d.org_id);
    const escalateAfterDays = settings?.escalate_after_days ?? ESCALATE_AFTER_DAYS_OVERDUE;
    const isEscalationDue = severity === "expired" && daysRemaining != null && Math.abs(daysRemaining) >= escalateAfterDays;

    let notificationId: string | null = existing?.id ?? null;
    if (existing) {
      const escalateNow = isEscalationDue && !existing.escalated_at;
      if (existing.severity !== severity || existing.days_remaining !== daysRemaining || escalateNow) {
        await admin
          .from("document_notifications")
          .update({
            severity,
            days_remaining: daysRemaining,
            updated_at: new Date().toISOString(),
            ...(escalateNow ? { escalated_at: new Date().toISOString() } : {}),
          })
          .eq("id", existing.id);
        docNotifUpdated++;
      }
    } else {
      const { data: inserted } = await admin
        .from("document_notifications")
        .insert({
          org_id: d.org_id,
          crew_id: d.crew_id,
          crew_document_id: d.id,
          document_type_id: d.document_type_id,
          severity,
          days_remaining: daysRemaining,
          status: "open",
          ...(isEscalationDue ? { escalated_at: new Date().toISOString() } : {}),
        })
        .select("id")
        .single();
      notificationId = inserted?.id ?? null;
      docNotifCreated++;
    }

    if (notificationId && settings?.digest_enabled && (settings.recipient_emails ?? []).length > 0 && settings.last_digest_sent_for !== today) {
      const list = digestItemsByOrg.get(d.org_id) ?? [];
      list.push({
        notificationId,
        crewName: unwrap<{ full_name?: string }>((d as any).crew_profiles)?.full_name ?? "Unknown",
        documentTypeName: docType?.name ?? "Document",
        severity,
        daysRemaining,
        escalated: isEscalationDue,
        mobilizedAt: activeSiteByCrew.get(d.crew_id) ?? null,
      });
      digestItemsByOrg.set(d.org_id, list);
    }
  }

  // Auto-resolve any OPEN notification whose document wasn't in this
  // sweep at all (e.g. soft-deleted since the last run).
  for (const [docId, n] of openByDoc) {
    if (!seenDocIds.has(docId)) {
      await admin
        .from("document_notifications")
        .update({ status: "resolved", resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", n.id);
      docNotifResolved++;
    }
  }

  // One AI-composed digest per org that has open items and hasn't been
  // sent one today, emailed to every configured recipient.
  for (const [digestOrgId, items] of digestItemsByOrg) {
    if (items.length === 0) continue;
    const settings = notifSettingsByOrg.get(digestOrgId);
    if (!settings) continue;

    const { data: companyRow } = await admin.from("companies").select("name, notify_prefix").eq("id", digestOrgId).single();
    const from = companyFromAddress(companyRow?.name ?? "ComplianceHub", companyRow?.notify_prefix ?? null);

    items.sort((a, b) => {
      const critA = a.mobilizedAt ? 0 : 1;
      const critB = b.mobilizedAt ? 0 : 1;
      if (critA !== critB) return critA - critB;
      const rank = SEVERITY_RANK as Record<string, number>;
      const rankDiff = (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9);
      if (rankDiff !== 0) return rankDiff;
      return (a.daysRemaining ?? 0) - (b.daysRemaining ?? 0);
    });

    let digestBody: string;
    try {
      const ctx = await loadAiContext(admin, digestOrgId);
      const listText = items
        .slice(0, 60)
        .map((it, i) => {
          const days = it.daysRemaining == null ? "" : it.daysRemaining < 0 ? ` (${Math.abs(it.daysRemaining)}d overdue)` : ` (${it.daysRemaining}d left)`;
          const mobilized = it.mobilizedAt ? ` — CURRENTLY MOBILIZED at ${it.mobilizedAt}` : "";
          const escalated = it.escalated ? " — ESCALATED" : "";
          return `${i + 1}. ${it.crewName} — ${it.documentTypeName} — ${it.severity}${days}${mobilized}${escalated}`;
        })
        .join("\n");
      const result = await runAgent(admin, ctx, {
        task: "document_digest",
        system: SYSTEM_DIGEST,
        messages: [{ role: "user", content: `Today: ${today}\n\nExpiring/expired documents (${items.length} total, already sorted by priority):\n${listText}` }],
        tools: {},
        userId: null,
        maxSteps: 1,
      });
      digestBody = "text" in result ? result.text : renderFallbackDigest(items);
    } catch (e) {
      errors.push(`digest ${digestOrgId} AI call: ${e instanceof Error ? e.message : String(e)}`);
      digestBody = renderFallbackDigest(items);
    }

    const html = renderDigestHtml(digestBody, items.length);
    const subject = `Document expiry digest — ${items.length} item${items.length === 1 ? "" : "s"} need attention`;

    let anySent = false;
    for (const email of settings.recipient_emails ?? []) {
      const { error: sendError } = await sendEmail({ from, to: email, subject, html });
      if (sendError) errors.push(`digest ${digestOrgId} -> ${email}: ${sendError}`);
      else anySent = true;
    }
    if (anySent) {
      await admin.from("notification_settings").update({ last_digest_sent_for: today }).eq("org_id", digestOrgId);
      for (const item of items) {
        const nextCount = (notifiedCountById.get(item.notificationId) ?? 0) + 1;
        await admin
          .from("document_notifications")
          .update({ last_notified_at: new Date().toISOString(), notified_count: nextCount })
          .eq("id", item.notificationId);
      }
      digestsSent++;
    }
  }

  return NextResponse.json({
    schedulesChecked: (schedules ?? []).length,
    scheduleSent,
    actionsChecked: (actions ?? []).length,
    actionSent,
    documentsChecked: (crewDocs ?? []).length,
    docNotifCreated,
    docNotifUpdated,
    docNotifResolved,
    digestsSent,
    errors,
  });
}
