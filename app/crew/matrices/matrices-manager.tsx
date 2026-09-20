"use client";

import Link from "next/link";
import { StatusPill } from "@/app/contracts/contracts-manager";

type Matrix = {
  id: string;
  matrix_number: string | null;
  version_number: number;
  title: string;
  status: string;
  expected_pob: number | null;
  total_required_headcount: number;
  effective_from: string | null;
  effective_to: string | null;
  project_name: string;
  site_name: string;
};

const cardCls = "bg-white border rounded-xl";
const cardStyle = { borderColor: "var(--ch-line)" };

export default function MatricesManager({ matrices, canManage }: { matrices: Matrix[]; canManage: boolean }) {
  return (
    <div>
      {canManage && (
        <Link href="/crew/matrices/new" className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold mb-4 inline-block">
          + New crew matrix
        </Link>
      )}

      <div className="grid gap-4 mt-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {matrices.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No crew matrices yet.</div>}
        {matrices.map((m) => (
          <Link
            key={m.id}
            href={`/crew/matrices/${m.id}`}
            className={`${cardCls} p-4 flex flex-col gap-3 block hover:shadow-md transition-shadow`}
            style={cardStyle}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm font-semibold leading-snug" style={{ color: "var(--ch-ink)" }}>{m.title}</span>
              <StatusPill status={m.status} />
            </div>

            <div className="text-xs" style={{ color: "var(--ch-sub)" }}>
              {m.site_name} · {m.project_name}
            </div>

            <div className="grid grid-cols-2 gap-3 py-2 border-t border-b" style={{ borderColor: "var(--ch-line)" }}>
              <div>
                <div className="text-[10px] uppercase tracking-wide font-semibold" style={{ color: "var(--ch-sub)" }}>Expected POB</div>
                <div className="text-base font-bold" style={{ color: "var(--ch-navy)" }}>{m.expected_pob ?? "—"}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide font-semibold" style={{ color: "var(--ch-sub)" }}>Headcount req.</div>
                <div className="text-base font-bold" style={{ color: "var(--ch-navy)" }}>{m.total_required_headcount ?? "—"}</div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 flex-wrap">
              {m.matrix_number ? (
                <span className="text-[10px] font-mono font-bold rounded px-1.5 py-0.5" style={{ background: "var(--ch-navy-soft)", color: "var(--ch-navy)" }}>
                  {m.matrix_number} · v{m.version_number}
                </span>
              ) : <span />}
              {(m.effective_from || m.effective_to) && (
                <span className="text-[11px]" style={{ color: "var(--ch-sub)" }}>
                  {m.effective_from ?? "…"} – {m.effective_to ?? "…"}
                </span>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
