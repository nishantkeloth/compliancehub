"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { acknowledgeNotification, resolveNotification } from "./dashboard-actions";
import { SEVERITY_LABELS, SEVERITY_COLORS, type DocumentNotificationSeverity } from "@/lib/document-notifications";

export type ExpiryRow = {
  id: string;
  crewName: string;
  documentTypeName: string;
  severity: DocumentNotificationSeverity;
  daysRemaining: number | null;
  status: "open" | "acknowledged" | "resolved";
  escalated: boolean;
  businessCriticalSite: string | null;
};

function pill(text: string, bg: string, fg: string) {
  return (
    <span className="text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5" style={{ background: bg, color: fg }}>
      {text}
    </span>
  );
}

export default function DocumentExpiryModule({ rows, canManage }: { rows: ExpiryRow[]; canManage: boolean }) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const counts = { expired: 0, critical: 0, warning: 0 };
  for (const r of rows) counts[r.severity]++;

  const run = (fn: () => Promise<{ error?: string } | undefined>) => {
    startTransition(async () => {
      await fn();
      router.refresh();
    });
  };

  return (
    <div className="bg-white border rounded-xl p-5" style={{ borderColor: "var(--ch-line)" }}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold" style={{ color: "var(--ch-navy)" }}>
          Document Expiry & Notifications
        </div>
        <div className="flex gap-2">
          {pill(`${counts.expired} expired`, SEVERITY_COLORS.expired.bg, SEVERITY_COLORS.expired.fg)}
          {pill(`${counts.critical} critical`, SEVERITY_COLORS.critical.bg, SEVERITY_COLORS.critical.fg)}
          {pill(`${counts.warning} expiring`, SEVERITY_COLORS.warning.bg, SEVERITY_COLORS.warning.fg)}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="text-sm py-6 text-center" style={{ color: "var(--ch-sub)" }}>
          Nothing expiring or expired right now.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide" style={{ color: "var(--ch-sub)" }}>
                <th className="py-1.5 pr-3">Crew member</th>
                <th className="py-1.5 pr-3">Document</th>
                <th className="py-1.5 pr-3">Days</th>
                <th className="py-1.5 pr-3">Severity</th>
                <th className="py-1.5 pr-3">Status</th>
                {canManage && <th className="py-1.5 pr-3"></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t" style={{ borderColor: "var(--ch-line)" }}>
                  <td className="py-2 pr-3">
                    {r.crewName}
                    {r.businessCriticalSite && (
                      <span className="block text-[11px]" style={{ color: "var(--ch-sub)" }}>
                        Currently mobilized · {r.businessCriticalSite}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3">{r.documentTypeName}</td>
                  <td className="py-2 pr-3">
                    {r.daysRemaining == null ? "—" : r.daysRemaining < 0 ? `${Math.abs(r.daysRemaining)}d overdue` : `${r.daysRemaining}d`}
                  </td>
                  <td className="py-2 pr-3">
                    {pill(SEVERITY_LABELS[r.severity], SEVERITY_COLORS[r.severity].bg, SEVERITY_COLORS[r.severity].fg)}
                    {r.escalated && <span className="ml-1">{pill("Escalated", "#fbe0e0", "#b3261e")}</span>}
                  </td>
                  <td className="py-2 pr-3 capitalize">{r.status}</td>
                  {canManage && (
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {r.status === "open" && (
                        <button
                          className="text-xs font-semibold mr-3"
                          style={{ color: "var(--ch-navy)" }}
                          onClick={() => run(() => acknowledgeNotification(r.id))}
                        >
                          Acknowledge
                        </button>
                      )}
                      <button
                        className="text-xs font-semibold"
                        style={{ color: "var(--ch-sub)" }}
                        onClick={() => run(() => resolveNotification(r.id))}
                      >
                        Resolve
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
