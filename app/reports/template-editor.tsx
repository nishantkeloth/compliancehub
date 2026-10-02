"use client";

// Client Compliance Reports — the per-client column-mapping builder.
// "Building the template is a one-time mapping exercise per client,
// done through a UI, not a code change per client" (phase10 requirement
// doc, section 4). An admin picks columns from the catalog (profile
// fields, every document type's expiry/number/issue date and custom
// fields, computed days-onboard), gives each one a header + optional
// group-header band, reorders with up/down, and saves.

import { useEffect, useState } from "react";
import { getReportColumnCatalog, saveReportTemplate } from "./actions";
import type { ColumnCatalogEntry, ReportColumn } from "@/lib/reports/report-columns";

const cardCls = "bg-white border rounded-xl";
const cardStyle = { borderColor: "var(--ch-line)" };
const inputCls = "border rounded-lg px-3 py-2 text-sm";
const inputStyle = { borderColor: "var(--ch-line)" };
const lbl = "text-xs";
const lblStyle = { color: "var(--ch-sub)" };

type Site = { id: string; name: string; clientId: string | null };
type ClientOpt = { id: string; name: string };

export default function TemplateEditor({
  clients,
  sites,
  existing,
  onSaved,
  onCancel,
}: {
  clients: ClientOpt[];
  sites: Site[];
  existing?: { id: string; clientId: string; siteId: string | null; name: string; columns: ReportColumn[] };
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [catalog, setCatalog] = useState<ColumnCatalogEntry[]>([]);
  const [clientId, setClientId] = useState(existing?.clientId ?? clients[0]?.id ?? "");
  const [siteId, setSiteId] = useState<string>(existing?.siteId ?? "");
  const [name, setName] = useState(existing?.name ?? "");
  const [columns, setColumns] = useState<ReportColumn[]>(existing?.columns ?? []);
  const [addSource, setAddSource] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getReportColumnCatalog().then((res) => setCatalog(res.catalog));
  }, []);

  const sitesForClient = sites.filter((s) => s.clientId === clientId);

  const addColumn = () => {
    const entry = catalog.find((c) => c.source === addSource);
    if (!entry) return;
    setColumns((prev) => [...prev, { source: entry.source, header: entry.label, groupHeader: entry.group, dateFormat: entry.defaultDateFormat ?? null }]);
    setAddSource("");
  };

  const move = (idx: number, dir: -1 | 1) => {
    setColumns((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  const removeColumn = (idx: number) => setColumns((prev) => prev.filter((_, i) => i !== idx));
  const updateColumn = (idx: number, patch: Partial<ReportColumn>) =>
    setColumns((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));

  const handleSave = () => {
    setError(null);
    if (!clientId) {
      setError("Choose a client.");
      return;
    }
    if (!name.trim()) {
      setError("Name this template.");
      return;
    }
    setSaving(true);
    saveReportTemplate({ id: existing?.id, clientId, siteId: siteId || null, name, columns }).then((res) => {
      setSaving(false);
      if (res?.error) {
        setError(res.error);
        return;
      }
      onSaved();
    });
  };

  return (
    <div className={`${cardCls} p-4 space-y-4`} style={cardStyle}>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={lbl} style={lblStyle}>
            Client
          </label>
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={clientId} onChange={(e) => { setClientId(e.target.value); setSiteId(""); }}>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={lbl} style={lblStyle}>
            Site override (optional)
          </label>
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={siteId} onChange={(e) => setSiteId(e.target.value)}>
            <option value="">Applies to every site for this client</option>
            {sitesForClient.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={lbl} style={lblStyle}>
            Template name
          </label>
          <input className={`${inputCls} w-full mt-1`} style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. QatarEnergy crew roster" />
        </div>
      </div>

      <div>
        <div className="text-sm font-medium mb-2">Columns, in order</div>
        {columns.length === 0 && (
          <div className="text-sm" style={lblStyle}>
            No columns yet — add one below.
          </div>
        )}
        <div className="space-y-2">
          {columns.map((c, idx) => (
            <div key={idx} className="flex items-center gap-2 border rounded-lg px-3 py-2" style={{ borderColor: "var(--ch-line)" }}>
              <div className="flex flex-col">
                <button onClick={() => move(idx, -1)} disabled={idx === 0} className="text-xs disabled:opacity-30">▲</button>
                <button onClick={() => move(idx, 1)} disabled={idx === columns.length - 1} className="text-xs disabled:opacity-30">▼</button>
              </div>
              <div className="flex-1 grid grid-cols-2 gap-2">
                <input
                  className={`${inputCls}`}
                  style={inputStyle}
                  value={c.header}
                  onChange={(e) => updateColumn(idx, { header: e.target.value })}
                  placeholder="Column header"
                />
                <input
                  className={`${inputCls}`}
                  style={inputStyle}
                  value={c.groupHeader ?? ""}
                  onChange={(e) => updateColumn(idx, { groupHeader: e.target.value || null })}
                  placeholder="Group header band (optional)"
                />
              </div>
              <div className={lbl} style={{ ...lblStyle, maxWidth: 220 }}>
                {c.source}
              </div>
              <button onClick={() => removeColumn(idx)} className="text-xs text-red-600">
                Remove
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <select className={`${inputCls} flex-1`} style={inputStyle} value={addSource} onChange={(e) => setAddSource(e.target.value)}>
          <option value="">Add a column…</option>
          {catalog.map((entry) => (
            <option key={entry.source} value={entry.source}>
              {entry.group} — {entry.label}
            </option>
          ))}
        </select>
        <button onClick={addColumn} disabled={!addSource} className="text-sm rounded-lg px-3 py-2 border disabled:opacity-40" style={{ borderColor: "var(--ch-line)" }}>
          Add
        </button>
      </div>

      {error && <div className="text-sm rounded-lg p-3 bg-red-50 text-red-700">{error}</div>}

      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="text-sm rounded-lg px-4 py-2 border" style={{ borderColor: "var(--ch-line)" }}>
          Cancel
        </button>
        <button onClick={handleSave} disabled={saving} className="text-sm rounded-lg px-4 py-2 text-white disabled:opacity-50" style={{ background: "var(--ch-accent, #0f2c4c)" }}>
          {saving ? "Saving…" : "Save template"}
        </button>
      </div>
    </div>
  );
}
