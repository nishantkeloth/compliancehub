import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, companyFromAddress } from "@/lib/email";

// Supabase's join inference sometimes returns an embedded relation as a
// single object and sometimes as a one-element array depending on the
// relationship — normalize both to an object.
function unwrap<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

const ESCALATE_AFTER_DAYS_OVERDUE = 3;

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

  return NextResponse.json({
    schedulesChecked: (schedules ?? []).length,
    scheduleSent,
    actionsChecked: (actions ?? []).length,
    actionSent,
    errors,
  });
}
