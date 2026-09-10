"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient_, updateClient, deleteClient } from "./actions";

type Client = {
  id: string;
  name: string;
  code: string | null;
  contract_number: string | null;
  contract_start_date: string | null;
  contract_end_date: string | null;
  billing_model: string | null;
  notes: string | null;
  is_active: boolean;
};

const inputCls = "border rounded-lg px-3 py-2 text-sm";
const inputStyle = { borderColor: "var(--ch-line)" };
const cardCls = "bg-white border rounded-xl";
const cardStyle = { borderColor: "var(--ch-line)" };

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="text-xs mt-1.5" style={{ color: "var(--ch-fail)" }}>
      {error}
    </div>
  );
}

function DeleteButton({ onDelete, label }: { onDelete: () => Promise<any>; label: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      onClick={() => {
        if (!window.confirm(`Delete this ${label}?`)) return;
        startTransition(async () => {
          await onDelete();
        });
      }}
      disabled={pending}
      className="text-xs font-semibold disabled:opacity-50"
      style={{ color: "var(--ch-fail)" }}
    >
      Delete
    </button>
  );
}

export default function ClientsManager({ clients }: { clients: Client[] }) {
  const router = useRouter();
  const onChanged = () => router.refresh();

  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div>
      {adding ? (
        <ClientForm onDone={() => { setAdding(false); onChanged(); }} onCancel={() => setAdding(false)} />
      ) : (
        <button onClick={() => setAdding(true)} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold mb-4">+ Add client</button>
      )}

      <div className="space-y-2 mt-4">
        {clients.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No clients yet.</div>}
        {clients.map((c) =>
          editingId === c.id ? (
            <ClientForm key={c.id} client={c} onDone={() => { setEditingId(null); onChanged(); }} onCancel={() => setEditingId(null)} />
          ) : (
            <div key={c.id} className={`${cardCls} p-3 flex items-center gap-3 flex-wrap`} style={cardStyle}>
              <div className="flex-1 min-w-[200px]">
                {c.code && (
                  <span
                    className="text-[10px] font-mono font-bold rounded px-1.5 py-0.5 mr-2"
                    style={{ background: "var(--ch-navy-soft)", color: "var(--ch-navy)" }}
                  >
                    {c.code}
                  </span>
                )}
                <span className="text-sm font-semibold" style={{ color: "var(--ch-ink)" }}>{c.name}</span>
                {c.contract_number && <span className="text-xs ml-2" style={{ color: "var(--ch-sub)" }}>Contract {c.contract_number}</span>}
                {(c.contract_start_date || c.contract_end_date) && (
                  <span className="text-xs ml-2" style={{ color: "var(--ch-sub)" }}>
                    {c.contract_start_date ?? "…"} – {c.contract_end_date ?? "…"}
                  </span>
                )}
                {!c.is_active && <span className="text-xs ml-2 font-semibold" style={{ color: "var(--ch-fail)" }}>Inactive</span>}
              </div>
              <button onClick={() => setEditingId(c.id)} className="text-xs font-semibold" style={{ color: "var(--ch-navy)" }}>Edit</button>
              <DeleteButton onDelete={() => deleteClient(c.id).then(onChanged)} label="client" />
            </div>
          )
        )}
      </div>
    </div>
  );
}

function ClientForm({ client, onDone, onCancel }: { client?: Client; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState(client?.name ?? "");
  const [contractNumber, setContractNumber] = useState(client?.contract_number ?? "");
  const [start, setStart] = useState(client?.contract_start_date ?? "");
  const [end, setEnd] = useState(client?.contract_end_date ?? "");
  const [billingModel, setBillingModel] = useState(client?.billing_model ?? "");
  const [notes, setNotes] = useState(client?.notes ?? "");
  const [isActive, setIsActive] = useState(client?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    if (!name.trim()) return;
    setError(null);
    const fd = new FormData();
    fd.set("name", name.trim());
    fd.set("contractNumber", contractNumber.trim());
    fd.set("contractStartDate", start);
    fd.set("contractEndDate", end);
    fd.set("billingModel", billingModel.trim());
    fd.set("notes", notes.trim());
    if (isActive) fd.set("isActive", "on");
    startTransition(async () => {
      const res = client ? await updateClient(client.id, fd) : await createClient_(fd);
      if (res?.error) { setError(res.error); return; }
      onDone();
    });
  };

  return (
    <div className={`${cardCls} p-4 mb-3`} style={cardStyle}>
      {client && (
        <div className="text-xs mb-3" style={{ color: "var(--ch-sub)" }}>
          Code:{" "}
          <span className="font-mono font-semibold" style={{ color: "var(--ch-ink)" }}>
            {client.code ?? "—"}
          </span>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 mb-3">
        <input className={inputCls} style={inputStyle} placeholder="Client name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={inputCls} style={inputStyle} placeholder="Contract number" value={contractNumber} onChange={(e) => setContractNumber(e.target.value)} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3 mb-3">
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Contract start
          <input type="date" className={`${inputCls} w-full mt-1`} style={inputStyle} value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Contract end
          <input type="date" className={`${inputCls} w-full mt-1`} style={inputStyle} value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Billing model
          <input className={`${inputCls} w-full mt-1`} style={inputStyle} placeholder="e.g. Monthly invoicing" value={billingModel} onChange={(e) => setBillingModel(e.target.value)} />
        </label>
      </div>
      <textarea className={`${inputCls} w-full mb-3`} style={inputStyle} placeholder="Notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs mr-auto" style={{ color: "var(--ch-ink)" }}>
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Active
        </label>
        <button onClick={save} disabled={pending || !name.trim()} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
          {pending ? "Saving…" : "Save"}
        </button>
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-line)" }}>Cancel</button>
      </div>
      <ErrorLine error={error} />
    </div>
  );
}
