"use client";

import { useState } from "react";
import Link from "next/link";
import { CONTAINER_STATUS_LABELS, OWNERSHIP_LABELS, fmtMoney } from "@/lib/containers";

export type ContainerRow = {
  id: string;
  code: string;
  type: string | null;
  ownership: string;
  currency: string;
  condition: string;
  location: string | null;
  status: string;
  nextInspectionDate: string | null;
  inspectionExpired: boolean;
  isActive: boolean;
  openProject: string | null;
  openVessel: string | null;
  movements: number;
  daysDeployed: number;
  utilizationPct: number;
  totalCost: number;
};
export type CostReportRow = { id: string; label: string; movements: number; days: number; rental: number; transport: number; port: number; handling: number; total: number };

const cardCls = "bg-white border rounded-xl";
const cardStyle = { borderColor: "var(--ch-line)" };

export const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  available: { bg: "var(--ch-pass-bg)", fg: "var(--ch-pass)" },
  reserved: { bg: "var(--ch-navy-soft)", fg: "var(--ch-navy)" },
  loading: { bg: "var(--ch-navy-soft)", fg: "var(--ch-navy)" },
  dispatched: { bg: "#fef3e2", fg: "#b45309" },
  in_transit: { bg: "#fef3e2", fg: "#b45309" },
  received_offshore: { bg: "var(--ch-pass-bg)", fg: "var(--ch-pass)" },
  in_use: { bg: "var(--ch-pass-bg)", fg: "var(--ch-pass)" },
  return_requested: { bg: "#fef3e2", fg: "#b45309" },
  returned: { bg: "var(--ch-paper)", fg: "var(--ch-sub)" },
  inspection: { bg: "var(--ch-fail-bg)", fg: "var(--ch-fail)" },
  cancelled: { bg: "var(--ch-paper)", fg: "var(--ch-sub)" },
};
export const CONDITION_COLORS: Record<string, { bg: string; fg: string }> = {
  good: { bg: "var(--ch-pass-bg)", fg: "var(--ch-pass)" },
  fair: { bg: "#fef3e2", fg: "#b45309" },
  damaged: { bg: "var(--ch-fail-bg)", fg: "var(--ch-fail)" },
  out_of_service: { bg: "var(--ch-fail-bg)", fg: "var(--ch-fail)" },
};

export function pill(text: string, colors: { bg: string; fg: string }) {
  return (
    <span className="text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5 whitespace-nowrap" style={{ background: colors.bg, color: colors.fg }}>
      {text}
    </span>
  );
}

