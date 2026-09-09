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
}): Promise<{ error: string | null }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { error: "RESEND_API_KEY is not configured." };
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
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { error: `Resend API error (${res.status}): ${body}` };
  }
  return { error: null };
}
