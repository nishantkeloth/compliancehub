"use client";

import { useState } from "react";
import { OWNERSHIP_LABELS } from "@/lib/containers";

export type ContainerFormValues = {
  container_code: string;
  container_type: string | null;
  ownership: string;
  supplier_lessor: string | null;
  purchase_cost: number | null;
  rental_rate: number | null;
  rate_basis: string | null;
  currency: string;
  capacity: string | null;
  tare_weight_kg: number | null;
  current_condition: string;
  current_location: string | null;
  commission_date: string | null;
  last_inspection_date: string | null;
  next_inspection_date: string | null;
  notes: string | null;
};

const inputCls = "border rounded-lg px-3 py-2 text-sm w-full mt-1";
const inputStyle = { borderColor: "var(--ch-line)" };
const labelCls = "text-xs";
const labelStyle = { color: "var(--ch-sub)" };

export default function ContainerForm({
  initial,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  initial?: Partial<ContainerFormValues>;
  submitLabel: string;
  busy: boolean;
  onSubmit: (fd: FormData) => void;
  onCancel?: () => void;
}) {
  const [v, setV] = useState<ContainerFormValues>({
    container_code: initial?.container_code ?? "",
    container_type: initial?.container_type ?? "",
    ownership: initial?.ownership ?? "owned",
    supplier_lessor: initial?.supplier_lessor ?? "",
    purchase_cost: initial?.purchase_cost ?? null,
    rental_rate: initial?.rental_rate ?? null,
    rate_basis: initial?.rate_basis ?? "daily",
    currency: initial?.currency ?? "USD",
    capacity: initial?.capacity ?? "",
    tare_weight_kg: initial?.tare_weight_kg ?? null,
    current_condition: initial?.current_condition ?? "good",
    current_location: initial?.current_location ?? "",
    commission_date: initial?.commission_date ?? "",
    last_inspection_date: initial?.last_inspection_date ?? "",
    next_inspection_date: initial?.next_inspection_date ?? "",
    notes: initial?.notes ?? "",
  });
  const set = (k: keyof ContainerFormValues, val: string | number | null) => setV((p) => ({ ...p, [k]: val }));
  const numVal = (n: number | null) => (n == null ? "" : String(n));

  const submit = () => {
    const fd = new FormData();
    fd.set("containerCode", v.container_code.trim());
    fd.set("containerType", v.container_type ?? "");
    fd.set("ownership", v.ownership);
    fd.set("supplierLessor", v.supplier_lessor ?? "");
    fd.set("purchaseCost", numVal(v.purchase_cost));
    fd.set("rentalRate", numVal(v.rental_rate));
    fd.set("rateBasis", v.ownership === "rented" ? v.rate_basis ?? "daily" : "");
    fd.set("currency", v.currency || "USD");
    fd.set("capacity", v.capacity ?? "");
    fd.set("tareWeightKg", numVal(v.tare_weight_kg));
    fd.set("currentCondition", v.current_condition);
    fd.set("currentLocation", v.current_location ?? "");
    fd.set("commissionDate", v.commission_date ?? "");
    fd.set("lastInspectionDate", v.last_inspection_date ?? "");
    fd.set("nextInspectionDate", v.next_inspection_date ?? "");
    fd.set("notes", v.notes ?? "");
    onSubmit(fd);
  };

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className={labelCls} style={labelStyle}>
          Container number / code *
          <input className={`${inputCls} font-mono`} style={inputStyle} value={v.container_code} onChange={(e) => set("container_code", e.target.value.toUpperCase())} placeholder="e.g. MSKU1234567 or RC-01" />
        </label>
        <label className={labelCls} style={labelStyle}>
          Container type
          <input className={inputCls} style={inputStyle} value={v.container_type ?? ""} onChange={(e) => set("container_type", e.target.value)} placeholder="20ft reefer, 10ft dry, half-height…" />
        </label>
        <label className={labelCls} style={labelStyle}>
          Ownership
          <select className={inputCls} style={inputStyle} value={v.ownership} onChange={(e) => set("ownership", e.target.value)}>
            {Object.entries(OWNERSHIP_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className={labelCls} style={labelStyle}>
          Supplier / lessor
          <input className={inputCls} style={inputStyle} value={v.supplier_lessor ?? ""} onChange={(e) => set("supplier_lessor", e.target.value)} />
        </label>
        <label className={labelCls} style={labelStyle}>
          Currency
          <input className={inputCls} style={inputStyle} value={v.currency} onChange={(e) => set("currency", e.target.value.toUpperCase())} maxLength={3} />
        </label>
        {v.ownership === "owned" ? (
          <label className={labelCls} style={labelStyle}>
            Purchase cost
            <input type="number" min={0} step="0.01" className={inputCls} style={inputStyle} value={numVal(v.purchase_cost)} onChange={(e) => set("purchase_cost", e.target.value ? Number(e.target.value) : null)} />
          </label>
        ) : v.ownership === "rented" ? (
          <div className="grid grid-cols-2 gap-2">
            <label className={labelCls} style={labelStyle}>
              Rental rate *
              <input type="number" min={0} step="0.01" className={inputCls} style={inputStyle} value={numVal(v.rental_rate)} onChange={(e) => set("rental_rate", e.target.value ? Number(e.target.value) : null)} />
            </label>
            <label className={labelCls} style={labelStyle}>
              Rate basis
              <select className={inputCls} style={inputStyle} value={v.rate_basis ?? "daily"} onChange={(e) => set("rate_basis", e.target.value)}>
                <option value="daily">Per day</option>
                <option value="weekly">Per week</option>
                <option value="monthly">Per month</option>
              </select>
            </label>
          </div>
        ) : (
          <div />
        )}
        <label className={labelCls} style={labelStyle}>
          Capacity
          <input className={inputCls} style={inputStyle} value={v.capacity ?? ""} onChange={(e) => set("capacity", e.target.value)} placeholder="e.g. 33 m³ / 21,000 kg" />
        </label>
        <label className={labelCls} style={labelStyle}>
          Tare weight (kg)
          <input type="number" min={0} step="0.01" className={inputCls} style={inputStyle} value={numVal(v.tare_weight_kg)} onChange={(e) => set("tare_weight_kg", e.target.value ? Number(e.target.value) : null)} />
        </label>
        <label className={labelCls} style={labelStyle}>
          Current condition
          <select className={inputCls} style={inputStyle} value={v.current_condition} onChange={(e) => set("current_condition", e.target.value)}>
            <option value="good">Good</option>
            <option value="fair">Fair</option>
            <option value="damaged">Damaged</option>
            <option value="out_of_service">Out of service</option>
          </select>
        </label>
        <label className={labelCls} style={labelStyle}>
          Current location
          <input className={inputCls} style={inputStyle} value={v.current_location ?? ""} onChange={(e) => set("current_location", e.target.value)} placeholder="Yard / warehouse / port" />
        </label>
        <label className={labelCls} style={labelStyle}>
          Commission date
          <input type="date" className={inputCls} style={inputStyle} value={v.commission_date ?? ""} onChange={(e) => set("commission_date", e.target.value)} />
        </label>
        <label className={labelCls} style={labelStyle}>
          Last inspection
          <input type="date" className={inputCls} style={inputStyle} value={v.last_inspection_date ?? ""} onChange={(e) => set("last_inspection_date", e.target.value)} />
        </label>
        <label className={labelCls} style={labelStyle}>
          Next inspection due
          <input type="date" className={inputCls} style={inputStyle} value={v.next_inspection_date ?? ""} onChange={(e) => set("next_inspection_date", e.target.value)} />
        </label>
      </div>
      <label className={`${labelCls} block mt-3`} style={labelStyle}>
        Notes
        <textarea className={inputCls} style={inputStyle} rows={2} value={v.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
      </label>
      <div className="flex items-center gap-2 mt-4">
        <button onClick={submit} disabled={busy || !v.container_code.trim() || (v.ownership === "rented" && v.rental_rate == null)} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
          {submitLabel}
        </button>
        {onCancel && (
          <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-line)" }}>Cancel</button>
        )}
      </div>
    </div>
  );
}
