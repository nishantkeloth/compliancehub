"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createContractor, updateContractor, deleteContractor } from "./actions";

type ClientOption = { id: string; name: string };
type Contractor = {
  id: string;
  name: string;
  code: string | null;
  client_id: string;
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

export default function ContractorsManager({
  contractors,
  clients,
}: {
  contractors: Contractor[];
  clients: ClientOption[];
}) {
  const router = useRouter();
  const onChanged = () => router.refresh();

  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const clientName = (id: string) => clients.find((c) => c.id === id)?.name ?? "—";

  return (
    <div>
      {clients.length === 0 && (
        <div className="text-sm mb-4" style={{ color: "var(--ch-sub)" }}>
          Add a client first (Clients) before adding EPC contractors under them.
        </div>
      )}
      {adding ? (
        <ContractorForm clients={clients} onDone={() => { setAdding(false); onChanged(); }} onCancel={() => setAdding(false)} />
      ) : (
        <button
          onClick={() => setAdding(true)}
          disabled={clients.length === 0}
          className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold mb-4 disabled:opacity-50"
        >
          + Add contractor
        </button>
      )}

      <div className="space-y-2 mt-4">
        {contractors.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No EPC contractors yet.</div>}
        {contractors.map((c) =>
          editingId === c.id ? (
            <ContractorForm key={c.id} contractor={c} clients={clients} onDone={() => { setEditingId(null); onChanged(); }} onCancel={() => setEditingId(null)} />
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
                <span className="text-xs ml-2" style={{ color: "var(--ch-sub)" }}>under {clientName(c.client_id)}</span>
                {!c.is_active && <span className="text-xs ml-2 font-semibold" style={{ color: "var(--ch-fail)" }}>Inactive</span>}
              </div>
              <button onClick={() => setEditingId(c.id)} className="text-xs font-semibold" style={{ color: "var(--ch-navy)" }}>Edit</button>
              <DeleteButton onDelete={() => deleteContractor(c.id).then(onChanged)} label="contractor" />
            </div>
          )
        )}
      </div>
    </div>
  );
}

function ContractorForm({
  contractor,
  clients,
  onDone,
  onCancel,
}: {
  contractor?: Contractor;
  clients: ClientOption[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(contractor?.name ?? "");
  const [clientId, setClientId] = useState(contractor?.client_id ?? clients[0]?.id ?? "");
  const [notes, setNotes] = useState(contractor?.notes ?? "");
  const [isActive, setIsActive] = useState(contractor?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    if (!name.trim() || !clientId) return;
    setError(null);
    const fd = new FormData();
    fd.set("name", name.trim());
    fd.set("clientId", clientId);
    fd.set("notes", notes.trim());
    if (isActive) fd.set("isActive", "on");
    startTransition(async () => {
      const res = contractor ? await updateContractor(contractor.id, fd) : await createContractor(fd);
      if (res?.error) { setError(res.error); return; }
      onDone();
    });
  };

  return (
    <div className={`${cardCls} p-4 mb-3`} style={cardStyle}>
      {contractor && (
        <div className="text-xs mb-3" style={{ color: "var(--ch-sub)" }}>
          Code:{" "}
          <span className="font-mono font-semibold" style={{ color: "var(--ch-ink)" }}>
            {contractor.code ?? "—"}
          </span>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 mb-3">
        <input className={inputCls} style={inputStyle} placeholder="Contractor name, e.g. Allianz Marine Service" value={name} onChange={(e) => setName(e.target.value)} />
        <select className={inputCls} style={inputStyle} value={clientId} onChange={(e) => setClientId(e.target.value)}>
          <option value="">Select client…</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      <textarea className={`${inputCls} w-full mb-3`} style={inputStyle} placeholder="Notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs mr-auto" style={{ color: "var(--ch-ink)" }}>
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Active
        </label>
        <button onClick={save} disabled={pending || !name.trim() || !clientId} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
          {pending ? "Saving…" : "Save"}
        </button>
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-line)" }}>Cancel</button>
      </div>
      <ErrorLine error={error} />
    </div>
  );
}
