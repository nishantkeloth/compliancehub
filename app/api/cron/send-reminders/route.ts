import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, companyFromAddress } from "@/lib/email";

// Triggered by Vercel Cron (see vercel.json) once a day. Protected by
// CRON_SECRET — Vercel automatically sends "Authorization: Bearer
// <CRON_SECRET>" to scheduled invocations when an env var with that exact
// name is set on the project.
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

  const { data: schedules, error } = await admin
    .from("inspection_schedules")
    .select(
      "id, org_id, assigned_to, created_by, next_due_date, reminder_due_soon_sent_for, reminder_overdue_sent_for, templates(name), sites(name), companies(name, notify_prefix)"
    )
    .eq("active", true)
    .lte("next_due_date", dueSoonCutoffStr);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let sent = 0;
  const errors: string[] = [];

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

    // Supabase's join inference sometimes returns these as a single object
    // and sometimes as a one-element array depending on the relationship —
    // normalize both to an object.
    const unwrap = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
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
    sent++;
  }

  return NextResponse.json({ checked: (schedules ?? []).length, sent, errors });
}
