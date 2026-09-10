"use client";

import { useState } from "react";
import Link from "next/link";
import { StatusPill } from "@/app/contracts/contracts-manager";

type Request = {
  id: string;
  mobilization_number: string | null;
  mobilization_type: string;
  status: string;
  priority: string;
  required_onboard_date: string;
  project_name: string;
  site_name: string;
};

const cardCls = "bg-white border rounded-xl";
const cardStyle = { borderColor: "var(--ch-line)" };

const PRIORITY_COLORS: Record<string, { bg: string; fg: string }> = {
  normal: { bg: "var(--ch-paper)", fg: "var(--ch-sub)" },
  urgent: { bg: "#fef3e2", fg: "#b45309" },
  emergency: { bg: "var(--ch-fail-bg)", fg: "var(--ch-fail)" },
};

function PriorityPill({ priority }: { priority: string }) {
  const colors = PRIORITY_COLORS[priority] ?? PRIORITY_COLORS.normal;
  if (priority === "normal") return null;
  return (
    <span className="text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5" style={{ background: colors.bg, color: colors.fg }}>
      {priority}
    </span>
  );
}

const STATUS_FILTERS = [
  "draft", "planning", "compliance_review", "internal_approval", "client_approval",
  "travel_arrangement", "ready_to_mobilize", "in_transit", "completed", "partially_completed", "cancelled",
];

export default function MobilizationsManager({ requests, canManage }: { requests: Request[]; canManage: boolean }) {
  const [statusFilter, setStatusFilter] = useState("");
  const filtered = statusFilter ? requests.filter((r) => r.status === statusFilter) : requests;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        {canManage && (
          <Link href="/mobilizations/new" className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold inline-block">
            + New mobilization request
          </Link>
        )}
        <select
          className="border rounded-lg px-3 py-2 text-sm"
          style={{ borderColor: "var(--ch-line)" }}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All statuses</option>
          {STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        {filtered.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No mobilization requests yet.</div>}
        {filtered.map((r) => (
          <Link key={r.id} href={`/mobilizations/${r.id}`} className={`${cardCls} p-3 flex items-center gap-3 flex-wrap block hover:opacity-80`} style={cardStyle}>
            {r.mobilization_number && (
              <span className="text-[10px] font-mono font-bold rounded px-1.5 py-0.5" style={{ background: "var(--ch-navy-soft)", color: "var(--ch-navy)" }}>
                {r.mobilization_number}
              </span>
            )}
            <span className="text-sm font-semibold" style={{ color: "var(--ch-ink)" }}>{r.mobilization_type.replace(/_/g, " ")}</span>
            <StatusPill status={r.status} />
            <PriorityPill priority={r.priority} />
            <span className="text-xs" style={{ color: "var(--ch-sub)" }}>{r.site_name} · {r.project_name}</span>
            <span className="text-xs" style={{ color: "var(--ch-sub)" }}>Onboard {r.required_onboard_date}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
