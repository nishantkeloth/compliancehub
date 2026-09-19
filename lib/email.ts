// Thin wrapper around Resend's HTTP API — no SDK dependency needed, just
// fetch. Requires RESEND_API_KEY to be set; the sending domain is fixed
// to NOTIFY_DOMAIN, which must be verified in the Resend dashboard.
// Using the dedicated notifications.aifexis.com subdomain (already
// verified) rather than the bare apex domain keeps this fully isolated
// from mail on aifexis.com itself or any other product's subdomain.

const NOTIFY_DOMAIN = "notifications.aifexis.com";

// Derives the local-part of the From address for a company, e.g. "AHM"
// -> "AHM.notification@notifications.aifexis.com". Falls back to a
// sanitized version of the company name when no explicit prefix has been
// set.
export function companyFromAddress(companyName: string, notifyPrefix: string | null | undefined) {
  const prefix =
    notifyPrefix?.trim() ||
    companyName
      .split(/\s+/)[0]
      ?.replace(/[^a-zA-Z0-9]/g, "")
      .toUpperCase() ||
    "COMPLIANCEHUB";
  return `${prefix}.notification@${NOTIFY_DOMAIN}`;
}

export async function sendEmail(opts: {
  from: string;
  to: string;
  subject: string;
  html: string;
  // Plain-text alternative — some mail clients render this instead of
  // (or alongside) the HTML body. Optional so existing callers that only
  // ever sent HTML (e.g. the cron reminders) keep working unchanged.
  text?: string;
  replyTo?: string;
  // Resend accepts attachments as base64-encoded content directly in the
  // JSON payload — no separate upload step. Used by Crew Matrix Sharing
  // to attach the generated Excel file.
  attachments?: { filename: string; content: string; contentType?: string }[];
}): Promise<{ error: string | null; id: string | null }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { error: "RESEND_API_KEY is not configured.", id: null };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: opts.from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      ...(opts.text ? { text: opts.text } : {}),
      ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
      ...(opts.attachments?.length
        ? { attachments: opts.attachments.map((a) => ({ filename: a.filename, content: a.content, ...(a.contentType ? { content_type: a.contentType } : {}) })) }
        : {}),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { error: `Resend API error (${res.status}): ${body}`, id: null };
  }
  const data = (await res.json().catch(() => null)) as { id?: string } | null;
  return { error: null, id: data?.id ?? null };
}
