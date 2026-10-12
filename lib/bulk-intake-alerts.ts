// Alert for a bulk document upload that failed. Sent once per upload: the job is
// marked failure_alerted_at afterwards, so the 6-hourly watchdog never repeats it.
// Goes to the person who started the upload and the notification recipient list,
// plus a bell item for the person who started it.

import { companyFromAddress, sendEmail } from "@/lib/email";
import { addBellNotifications, escapeHtml, niceDay, siteUrl } from "@/lib/notify";

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped supabase client, same pattern as the cron routes */

type FailedJob = {
  id: string;
  org_id: string;
  folder_name: string;
  total_files: number | null;
  processed_files: number | null;
  last_heartbeat_at: string | null;
  created_by: string | null;
  created_at: string;
  error: string | null;
};

function timeText(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${niceDay(iso)}, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`;
}

/** Returns an error message, or null when the alert is done (sent, or nobody to tell). */
export async function alertFailedBulkJob(admin: any, job: FailedJob): Promise<string | null> {
  const total = job.total_files ?? 0;
  const done = job.processed_files ?? 0;
  const remaining = Math.max(0, total - done);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const link = `${siteUrl()}/team/bulk-intake`;

  let starterName = "Unknown";
  let starterEmail: string | null = null;
  if (job.created_by) {
    const [{ data: profile }, { data: userResult }] = await Promise.all([
      admin.from("profiles").select("full_name").eq("id", job.created_by).maybeSingle(),
      admin.auth.admin.getUserById(job.created_by),
    ]);
    starterName = profile?.full_name ?? userResult?.user?.email ?? "Unknown";
    starterEmail = userResult?.user?.email ?? null;
  }

  const { data: settings } = await admin.from("notification_settings").select("recipient_emails").eq("org_id", job.org_id).maybeSingle();
  const recipients = Array.from(new Set([...(starterEmail ? [starterEmail] : []), ...((settings?.recipient_emails as string[] | undefined) ?? [])]));

  // Bell item for whoever started the upload.
  if (job.created_by) {
    await addBellNotifications(admin, [
      {
        orgId: job.org_id,
        userId: job.created_by,
        kind: "upload",
        severity: "critical",
        title: "Bulk upload failed",
        body: `${job.folder_name}. ${done} of ${total} files processed.`,
        link: "/team/bulk-intake",
        dedupeKey: `upload-failed:${job.id}`,
      },
    ]);
  }

  if (recipients.length === 0) return null;

  const { data: companyRow } = await admin.from("companies").select("name, notify_prefix").eq("id", job.org_id).single();
  const from = companyFromAddress(companyRow?.name ?? "ComplianceHub", companyRow?.notify_prefix ?? null);
  const subject = `Bulk document upload failed: ${job.folder_name}`;
  const html = `
    <h2 style="margin:0 0 6px;font-size:18px;">A bulk document upload stopped</h2>
    <p style="margin:6px 0;">The upload below failed. The files already processed are saved. The rest need to be uploaded again.</p>
    <table style="border-collapse:collapse;font-size:13px;margin:10px 0;">
      <tr><td style="padding:3px 14px 3px 0;color:#6b7686;">Folder</td><td>${escapeHtml(job.folder_name)}</td></tr>
      <tr><td style="padding:3px 14px 3px 0;color:#6b7686;">Started by</td><td>${escapeHtml(starterName)}</td></tr>
      <tr><td style="padding:3px 14px 3px 0;color:#6b7686;">Started</td><td>${escapeHtml(timeText(job.created_at))}</td></tr>
      <tr><td style="padding:3px 14px 3px 0;color:#6b7686;">Last activity</td><td>${escapeHtml(timeText(job.last_heartbeat_at))}</td></tr>
      <tr><td style="padding:3px 14px 3px 0;color:#6b7686;">Files</td><td>${done} of ${total} processed (${pct}%). ${remaining} remaining.</td></tr>
      ${job.error ? `<tr><td style="padding:3px 14px 3px 0;color:#6b7686;vertical-align:top;">Reason</td><td>${escapeHtml(job.error)}</td></tr>` : ""}
    </table>
    <p style="margin:14px 0;"><a href="${link}" style="background:#0b6e7f;color:#ffffff;padding:8px 14px;border-radius:6px;font-weight:600;font-size:13px;text-decoration:none;">Open Bulk Data Migration</a></p>
    <p style="color:#6b7686;font-size:12px;">Sent once per failed upload.</p>`;
  const text = `A bulk document upload stopped\n\nFolder: ${job.folder_name}\nStarted by: ${starterName}\nStarted: ${timeText(job.created_at)}\nLast activity: ${timeText(job.last_heartbeat_at)}\nFiles: ${done} of ${total} processed (${pct}%), ${remaining} remaining\n${job.error ? `Reason: ${job.error}\n` : ""}\nOpen: ${link}`;

  const failures: string[] = [];
  let anySent = false;
  for (const to of recipients) {
    const { error } = await sendEmail({ from, to, subject, html, text });
    if (error) failures.push(`${to}: ${error}`);
    else anySent = true;
  }
  return anySent ? null : failures.join("; ");
}
