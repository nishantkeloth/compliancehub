"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { StatusPill } from "@/app/contracts/contracts-manager";
import { deleteAllCrewMatrices } from "./actions";

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

const CONFIRM_PHRASE = "DELETE ALL";

function DeleteAllPanel({ count }: { count: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ deletedMatrices: number; releasedCrew: number } | null>(null);

  if (result) {
    return (
      <div className="text-sm rounded-lg px-3 py-2 mb-4" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>
        Deleted {result.deletedMatrices} crew matrix{result.deletedMatrices === 1 ? "" : "es"} and released {result.releasedCrew} crew
        assignment{result.releasedCrew === 1 ? "" : "s"}.
      </div>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg px-4 py-2 text-sm font-semibold border mb-4"
        style={{ borderColor: "var(--ch-fail)", color: "var(--ch-fail)" }}
      >
        Delete all crew matrices…
      </button>
    );
  }

  const confirmed = confirmText.trim() === CONFIRM_PHRASE;

  const run = () => {
    if (!confirmed || busy) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteAllCrewMatrices();
      if (res.error) {
        setError(res.error);
        return;
      }
      setResult({ deletedMatrices: res.deletedMatrices, releasedCrew: res.releasedCrew });
      router.refresh();
    });
  };

  return (
    <div className="rounded-lg border p-3 mb-4" style={{ borderColor: "var(--ch-fail)", background: "var(--ch-fail-bg)" }}>
      <div className="text-sm font-semibold mb-1" style={{ color: "var(--ch-fail)" }}>
        Delete all {count} crew matrix{count === 1 ? "" : "es"}?
      </div>
      <div className="text-xs mb-3" style={{ color: "var(--ch-fail)" }}>
        This deletes every crew matrix in the company — draft, submitted, approved and active — with all their manning
        lines, documents, sharing history, mobilization requests and approval history. Any crew currently assigned at a
        site covered by one of these matrices is released (marked onshore) at the same time. This can&rsquo;t be undone.
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-xs" style={{ color: "var(--ch-fail)" }}>
          Type <span className="font-mono font-bold">{CONFIRM_PHRASE}</span> to confirm
        </label>
        <input
          className="border rounded-lg px-3 py-1.5 text-sm"
          style={{ borderColor: "var(--ch-fail)" }}
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={CONFIRM_PHRASE}
        />
        <button
          onClick={run}
          disabled={!confirmed || busy}
          className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: "var(--ch-fail)" }}
        >
          {busy ? "Deleting…" : "Permanently delete all"}
        </button>
        <button
          onClick={() => {
            setOpen(false);
            setConfirmText("");
            setError(null);
          }}
          disabled={busy}
          className="rounded-lg px-4 py-2 text-sm font-semibold border disabled:opacity-50"
          style={{ borderColor: "var(--ch-line)" }}
        >
          Cancel
        </button>
      </div>
      {error && (
        <div className="text-xs mt-2 font-semibold" style={{ color: "var(--ch-fail)" }}>
          {error}
        </div>
      )}
    </div>
  );
}

export default function MatricesManager({ matrices, canManage }: { matrices: Matrix[]; canManage: boolean }) {
  return (
    <div>
      {canManage && (
        <Link href="/crew/matrices/new" className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold mb-4 mr-3 inline-block">
          + New crew matrix
        </Link>
      )}
      {canManage && matrices.length > 0 && <DeleteAllPanel count={matrices.length} />}

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
