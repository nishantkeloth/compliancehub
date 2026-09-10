"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createContract, deleteContract } from "./actions";
import { useOptimisticList, tempId, isTempId } from "@/lib/use-optimistic-list";

type Contract = {
  id: string;
  contract_code: string | null;
  contract_title: string;
  status: string;
  planned_start_date: string | null;
  planned_end_date: string | null;
  estimated_contract_value: number | null;
  client_name: string;
};

const inputCls = "border rounded-lg px-3 py-2 text-sm";
const inputStyle = { borderColor: "var(--ch-line)" };
const cardCls = "bg-white border rounded-xl";
const cardStyle = { borderColor: "var(--ch-line)" };

export const STATUS_PILLS: Record<string, { bg: string; fg: string }> = {
  draft: { bg: "var(--ch-paper)", fg: "var(--ch-sub)" },
  awarded: { bg: "var(--ch-navy-soft)", fg: "var(--ch-navy)" },
  mobilizing: { bg: "var(--ch-navy-soft)", fg: "var(--ch-navy)" },
  active: { bg: "var(--ch-pass-bg)", fg: "var(--ch-pass)" },
  suspended: { bg: "var(--ch-fail-bg)", fg: "var(--ch-fail)" },
  completed: { bg: "var(--ch-paper)", fg: "var(--ch-sub)" },
  cancelled: { bg: "var(--ch-fail-bg)", fg: "var(--ch-fail)" },
  planned: { bg: "var(--ch-paper)", fg: "var(--ch-sub)" },
  demobilizing: { bg: "var(--ch-navy-soft)", fg: "var(--ch-navy)" },
  // Crew matrix workflow statuses (app/crew/matrices)
  pending_internal_approval: { bg: "var(--ch-navy-soft)", fg: "var(--ch-navy)" },
  pending_client_approval: { bg: "var(--ch-navy-soft)", fg: "var(--ch-navy)" },
  approved: { bg: "var(--ch-pass-bg)", fg: "var(--ch-pass)" },
  superseded: { bg: "var(--ch-paper)", fg: "var(--ch-sub)" },
  rejected: { bg: "var(--ch-fail-bg)", fg: "var(--ch-fail)" },
  // Mobilization workflow statuses (app/mobilizations)
  planning: { bg: "var(--ch-navy-soft)", fg: "var(--ch-navy)" },
  compliance_review: { bg: "var(--ch-navy-soft)", fg: "var(--ch-navy)" },
  internal_approval: { bg: "var(--ch-navy-soft)", fg: "var(--ch-navy)" },
  client_approval: { bg: "var(--ch-navy-soft)", fg: "var(--ch-navy)" },
  travel_arrangement: { bg: "var(--ch-navy-soft)", fg: "var(--ch-navy)" },
  ready_to_mobilize: { bg: "var(--ch-pass-bg)", fg: "var(--ch-pass)" },
  in_transit: { bg: "var(--ch-pass-bg)", fg: "var(--ch-pass)" },
  partially_completed: { bg: "var(--ch-fail-bg)", fg: "var(--ch-fail)" },
};