export default function ContainersList({ rows, projectReport, siteReport, canManage }: { rows: ContainerRow[]; projectReport: CostReportRow[]; siteReport: CostReportRow[]; canManage: boolean }) {
  const [tab, setTab] = useState<"containers" | "report">("containers");
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [showRetired, setShowRetired] = useState(false);

  const filtered = rows.filter(
    (r) =>
      (showRetired || r.isActive) &&
      (!statusFilter || r.status === statusFilter) &&
      (!search.trim() || `${r.code} ${r.type ?? ""} ${r.location ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()))
  );

  const counts = {
    available: rows.filter((r) => r.isActive && r.status === "available").length,
    deployed: rows.filter((r) => r.isActive && ["dispatched", "in_transit", "received_offshore", "in_use", "return_requested"].includes(r.status)).length,
    inspection: rows.filter((r) => r.isActive && r.status === "inspection").length,
    expired: rows.filter((r) => r.isActive && r.inspectionExpired).length,
  };

  return (
    <div>
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-4 mb-4">
        {[
          ["Available", counts.available, "var(--ch-pass)"],
          ["Deployed", counts.deployed, "#b45309"],
          ["Awaiting inspection", counts.inspection, "var(--ch-fail)"],
          ["Inspection expired", counts.expired, counts.expired ? "var(--ch-fail)" : "var(--ch-sub)"],
        ].map(([label, value, color]) => (
          <div key={label as string} className={`${cardCls} p-3`} style={cardStyle}>
            <div className="text-[11px] font-bold uppercase tracking-wide" style={{ color: color as string }}>{label}</div>
            <div className="text-xl font-bold" style={{ color: "var(--ch-ink)" }}>{value}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-4">
        <div className="flex items-center gap-1 rounded-lg border p-1 bg-white" style={{ borderColor: "var(--ch-line)" }}>
          {(["containers", "report"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className="px-3.5 py-1.5 rounded-md text-xs font-semibold" style={tab === t ? { background: "var(--ch-navy)", color: "#fff" } : { color: "var(--ch-sub)" }}>
              {t === "containers" ? "Containers" : "Cost by project / vessel"}
            </button>
          ))}
        </div>
        {tab === "containers" && (
          <>
            <input className="border rounded-lg px-3 py-2 text-sm w-44" style={{ borderColor: "var(--ch-line)" }} placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select className="border rounded-lg px-3 py-2 text-sm" style={{ borderColor: "var(--ch-line)" }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              {Object.entries(CONTAINER_STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <label className="text-xs flex items-center gap-1" style={{ color: "var(--ch-sub)" }}>
              <input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} /> Show retired
            </label>
          </>
        )}
        <div className="flex-1" />
        {canManage && (
          <Link href="/containers/new" className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold inline-block">+ New container</Link>
        )}
      </div>

      {tab === "containers" && (
        <div className="space-y-2">
          {filtered.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No containers match.</div>}
          {filtered.map((r) => (
            <Link key={r.id} href={`/containers/${r.id}`} className={`${cardCls} p-3 block hover:bg-gray-50`} style={cardStyle}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono font-bold text-sm" style={{ color: "var(--ch-navy)" }}>{r.code}</span>
                {r.type && <span className="text-xs" style={{ color: "var(--ch-sub)" }}>{r.type}</span>}
                {pill(CONTAINER_STATUS_LABELS[r.status] ?? r.status, STATUS_COLORS[r.status] ?? STATUS_COLORS.returned)}
                {r.condition !== "good" && pill(r.condition.replace(/_/g, " "), CONDITION_COLORS[r.condition] ?? CONDITION_COLORS.fair)}
                {r.inspectionExpired && pill("inspection expired", CONDITION_COLORS.damaged)}
                {!r.isActive && pill("retired", STATUS_COLORS.returned)}
                <span className="text-xs ml-auto" style={{ color: "var(--ch-sub)" }}>{OWNERSHIP_LABELS[r.ownership] ?? r.ownership}</span>
              </div>
              <div className="text-xs mt-1 grid gap-0.5 sm:grid-cols-3" style={{ color: "var(--ch-sub)" }}>
                <div>Location: <b style={{ color: "var(--ch-ink)" }}>{r.location ?? "—"}</b></div>
                <div>{r.openProject ? <>On: <b style={{ color: "var(--ch-ink)" }}>{r.openProject}</b>{r.openVessel ? ` · ${r.openVessel}` : ""}</> : <>Next inspection: {r.nextInspectionDate ?? "—"}</>}</div>
                <div>{r.movements} mov · {r.daysDeployed}d deployed · {r.utilizationPct}% util · {fmtMoney(r.totalCost, r.currency)}</div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {tab === "report" && (
        <div className="space-y-4">
          <ReportTable title="Cost by project" rows={projectReport} />
          <ReportTable title="Cost by vessel" rows={siteReport} />
          <p className="text-xs" style={{ color: "var(--ch-sub)" }}>
            Each movement&rsquo;s shipping, customs/port and handling costs plus its share of rental (rented containers only, by deployed days). Maintenance is a container-level cost and isn&rsquo;t attributed here.
          </p>
        </div>
      )}
    </div>
  );
}

function ReportTable({ title, rows }: { title: string; rows: CostReportRow[] }) {
  const sorted = [...rows].sort((a, b) => b.total - a.total);
  return (
    <div className={`${cardCls} p-4`} style={cardStyle}>
      <div className="text-sm font-bold mb-2" style={{ color: "var(--ch-ink)" }}>{title}</div>
      {sorted.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No movements yet.</div>}
      {sorted.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table className="text-xs w-full min-w-[640px]">
            <thead>
              <tr style={{ color: "var(--ch-sub)" }}>
                <th className="text-left py-1 font-semibold">Name</th>
                <th className="text-right py-1 font-semibold">Movements</th>
                <th className="text-right py-1 font-semibold">Days</th>
                <th className="text-right py-1 font-semibold">Rental</th>
                <th className="text-right py-1 font-semibold">Transport</th>
                <th className="text-right py-1 font-semibold">Port/customs</th>
                <th className="text-right py-1 font-semibold">Handling</th>
                <th className="text-right py-1 font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id} className="border-t" style={{ borderColor: "var(--ch-line)", color: "var(--ch-ink)" }}>
                  <td className="py-1.5 font-semibold">{r.label}</td>
                  <td className="py-1.5 text-right">{r.movements}</td>
                  <td className="py-1.5 text-right">{r.days}</td>
                  <td className="py-1.5 text-right">{fmtMoney(r.rental)}</td>
                  <td className="py-1.5 text-right">{fmtMoney(r.transport)}</td>
                  <td className="py-1.5 text-right">{fmtMoney(r.port)}</td>
                  <td className="py-1.5 text-right">{fmtMoney(r.handling)}</td>
                  <td className="py-1.5 text-right font-bold">{fmtMoney(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
