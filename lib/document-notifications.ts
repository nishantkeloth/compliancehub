// Phase 14 — Document Notification Engine & Operations Dashboard.
// Shared constants/types used by the settings page, the dashboard page,
// and the cron sweep (app/api/cron/send-reminders/route.ts) — kept here
// rather than duplicated in each, since all three need the exact same
// module-key vocabulary and severity mapping to stay in sync.

import type { DocumentStatus } from "./document-status";

export type DocumentNotificationSeverity = "warning" | "critical" | "expired";

// computeDocumentStatus() returns "ok" | "warning" | "critical" |
// "expired" | "none" — only the three alarm bands ever get a
// document_notifications row.
export function severityFromStatus(status: DocumentStatus): DocumentNotificationSeverity | null {
  if (status === "warning" || status === "critical" || status === "expired") return status;
  return null;
}

export const SEVERITY_RANK: Record<DocumentNotificationSeverity, number> = {
  expired: 0,
  critical: 1,
  warning: 2,
};

export const SEVERITY_LABELS: Record<DocumentNotificationSeverity, string> = {
  expired: "Expired",
  critical: "Critical",
  warning: "Expiring",
};

export const SEVERITY_COLORS: Record<DocumentNotificationSeverity, { bg: string; fg: string }> = {
  expired: { bg: "#fbe0e0", fg: "#b3261e" },
  critical: { bg: "#ffe4d6", fg: "#c2410c" },
  warning: { bg: "#fff6e0", fg: "#9a6b00" },
};

export const DASHBOARD_MODULE_KEYS = ["document_expiry", "crew_matrix", "inspections_actions"] as const;
export type DashboardModuleKey = (typeof DASHBOARD_MODULE_KEYS)[number];

export const DASHBOARD_MODULE_LABELS: Record<DashboardModuleKey, string> = {
  document_expiry: "Document Expiry & Notifications",
  crew_matrix: "Crew Matrix Overview",
  inspections_actions: "Inspections, Audits & Corrective Actions",
};

export const DASHBOARD_MODULE_DESCRIPTIONS: Record<DashboardModuleKey, string> = {
  document_expiry: "Crew certificates, licenses and visas approaching or past expiry.",
  crew_matrix: "Headcount, employment status and who's currently mobilized.",
  inspections_actions: "Upcoming/overdue inspections and open corrective actions.",
};
