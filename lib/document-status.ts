// Single source of truth for crew document / certification expiry status —
// mirrors rbac.ts's role as a shared helper rather than reimplementing the
// same date math in every screen that shows a document.
//
// Bands: expired (< 0 days), critical (0–14 days), warning (15..warningDays
// days), ok (beyond warningDays). warningDays defaults to the 75-day band
// already used for KSA visas in the source spreadsheets for category
// "visa", and a simpler 30-day band for everything else — either can be
// overridden per document_type via warning_threshold_days.

export type DocumentStatus = "ok" | "warning" | "critical" | "expired" | "none";

const CRITICAL_DAYS = 14;
const DEFAULT_VISA_WARNING_DAYS = 75;
const DEFAULT_WARNING_DAYS = 30;

export function computeDocumentStatus(
  expiryDate: string | null,
  warningThresholdDays: number | null,
  category: string | null
): { status: DocumentStatus; daysRemaining: number | null } {
  if (!expiryDate) return { status: "none", daysRemaining: null };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(expiryDate + "T00:00:00");
  const daysRemaining = Math.round((expiry.getTime() - today.getTime()) / 86400000);

  const warningDays = warningThresholdDays ?? (category === "visa" ? DEFAULT_VISA_WARNING_DAYS : DEFAULT_WARNING_DAYS);

  let status: DocumentStatus;
  if (daysRemaining < 0) status = "expired";
  else if (daysRemaining <= CRITICAL_DAYS) status = "critical";
  else if (daysRemaining <= warningDays) status = "warning";
  else status = "ok";

  return { status, daysRemaining };
}

export const DOCUMENT_STATUS_COLORS: Record<DocumentStatus, { bg: string; fg: string }> = {
  ok: { bg: "#e6f6ec", fg: "#1a7d3d" },
  warning: { bg: "#fff6e0", fg: "#9a6b00" },
  critical: { bg: "#ffe4d6", fg: "#c2410c" },
  expired: { bg: "#fbe0e0", fg: "#b3261e" },
  none: { bg: "#eef1f6", fg: "#6b7686" },
};

export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  ok: "OK",
  warning: "Expiring",
  critical: "Critical",
  expired: "Expired",
  none: "Not set",
};
