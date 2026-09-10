"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  updateContract,
  deleteContract,
  addContractService,
  removeContractService,
  addContractDocument,
  deleteContractDocument,
} from "../actions";
import { StatusPill } from "../contracts-manager";

type Contract = {
  id: string;
  contract_code: string | null;
  contract_number: string | null;
  contract_title: string;
  description: string | null;
  award_date: string | null;
  planned_start_date: string | null;
  planned_end_date: string | null;
  actual_start_date: string | null;
  actual_end_date: string | null;
  currency: string | null;
  estimated_contract_value: number | null;
  billing_model: string | null;
  payment_terms: string | null;
  mobilization_notice_days: number | null;
  contract_manager_user_id: string | null;
  operations_manager_user_id: string | null;
  status: string;
  notes: string | null;
  client_id: string;
  client_name: string;
};
type ProjectRow = { id: string; project_code: string | null; project_name: string; status: string; contractor_name: string };
type DocRow = { id: string; title: string; document_url: string | null; notes: string | null; created_at: string };
type HistoryRow = { id: string; old_status: string | null; new_status: string; changed_at: string };
type Ref = { id: string; name: string };
type Member = { id: string; full_name: string };

const CONTRACT_STATUSES = ["draft", "awarded", "mobilizing", "active", "suspended", "completed", "cancelled"];
const SERVICE_OPTIONS = [
  { key: "catering", label: "Catering" },
  { key: "housekeeping", label: "Housekeeping" },
  { key: "laundry", label: "Laundry" },
  { key: "provision_supply", label: "Provision supply" },
  { key: "equipment_supply", label: "Equipment supply" },
  { key: "camp_management", label: "Camp management" },
  { key: "waste_management", label: "Waste management" },
  { key: "container_logistics_support", label: "Container/logistics support" },
  { key: "other", label: "Other" },
];

const inputCls = "border rounded-lg px-3 py-2 text-sm";
const inputStyle = { borderColor: "var(--ch-line)" };
const cardCls = "bg-white border rounded-xl";
const cardStyle = { borderColor: "var(--ch-line)" };

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + "T00:00:00");
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

