"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createContract, deleteContract } from "./actions";
import { useOptimisticList, tempId, isTempId } from "@/lib/use-optimistic-list";
import { useGuideMaybe } from "@/components/guide/guide-context";

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
const lbl = "text-xs";
const lblStyle = { color: "var(--ch-sub)" };

// Same statuses as the detail page's edit form (app/contracts/[id]/contract-detail.tsx)
// — kept in sync manually since the enum also lives in the DB check constraint.
const CONTRACT_STATUSES = ["draft", "awarded", "mobilizing", "active", "suspended", "completed", "cancelled"];

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
  pending_approval: { bg: "var(--ch-navy-soft)", fg: "var(--ch-navy)" },
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
  members,
  canManage,
  canViewValue,
}: {
  contracts: Contract[];
  clients: { id: string; name: string }[];
  members: { id: string; full_name: string }[];
  canManage: boolean;
  canViewValue: boolean;
}) {
  const router = useRouter();
  const { items, addOptimistic, removeOptimistic, restoreOptimistic } = useOptimisticList(contracts);
  const [, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [bgError, setBgError] = useState<string | null>(null);
  const guide = useGuideMaybe();

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
      // Real completion event — only fired after the server action
      // actually returns a saved record id. If a Guided Workflows step is
      // waiting on "contract.saved", it takes over navigation from here
      // (on to /projects); otherwise this falls through to the normal
      // "go to the contract I just created" behavior.
      const guided = res?.id ? guide?.notifyCompletion("contract.saved", { recordId: res.id }) : false;
      if (res?.id && !guided) {
        router.push(`/contracts/${res.id}`);
        return;
      }
      if (!guided) router.refresh();
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
            members={members}
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
          <button
            onClick={() => setAdding(true)}
            data-guide-id="contracts.new-button"
            className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold mb-4"
          >
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

// Every field a contract can carry is shown from the moment it's created —
// not just a starter subset the user has to come back and fill in later via
// Edit. The five marked with a red star (Client, Status, Contract title,
// Planned start, Planned end) are the minimum a contract needs to be usable
// elsewhere in the app (expiry warnings, mobilization-notice calculations,
// reporting) and are the ones Guided Workflows' field-walk (registry.ts
// contract.create step) stops on in order; everything else stays optional
// and fillable now or later from the contract's own page.
function ContractForm({
  clients,
  members,
  onSubmit,
  onCancel,
}: {
  clients: { id: string; name: string }[];
  members: { id: string; full_name: string }[];
  onSubmit: (fd: FormData, values: Omit<Contract, "id" | "contract_code">) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState({
    clientId: "",
    status: "",
    contractNumber: "",
    contractTitle: "",
    awardDate: "",
    plannedStartDate: "",
    plannedEndDate: "",
    actualStartDate: "",
    actualEndDate: "",
    currency: "",
    estimatedContractValue: "",
    billingModel: "",
    mobilizationNoticeDays: "",
    paymentTerms: "",
    contractManagerUserId: "",
    operationsManagerUserId: "",
    description: "",
    notes: "",
  });
  const [submitted, setSubmitted] = useState(false);
  const set = (k: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));

  const isValid =
    values.clientId &&
    values.status &&
    values.contractTitle.trim() &&
    values.plannedStartDate &&
    values.plannedEndDate;

  const save = () => {
    if (!isValid || submitted) return;
    const fd = new FormData();
    Object.entries(values).forEach(([k, v]) => fd.set(k, v));
    setSubmitted(true);
    onSubmit(fd, {
      contract_title: values.contractTitle.trim(),
      status: values.status,
      planned_start_date: values.plannedStartDate || null,
      planned_end_date: values.plannedEndDate || null,
      estimated_contract_value: values.estimatedContractValue ? Number(values.estimatedContractValue) : null,
      client_name: clients.find((c) => c.id === values.clientId)?.name ?? "—",
    });
  };

  const field = (label: string, key: keyof typeof values, type = "text", required = false, guideId?: string) => (
    <label className={lbl} style={lblStyle} data-guide-id={guideId}>
      {label} {required && <span style={{ color: "var(--ch-fail)" }}>*</span>}
      <input type={type} className={`${inputCls} w-full mt-1`} style={inputStyle} value={values[key]} onChange={set(key)} />
    </label>
  );

  return (
    <div className={`${cardCls} p-4 mb-3`} style={cardStyle}>
      <div className="grid gap-3 sm:grid-cols-3 mb-3">
        <label className="text-xs" style={{ color: "var(--ch-sub)" }} data-guide-id="contracts.form.client">
          Client <span style={{ color: "var(--ch-fail)" }}>*</span>
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={values.clientId} onChange={set("clientId")}>
            <option value="">{clients.length === 0 ? "No clients yet" : "Select a client…"}</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }} data-guide-id="contracts.form.status">
          Status <span style={{ color: "var(--ch-fail)" }}>*</span>
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={values.status} onChange={set("status")}>
            <option value="">Select status…</option>
            {CONTRACT_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        {field("Contract number", "contractNumber")}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 mb-3">
        <label className={lbl} style={lblStyle} data-guide-id="contracts.form.title">
          Contract title <span style={{ color: "var(--ch-fail)" }}>*</span>
          <input className={`${inputCls} w-full mt-1`} style={inputStyle} value={values.contractTitle} onChange={set("contractTitle")} />
        </label>
        {field("Award date", "awardDate", "date")}
      </div>
      <div className="grid gap-3 sm:grid-cols-4 mb-3">
        {field("Planned start", "plannedStartDate", "date", true, "contracts.form.planned-start")}
        {field("Planned end", "plannedEndDate", "date", true, "contracts.form.planned-end")}
        {field("Actual start", "actualStartDate", "date")}
        {field("Actual end", "actualEndDate", "date")}
      </div>
      <div className="grid gap-3 sm:grid-cols-4 mb-3">
        {field("Currency", "currency")}
        {field("Estimated value", "estimatedContractValue", "number")}
        {field("Billing model", "billingModel")}
        {field("Mobilization notice (days)", "mobilizationNoticeDays", "number")}
      </div>
      <div className="grid gap-3 sm:grid-cols-3 mb-3">
        {field("Payment terms", "paymentTerms")}
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Contract manager
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={values.contractManagerUserId} onChange={set("contractManagerUserId")}>
            <option value="">—</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.full_name}</option>
            ))}
          </select>
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Operations manager
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={values.operationsManagerUserId} onChange={set("operationsManagerUserId")}>
            <option value="">—</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.full_name}</option>
            ))}
          </select>
        </label>
      </div>
      <label className={`${lbl} block mb-3`} style={lblStyle}>
        Description
        <textarea className={`${inputCls} w-full mt-1`} style={inputStyle} rows={2} value={values.description} onChange={set("description")} />
      </label>
      <label className={`${lbl} block mb-3`} style={lblStyle}>
        Notes
        <textarea className={`${inputCls} w-full mt-1`} style={inputStyle} rows={2} value={values.notes} onChange={set("notes")} />
      </label>
      <div className="flex items-center gap-2">
        <button
          onClick={save}
          disabled={submitted || !isValid}
          data-guide-id="contracts.form.save"
          className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          Save
        </button>
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-line)" }}>Cancel</button>
      </div>
    </div>
  );
}