export function StatusPill({ status }: { status: string }) {
  const colors = STATUS_PILLS[status] ?? STATUS_PILLS.draft;
  return (
    <span
      className="text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5"
      style={{ background: colors.bg, color: colors.fg }}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

function formatValue(v: number | null) {
  if (v == null) return null;
  return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default function ContractsManager({
  contracts,
  clients,
  canManage,
  canViewValue,
}: {
  contracts: Contract[];
  clients: { id: string; name: string }[];
  canManage: boolean;
  canViewValue: boolean;
}) {
  const router = useRouter();
  const { items, addOptimistic, removeOptimistic, restoreOptimistic } = useOptimisticList(contracts);
  const [, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [bgError, setBgError] = useState<string | null>(null);

  const submitCreate = (fd: FormData, optimisticItem: Contract) => {
    setBgError(null);
    addOptimistic(optimisticItem);
    setAdding(false);
    startTransition(async () => {
      const res = await createContract(fd);
      if (res?.error) {
        removeOptimistic(optimisticItem.id);
        setBgError(`Couldn't save "${optimisticItem.contract_title}": ${res.error}`);
        return;
      }
      if (res?.id) {
        router.push(`/contracts/${res.id}`);
        return;
      }
      router.refresh();
    });
  };

  const submitDelete = (contract: Contract, index: number) => {
    if (!window.confirm(`Delete "${contract.contract_title}"? This can't be undone.`)) return;
    setBgError(null);
    removeOptimistic(contract.id);
    startTransition(async () => {
      const res = await deleteContract(contract.id);
      if (res?.error) {
        restoreOptimistic(contract, index);
        setBgError(`Couldn't delete "${contract.contract_title}": ${res.error}`);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div>
      {bgError && (
        <div className="text-sm mb-4 rounded-lg px-3 py-2" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>
          {bgError}
        </div>
      )}

      {canManage &&
        (adding ? (
          <ContractForm
            clients={clients}
            onSubmit={(fd, values) =>
              submitCreate(fd, {
                id: tempId(),
                contract_code: null,
                ...values,
              })
            }
            onCancel={() => setAdding(false)}
          />
        ) : (
          <button onClick={() => setAdding(true)} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold mb-4">
            + Add contract
          </button>
        ))}

      <div className="space-y-2 mt-4">
        {items.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No contracts yet.</div>}
        {items.map((c, i) => (
          <div key={c.id} className={`${cardCls} p-3 flex items-center gap-3 flex-wrap`} style={cardStyle}>
            <div className="flex-1 min-w-[220px]">
              {c.contract_code && (
                <span
                  className="text-[10px] font-mono font-bold rounded px-1.5 py-0.5 mr-2"
                  style={{ background: "var(--ch-navy-soft)", color: "var(--ch-navy)" }}
                >
                  {c.contract_code}
                </span>
              )}
              {isTempId(c.id) ? (
                <span className="text-sm font-semibold" style={{ color: "var(--ch-ink)" }}>{c.contract_title}</span>
              ) : (
                <Link href={`/contracts/${c.id}`} className="text-sm font-semibold ch-link-navy">
                  {c.contract_title}
                </Link>
              )}
              <span className="ml-2">
                <StatusPill status={c.status} />
              </span>
              <span className="text-xs ml-2" style={{ color: "var(--ch-sub)" }}>{c.client_name}</span>
              {(c.planned_start_date || c.planned_end_date) && (
                <span className="text-xs ml-2" style={{ color: "var(--ch-sub)" }}>
                  {c.planned_start_date ?? "…"} – {c.planned_end_date ?? "…"}
                </span>
              )}
              {canViewValue && c.estimated_contract_value != null && (
                <span className="text-xs ml-2 font-semibold" style={{ color: "var(--ch-ink)" }}>
                  {formatValue(c.estimated_contract_value)}
                </span>
              )}
              {isTempId(c.id) && <span className="text-xs ml-2 italic" style={{ color: "var(--ch-sub)" }}>Saving…</span>}
            </div>
            {canManage && (
              <button
                onClick={() => submitDelete(c, i)}
                disabled={isTempId(c.id)}
                className="text-xs font-semibold disabled:opacity-40"
                style={{ color: "var(--ch-fail)" }}
              >
                Delete
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ContractForm({
  clients,
  onSubmit,
  onCancel,
}: {
  clients: { id: string; name: string }[];
  onSubmit: (fd: FormData, values: Omit<Contract, "id" | "contract_code">) => void;
  onCancel: () => void;
}) {
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [contractNumber, setContractNumber] = useState("");
  const [status, setStatus] = useState("draft");
  const [submitted, setSubmitted] = useState(false);

  const save = () => {
    if (!title.trim() || !clientId || submitted) return;
    const fd = new FormData();
    fd.set("clientId", clientId);
    fd.set("contractTitle", title.trim());
    fd.set("contractNumber", contractNumber.trim());
    fd.set("status", status);
    setSubmitted(true);
    onSubmit(fd, {
      contract_title: title.trim(),
      status,
      planned_start_date: null,
      planned_end_date: null,
      estimated_contract_value: null,
      client_name: clients.find((c) => c.id === clientId)?.name ?? "—",
    });
  };

  return (
    <div className={`${cardCls} p-4 mb-3`} style={cardStyle}>
      <div className="grid gap-3 sm:grid-cols-2 mb-3">
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Client
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={clientId} onChange={(e) => setClientId(e.target.value)}>
            {clients.length === 0 && <option value="">No clients yet</option>}
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Status
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value)}>
            {["draft", "awarded", "mobilizing", "active", "suspended", "completed", "cancelled"].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 mb-3">
        <input className={inputCls} style={inputStyle} placeholder="Contract title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input className={inputCls} style={inputStyle} placeholder="Contract number" value={contractNumber} onChange={(e) => setContractNumber(e.target.value)} />
      </div>
      <p className="text-xs mb-3" style={{ color: "var(--ch-sub)" }}>
        You&rsquo;ll fill in dates, value, service scope, and team on the contract page after saving.
      </p>
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={submitted || !title.trim() || !clientId} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
          Save
        </button>
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-line)" }}>Cancel</button>
      </div>
    </div>
  );
}
