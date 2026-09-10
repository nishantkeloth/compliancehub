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

      <div className="space-y-2 mt-4">
        {matrices.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No crew matrices yet.</div>}
        {matrices.map((m) => (
          <Link key={m.id} href={`/crew/matrices/${m.id}`} className={`${cardCls} p-3 flex items-center gap-3 flex-wrap block hover:opacity-80`} style={cardStyle}>
            {m.matrix_number && (
              <span className="text-[10px] font-mono font-bold rounded px-1.5 py-0.5" style={{ background: "var(--ch-navy-soft)", color: "var(--ch-navy)" }}>
                {m.matrix_number} · v{m.version_number}
              </span>
            )}
            <span className="text-sm font-semibold" style={{ color: "var(--ch-ink)" }}>{m.title}</span>
            <StatusPill status={m.status} />
            <span className="text-xs" style={{ color: "var(--ch-sub)" }}>{m.site_name} · {m.project_name}</span>
            {m.expected_pob != null && <span className="text-xs" style={{ color: "var(--ch-sub)" }}>POB {m.expected_pob}</span>}
            {(m.effective_from || m.effective_to) && (
              <span className="text-xs" style={{ color: "var(--ch-sub)" }}>{m.effective_from ?? "…"} – {m.effective_to ?? "…"}</span>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