export default function ContractDetail({
  contract,
  services,
  projects,
  contractors,
  documents,
  history,
  clients,
  members,
  canManage,
  canViewValue,
}: {
  contract: Contract;
  services: string[];
  projects: ProjectRow[];
  contractors: Ref[];
  documents: DocRow[];
  history: HistoryRow[];
  clients: Ref[];
  members: Member[];
  canManage: boolean;
  canViewValue: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [tab, setTab] = useState<"overview" | "services" | "projects" | "contractors" | "documents" | "history">("overview");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const expiryDate = contract.actual_end_date ?? contract.planned_end_date;
  const daysLeft = daysUntil(expiryDate);
  const expiryThreshold = contract.mobilization_notice_days ?? 30;
  const showExpiryWarning =
    daysLeft != null && !["completed", "cancelled"].includes(contract.status) && daysLeft <= expiryThreshold;

  const tabs: { key: typeof tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "services", label: "Service Scope" },
    { key: "projects", label: `Projects (${projects.length})` },
    { key: "contractors", label: `Contractors (${contractors.length})` },
    { key: "documents", label: `Documents (${documents.length})` },
    { key: "history", label: "Status History" },
  ];

  const submitDelete = () => {
    if (!window.confirm(`Delete "${contract.contract_title}"? This can't be undone.`)) return;
    startTransition(async () => {
      const res = await deleteContract(contract.id);
      if (res?.error) {
        setError(res.error);
        return;
      }
      router.push("/contracts");
    });
  };

  return (
    <div>
      <div className="mb-4 flex items-center gap-2 flex-wrap">
        <Link href="/contracts" className="text-xs font-semibold ch-link-navy">← All contracts</Link>
      </div>

      <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            {contract.contract_code && (
              <span className="text-[10px] font-mono font-bold rounded px-1.5 py-0.5" style={{ background: "var(--ch-navy-soft)", color: "var(--ch-navy)" }}>
                {contract.contract_code}
              </span>
            )}
            <h1 className="text-lg font-semibold" style={{ color: "var(--ch-ink)" }}>{contract.contract_title}</h1>
            <StatusPill status={contract.status} />
          </div>
          <div className="text-xs mt-1" style={{ color: "var(--ch-sub)" }}>
            Client: <Link href="/crew/clients" className="ch-link-navy">{contract.client_name}</Link>
          </div>
        </div>
        {canManage && !editing && (
          <div className="flex items-center gap-2">
            <button onClick={() => setEditing(true)} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold">Edit</button>
            <button onClick={submitDelete} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-fail)", color: "var(--ch-fail)" }}>
              Delete
            </button>
          </div>
        )}
      </div>

      {showExpiryWarning && (
        <div className="text-sm mb-4 rounded-lg px-3 py-2" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>
          {daysLeft! < 0
            ? `This contract's end date was ${Math.abs(daysLeft!)} day${Math.abs(daysLeft!) === 1 ? "" : "s"} ago.`
            : `This contract ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"} (${expiryDate}).`}
        </div>
      )}
      {error && (
        <div className="text-sm mb-4 rounded-lg px-3 py-2" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>{error}</div>
      )}

      <div className="flex gap-1.5 flex-wrap mb-4 border-b pb-2" style={{ borderColor: "var(--ch-line)" }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="text-xs font-semibold rounded-lg px-3 py-1.5"
            style={
              tab === t.key
                ? { background: "var(--ch-navy)", color: "#fff" }
                : { background: "var(--ch-paper)", color: "var(--ch-sub)" }
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" &&
        (editing ? (
          <ContractForm
            contract={contract}
            clients={clients}
            members={members}
            onCancel={() => setEditing(false)}
            onSubmit={(fd) => {
              setError(null);
              setEditing(false);
              startTransition(async () => {
                const res = await updateContract(contract.id, fd);
                if (res?.error) {
                  setError(res.error);
                  setEditing(true);
                  return;
                }
                router.refresh();
              });
            }}
          />
        ) : (
          <OverviewPanel contract={contract} members={members} canViewValue={canViewValue} />
        ))}

      {tab === "services" && (
        <ServicesPanel
          contractId={contract.id}
          selected={services}
          canManage={canManage}
          onChange={() => router.refresh()}
        />
      )}

      {tab === "projects" && (
        <div className="space-y-2">
          {canManage && (
            <Link href={`/projects?contractId=${contract.id}`} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold inline-block mb-2">
              + Add project under this contract
            </Link>
          )}
          {projects.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No projects yet.</div>}
          {projects.map((p) => (
            <div key={p.id} className={`${cardCls} p-3 flex items-center gap-3 flex-wrap`} style={cardStyle}>
              {p.project_code && (
                <span className="text-[10px] font-mono font-bold rounded px-1.5 py-0.5" style={{ background: "var(--ch-navy-soft)", color: "var(--ch-navy)" }}>
                  {p.project_code}
                </span>
              )}
              <Link href={`/projects/${p.id}`} className="text-sm font-semibold ch-link-navy">{p.project_name}</Link>
              <StatusPill status={p.status} />
              <span className="text-xs" style={{ color: "var(--ch-sub)" }}>{p.contractor_name}</span>
            </div>
          ))}
        </div>
      )}

      {tab === "contractors" && (
        <div className="space-y-2">
          {contractors.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No contractors assigned yet — they appear here once a project under this contract is assigned one.</div>}
          {contractors.map((c) => (
            <div key={c.id} className={`${cardCls} p-3`} style={cardStyle}>
              <span className="text-sm font-semibold" style={{ color: "var(--ch-ink)" }}>{c.name}</span>
            </div>
          ))}
        </div>
      )}

      {tab === "documents" && (
        <DocumentsPanel contractId={contract.id} documents={documents} canManage={canManage} onChange={() => router.refresh()} />
      )}

      {tab === "history" && (
        <div className="space-y-2">
          {history.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No status changes recorded yet.</div>}
          {history.map((h) => (
            <div key={h.id} className={`${cardCls} p-3 flex items-center gap-2 flex-wrap text-sm`} style={cardStyle}>
              <span style={{ color: "var(--ch-sub)" }}>{new Date(h.changed_at).toLocaleString()}</span>
              <span>{h.old_status ?? "—"} → <strong>{h.new_status}</strong></span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function memberName(members: Member[], id: string | null) {
  if (!id) return "—";
  return members.find((m) => m.id === id)?.full_name ?? "—";
}

function OverviewPanel({ contract, members, canViewValue }: { contract: Contract; members: Member[]; canViewValue: boolean }) {
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex items-center justify-between gap-3 py-1.5 border-b last:border-0" style={{ borderColor: "var(--ch-line)" }}>
      <span className="text-xs" style={{ color: "var(--ch-sub)" }}>{label}</span>
      <span className="text-sm text-right" style={{ color: "var(--ch-ink)" }}>{value ?? "—"}</span>
    </div>
  );
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className={`${cardCls} p-4`} style={cardStyle}>
        <div className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: "var(--ch-sub)" }}>Commercial</div>
        {row("Contract number", contract.contract_number)}
        {row("Award date", contract.award_date)}
        {row("Planned dates", `${contract.planned_start_date ?? "…"} – ${contract.planned_end_date ?? "…"}`)}
        {row("Actual dates", `${contract.actual_start_date ?? "…"} – ${contract.actual_end_date ?? "…"}`)}
        {row("Billing model", contract.billing_model)}
        {row("Payment terms", contract.payment_terms)}
        {row("Mobilization notice", contract.mobilization_notice_days != null ? `${contract.mobilization_notice_days} days` : null)}
        {canViewValue
          ? row(
              "Estimated value",
              contract.estimated_contract_value != null
                ? `${contract.currency ?? ""} ${contract.estimated_contract_value.toLocaleString()}`.trim()
                : null
            )
          : row("Estimated value", <span className="italic" style={{ color: "var(--ch-sub)" }}>Restricted</span>)}
      </div>
      <div className={`${cardCls} p-4`} style={cardStyle}>
        <div className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: "var(--ch-sub)" }}>Team & notes</div>
        {row("Contract manager", memberName(members, contract.contract_manager_user_id))}
        {row("Operations manager", memberName(members, contract.operations_manager_user_id))}
        {contract.description && (
          <div className="mt-3">
            <div className="text-xs mb-1" style={{ color: "var(--ch-sub)" }}>Description</div>
            <div className="text-sm whitespace-pre-wrap" style={{ color: "var(--ch-ink)" }}>{contract.description}</div>
          </div>
        )}
        {contract.notes && (
          <div className="mt-3">
            <div className="text-xs mb-1" style={{ color: "var(--ch-sub)" }}>Notes</div>
            <div className="text-sm whitespace-pre-wrap" style={{ color: "var(--ch-ink)" }}>{contract.notes}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function ContractForm({
  contract,
  clients,
  members,
  onSubmit,
  onCancel,
}: {
  contract: Contract;
  clients: Ref[];
  members: Member[];
  onSubmit: (fd: FormData) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState({
    clientId: contract.client_id,
    contractTitle: contract.contract_title,
    contractNumber: contract.contract_number ?? "",
    description: contract.description ?? "",
    awardDate: contract.award_date ?? "",
    plannedStartDate: contract.planned_start_date ?? "",
    plannedEndDate: contract.planned_end_date ?? "",
    actualStartDate: contract.actual_start_date ?? "",
    actualEndDate: contract.actual_end_date ?? "",
    currency: contract.currency ?? "",
    estimatedContractValue: contract.estimated_contract_value?.toString() ?? "",
    billingModel: contract.billing_model ?? "",
    paymentTerms: contract.payment_terms ?? "",
    mobilizationNoticeDays: contract.mobilization_notice_days?.toString() ?? "",
    contractManagerUserId: contract.contract_manager_user_id ?? "",
    operationsManagerUserId: contract.operations_manager_user_id ?? "",
    status: contract.status,
    notes: contract.notes ?? "",
  });
  const [submitted, setSubmitted] = useState(false);
  const set = (k: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));

  const save = () => {
    if (!values.contractTitle.trim() || !values.clientId || submitted) return;
    const fd = new FormData();
    Object.entries(values).forEach(([k, v]) => fd.set(k, v));
    setSubmitted(true);
    onSubmit(fd);
  };

  const field = (label: string, key: keyof typeof values, type = "text") => (
    <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
      {label}
      <input type={type} className={`${inputCls} w-full mt-1`} style={inputStyle} value={values[key]} onChange={set(key)} />
    </label>
  );

  return (
    <div className={`${cardCls} p-4`} style={cardStyle}>
      <div className="grid gap-3 sm:grid-cols-3 mb-3">
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Client
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={values.clientId} onChange={set("clientId")}>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Status
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={values.status} onChange={set("status")}>
            {CONTRACT_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        {field("Contract number", "contractNumber")}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 mb-3">
        <input className={inputCls} style={inputStyle} placeholder="Contract title" value={values.contractTitle} onChange={set("contractTitle")} />
        {field("Award date", "awardDate", "date")}
      </div>
      <div className="grid gap-3 sm:grid-cols-4 mb-3">
        {field("Planned start", "plannedStartDate", "date")}
        {field("Planned end", "plannedEndDate", "date")}
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
      <textarea className={`${inputCls} w-full mb-3`} style={inputStyle} placeholder="Description" rows={2} value={values.description} onChange={set("description")} />
      <textarea className={`${inputCls} w-full mb-3`} style={inputStyle} placeholder="Notes" rows={2} value={values.notes} onChange={set("notes")} />
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={submitted || !values.contractTitle.trim()} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
          Save
        </button>
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-line)" }}>Cancel</button>
      </div>
    </div>
  );
}

function ServicesPanel({
  contractId,
  selected,
  canManage,
  onChange,
}: {
  contractId: string;
  selected: string[];
  canManage: boolean;
  onChange: () => void;
}) {
  const [, startTransition] = useTransition();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = (service: string, isOn: boolean) => {
    if (!canManage) return;
    setError(null);
    setPending(service);
    startTransition(async () => {
      const res = isOn ? await removeContractService(contractId, service) : await addContractService(contractId, service);
      setPending(null);
      if (res?.error) {
        setError(res.error);
        return;
      }
      onChange();
    });
  };

  return (
    <div className={`${cardCls} p-4`} style={cardStyle}>
      {error && <div className="text-sm mb-3" style={{ color: "var(--ch-fail)" }}>{error}</div>}
      <div className="grid gap-2 sm:grid-cols-2">
        {SERVICE_OPTIONS.map((opt) => {
          const isOn = selected.includes(opt.key);
          return (
            <label key={opt.key} className="flex items-center gap-2 text-sm" style={{ color: "var(--ch-ink)" }}>
              <input
                type="checkbox"
                checked={isOn}
                disabled={!canManage || pending === opt.key}
                onChange={() => toggle(opt.key, isOn)}
              />
              {opt.label}
            </label>
          );
        })}
      </div>
    </div>
  );
}

function DocumentsPanel({
  contractId,
  documents,
  canManage,
  onChange,
}: {
  contractId: string;
  documents: DocRow[];
  canManage: boolean;
  onChange: () => void;
}) {
  const [, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    if (!title.trim() || !url.trim()) return;
    const fd = new FormData();
    fd.set("title", title.trim());
    fd.set("documentUrl", url.trim());
    fd.set("notes", notes.trim());
    setError(null);
    startTransition(async () => {
      const res = await addContractDocument(contractId, fd);
      if (res?.error) {
        setError(res.error);
        return;
      }
      setTitle("");
      setUrl("");
      setNotes("");
      setAdding(false);
      onChange();
    });
  };

  const remove = (id: string) => {
    if (!window.confirm("Remove this document?")) return;
    startTransition(async () => {
      const res = await deleteContractDocument(id, contractId);
      if (res?.error) {
        setError(res.error);
        return;
      }
      onChange();
    });
  };

  return (
    <div className="space-y-2">
      {error && <div className="text-sm" style={{ color: "var(--ch-fail)" }}>{error}</div>}
      {canManage &&
        (adding ? (
          <div className={`${cardCls} p-4`} style={cardStyle}>
            <div className="grid gap-3 sm:grid-cols-2 mb-3">
              <input className={inputCls} style={inputStyle} placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
              <input className={inputCls} style={inputStyle} placeholder="Link / URL" value={url} onChange={(e) => setUrl(e.target.value)} />
            </div>
            <textarea className={`${inputCls} w-full mb-3`} style={inputStyle} placeholder="Notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            <div className="flex items-center gap-2">
              <button onClick={add} disabled={!title.trim() || !url.trim()} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">Save</button>
              <button onClick={() => setAdding(false)} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-line)" }}>Cancel</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold">+ Add document link</button>
        ))}
      {documents.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No documents linked yet.</div>}
      {documents.map((d) => (
        <div key={d.id} className={`${cardCls} p-3 flex items-center gap-3 flex-wrap`} style={cardStyle}>
          <div className="flex-1 min-w-[200px]">
            {d.document_url ? (
              <a href={d.document_url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold ch-link-navy">{d.title}</a>
            ) : (
              <span className="text-sm font-semibold" style={{ color: "var(--ch-ink)" }}>{d.title}</span>
            )}
            {d.notes && <span className="text-xs ml-2" style={{ color: "var(--ch-sub)" }}>{d.notes}</span>}
          </div>
          {canManage && (
            <button onClick={() => remove(d.id)} className="text-xs font-semibold" style={{ color: "var(--ch-fail)" }}>Remove</button>
          )}
        </div>
      ))}
    </div>
  );
}
