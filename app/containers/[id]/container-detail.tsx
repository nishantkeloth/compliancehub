"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ContainerForm, { type ContainerFormValues } from "../container-form";
import { STATUS_COLORS, CONDITION_COLORS, pill } from "../containers-list";
import {
  updateContainer,
  setContainerActive,
  createMovement,
  updateMovementDetails,
  updateMovementCosts,
  advanceMovement,
  cancelMovement,
  addLoadItem,
  removeLoadItem,
  addIncident,
  resolveIncident,
  addMaintenance,
} from "../actions";
import { CONTAINER_STATUS_LABELS, MOVEMENT_STATUS_LABELS, LOAD_CATEGORIES, OWNERSHIP_LABELS, fmtMoney, type ContainerCostSummary } from "@/lib/containers";

type Container = ContainerFormValues & { id: string; availability_status: string; is_active: boolean };
export type Movement = {
  id: string;
  status: string;
  projectId: string;
  projectLabel: string;
  offshoreSiteId: string | null;
  siteName: string | null;
  fromLocation: string | null;
  toLocation: string | null;
  dispatchDate: string | null;
  expectedArrivalDate: string | null;
  actualArrivalDate: string | null;
  returnDate: string | null;
  transportReference: string | null;
  shippingCost: number;
  customsPortCost: number;
  handlingCost: number;
  currency: string;
  receivedBy: string | null;
  receivedAt: string | null;
  receiptShortages: string | null;
  receiptDamage: string | null;
  receiptTemperatureExceptions: string | null;
  remarks: string | null;
  createdAt: string;
  daysDeployed: number;
  rentalShare: number;
  totalCost: number;
};
export type LoadItem = {
  id: string;
  movementId: string;
  category: string;
  description: string | null;
  quantity: number | null;
  unit: string | null;
  value: number | null;
  currency: string | null;
  temperatureRequirement: string | null;
  expiryConsideration: string | null;
  notes: string | null;
};
export type Incident = {
  id: string;
  movementId: string | null;
  type: string;
  description: string;
  estimatedRecoveryCost: number | null;
  currency: string | null;
  reportedAt: string;
  reportedByName: string;
  isResolved: boolean;
  resolutionNotes: string | null;
};
export type Maintenance = {
  id: string;
  type: string;
  performedDate: string;
  cost: number;
  currency: string | null;
  nextInspectionDate: string | null;
  conditionAfter: string | null;
  notes: string | null;
  byName: string;
};
type ProjectOpt = { id: string; label: string; status: string };
type SiteOpt = { id: string; name: string };

const inputCls = "border rounded-lg px-3 py-2 text-sm";
const inputStyle = { borderColor: "var(--ch-line)" };
const cardCls = "bg-white border rounded-xl";
const cardStyle = { borderColor: "var(--ch-line)" };
const lbl = "text-xs";
const lblStyle = { color: "var(--ch-sub)" };

const STEP_LABEL: Record<string, string> = {
  reserved: "Start loading",
  loading: "Dispatch",
  dispatched: "Mark in transit",
  in_transit: "Record receipt offshore",
  received_offshore: "Mark in use",
  in_use: "Request return",
  return_requested: "Confirm returned",
};

export default function ContainerDetail({
  container,
  summary,
  movements,
  loadItems,
  incidents,
  maintenance,
  projects,
  sites,
  canManage,
  today,
}: {
  container: Container;
  summary: ContainerCostSummary;
  movements: Movement[];
  loadItems: LoadItem[];
  incidents: Incident[];
  maintenance: Maintenance[];
  projects: ProjectOpt[];
  sites: SiteOpt[];
  canManage: boolean;
  today: string;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [tab, setTab] = useState<"overview" | "movements" | "costs" | "care">("overview");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<{ error?: string } | undefined>, after?: () => void) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res?.error) {
        setError(res.error);
        return;
      }
      after?.();
      router.refresh();
    });
  };

  const openMovement = movements.find((m) => !["returned", "cancelled"].includes(m.status)) ?? null;
  const inspectionExpired = !!container.next_inspection_date && container.next_inspection_date < today;
  const statusColors = STATUS_COLORS[container.availability_status] ?? STATUS_COLORS.returned;

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2 flex-wrap mb-1">
        <h2 className="text-lg font-bold font-mono" style={{ color: "var(--ch-ink)" }}>{container.container_code}</h2>
        {container.container_type && <span className="text-sm" style={{ color: "var(--ch-sub)" }}>{container.container_type}</span>}
        {pill(CONTAINER_STATUS_LABELS[container.availability_status] ?? container.availability_status, statusColors)}
        {container.current_condition !== "good" && pill(container.current_condition.replace(/_/g, " "), CONDITION_COLORS[container.current_condition] ?? CONDITION_COLORS.fair)}
        {inspectionExpired && pill("inspection expired", CONDITION_COLORS.damaged)}
        {!container.is_active && pill("retired", STATUS_COLORS.returned)}
      </div>
      <div className="text-sm mb-4" style={{ color: "var(--ch-sub)" }}>
        Location: <b style={{ color: "var(--ch-ink)" }}>{container.current_location ?? "—"}</b>
        {openMovement && <> · on <b style={{ color: "var(--ch-ink)" }}>{openMovement.projectLabel}</b>{openMovement.siteName ? ` / ${openMovement.siteName}` : ""}</>}
        {" · "}{OWNERSHIP_LABELS[container.ownership] ?? container.ownership}
        {" · "}next inspection {container.next_inspection_date ?? "—"}
      </div>

      {error && <div className="text-sm mb-3 rounded-lg px-3 py-2" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>{error}</div>}

      <div className="flex items-center gap-1 rounded-lg border p-1 mb-4 flex-wrap w-fit bg-white" style={{ borderColor: "var(--ch-line)" }}>
        {(["overview", "movements", "costs", "care"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className="px-3 py-1.5 rounded-md text-xs font-semibold" style={tab === t ? { background: "var(--ch-navy)", color: "#fff" } : { color: "var(--ch-sub)" }}>
            {t === "overview" ? "Overview" : t === "movements" ? `Movements (${movements.length})` : t === "costs" ? "Cost & utilization" : `Incidents & maintenance (${incidents.filter((i) => !i.isResolved).length})`}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className={`${cardCls} p-5`} style={cardStyle}>
          {editing ? (
            <ContainerForm initial={container} submitLabel="Save" busy={busy} onSubmit={(fd) => run(() => updateContainer(container.id, fd), () => setEditing(false))} onCancel={() => setEditing(false)} />
          ) : (
            <>
              <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3 text-sm">
                <Field label="Ownership" value={OWNERSHIP_LABELS[container.ownership] ?? container.ownership} />
                <Field label="Supplier / lessor" value={container.supplier_lessor} />
                <Field label="Currency" value={container.currency} />
                {container.ownership === "rented" ? (
                  <Field label="Rental rate" value={container.rental_rate != null ? `${fmtMoney(container.rental_rate, container.currency)} / ${container.rate_basis === "weekly" ? "week" : container.rate_basis === "monthly" ? "month" : "day"}` : null} />
                ) : (
                  <Field label="Purchase cost" value={container.purchase_cost != null ? fmtMoney(container.purchase_cost, container.currency) : null} />
                )}
                <Field label="Capacity" value={container.capacity} />
                <Field label="Tare weight" value={container.tare_weight_kg != null ? `${container.tare_weight_kg} kg` : null} />
                <Field label="Condition" value={container.current_condition.replace(/_/g, " ")} />
                <Field label="Commission date" value={container.commission_date} />
                <Field label="Last inspection" value={container.last_inspection_date} />
                <Field label="Next inspection" value={container.next_inspection_date} />
              </div>
              {container.notes && <div className="text-sm mt-3" style={{ color: "var(--ch-sub)" }}>{container.notes}</div>}
              {canManage && (
                <div className="flex items-center gap-2 mt-4">
                  <button onClick={() => setEditing(true)} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold">Edit</button>
                  <button onClick={() => run(() => setContainerActive(container.id, !container.is_active))} className="text-xs font-semibold" style={{ color: container.is_active ? "var(--ch-fail)" : "var(--ch-pass)" }}>
                    {container.is_active ? "Retire container" : "Reactivate"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab === "movements" && (
        <MovementsTab container={container} movements={movements} loadItems={loadItems} projects={projects} sites={sites} canManage={canManage} today={today} run={run} busy={busy} />
      )}

      {tab === "costs" && <CostsTab container={container} summary={summary} movements={movements} />}

      {tab === "care" && (
        <CareTab container={container} incidents={incidents} maintenance={maintenance} openMovement={openMovement} canManage={canManage} today={today} run={run} />
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: "var(--ch-sub)" }}>{label}</div>
      <div style={{ color: "var(--ch-ink)" }}>{value || "—"}</div>
    </div>
  );
}

/* ================= Movements ================= */

function MovementsTab({
  container,
  movements,
  loadItems,
  projects,
  sites,
  canManage,
  today,
  run,
  busy,
}: {
  container: Container;
  movements: Movement[];
  loadItems: LoadItem[];
  projects: ProjectOpt[];
  sites: SiteOpt[];
  canManage: boolean;
  today: string;
  run: (fn: () => Promise<{ error?: string } | undefined>, after?: () => void) => void;
  busy: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const canReserve = canManage && container.is_active && container.availability_status === "available";

  return (
    <div className="space-y-3">
      {canManage && (
        <div>
          {creating ? (
            <div className={`${cardCls} p-4`} style={cardStyle}>
              <div className="text-sm font-semibold mb-2" style={{ color: "var(--ch-ink)" }}>Reserve for a movement</div>
              <MovementForm projects={projects} sites={sites} initial={{ fromLocation: container.current_location ?? "" }} submitLabel="Reserve container" busy={busy} onSubmit={(fd) => run(() => createMovement(container.id, fd), () => setCreating(false))} onCancel={() => setCreating(false)} />
            </div>
          ) : (
            <button
              onClick={() => setCreating(true)}
              disabled={!canReserve}
              title={canReserve ? "" : container.availability_status === "inspection" ? "Record an inspection first" : "Container has an open movement"}
              className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
            >
              + New movement
            </button>
          )}
        </div>
      )}
      {movements.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No movements yet.</div>}
      {movements.map((m) => (
        <MovementCard key={m.id} container={container} m={m} items={loadItems.filter((l) => l.movementId === m.id)} projects={projects} sites={sites} canManage={canManage} today={today} run={run} busy={busy} />
      ))}
    </div>
  );
}

function MovementForm({
  projects,
  sites,
  initial,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  projects: ProjectOpt[];
  sites: SiteOpt[];
  initial: Partial<{ projectId: string; offshoreSiteId: string; fromLocation: string; toLocation: string; dispatchDate: string; expectedArrivalDate: string; transportReference: string; shippingCost: number; customsPortCost: number; handlingCost: number; currency: string; remarks: string }>;
  submitLabel: string;
  busy: boolean;
  onSubmit: (fd: FormData) => void;
  onCancel: () => void;
}) {
  const [projectId, setProjectId] = useState(initial.projectId ?? "");
  const [offshoreSiteId, setOffshoreSiteId] = useState(initial.offshoreSiteId ?? "");
  const [fromLocation, setFromLocation] = useState(initial.fromLocation ?? "");
  const [toLocation, setToLocation] = useState(initial.toLocation ?? "");
  const [dispatchDate, setDispatchDate] = useState(initial.dispatchDate ?? "");
  const [expectedArrivalDate, setExpectedArrivalDate] = useState(initial.expectedArrivalDate ?? "");
  const [transportReference, setTransportReference] = useState(initial.transportReference ?? "");
  const [shippingCost, setShippingCost] = useState(String(initial.shippingCost ?? ""));
  const [customsPortCost, setCustomsPortCost] = useState(String(initial.customsPortCost ?? ""));
  const [handlingCost, setHandlingCost] = useState(String(initial.handlingCost ?? ""));
  const [currency, setCurrency] = useState(initial.currency ?? "USD");
  const [remarks, setRemarks] = useState(initial.remarks ?? "");

  const openProjects = projects.filter((p) => !["completed", "cancelled", "closed"].includes(p.status));

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className={lbl} style={lblStyle}>
          Project *
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Select project…</option>
            {(openProjects.length ? openProjects : projects).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <label className={lbl} style={lblStyle}>
          Vessel / site (preferred)
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={offshoreSiteId} onChange={(e) => { setOffshoreSiteId(e.target.value); const s = sites.find((x) => x.id === e.target.value); if (s && !toLocation) setToLocation(s.name); }}>
            <option value="">—</option>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className={lbl} style={lblStyle}>
          Transport reference
          <input className={`${inputCls} w-full mt-1`} style={inputStyle} value={transportReference} onChange={(e) => setTransportReference(e.target.value)} placeholder="Truck / vessel / booking ref" />
        </label>
        <label className={lbl} style={lblStyle}>
          From
          <input className={`${inputCls} w-full mt-1`} style={inputStyle} value={fromLocation} onChange={(e) => setFromLocation(e.target.value)} />
        </label>
        <label className={lbl} style={lblStyle}>
          To
          <input className={`${inputCls} w-full mt-1`} style={inputStyle} value={toLocation} onChange={(e) => setToLocation(e.target.value)} />
        </label>
        <label className={lbl} style={lblStyle}>
          Currency
          <input className={`${inputCls} w-full mt-1`} style={inputStyle} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} />
        </label>
        <label className={lbl} style={lblStyle}>
          Planned dispatch
          <input type="date" className={`${inputCls} w-full mt-1`} style={inputStyle} value={dispatchDate} onChange={(e) => setDispatchDate(e.target.value)} />
        </label>
        <label className={lbl} style={lblStyle}>
          Expected arrival
          <input type="date" className={`${inputCls} w-full mt-1`} style={inputStyle} value={expectedArrivalDate} onChange={(e) => setExpectedArrivalDate(e.target.value)} />
        </label>
        <div />
        <label className={lbl} style={lblStyle}>
          Shipping / vendor cost
          <input type="number" min={0} step="0.01" className={`${inputCls} w-full mt-1`} style={inputStyle} value={shippingCost} onChange={(e) => setShippingCost(e.target.value)} />
        </label>
        <label className={lbl} style={lblStyle}>
          Customs / port cost
          <input type="number" min={0} step="0.01" className={`${inputCls} w-full mt-1`} style={inputStyle} value={customsPortCost} onChange={(e) => setCustomsPortCost(e.target.value)} />
        </label>
        <label className={lbl} style={lblStyle}>
          Handling cost
          <input type="number" min={0} step="0.01" className={`${inputCls} w-full mt-1`} style={inputStyle} value={handlingCost} onChange={(e) => setHandlingCost(e.target.value)} />
        </label>
      </div>
      <textarea className={`${inputCls} w-full mt-3`} style={inputStyle} rows={2} placeholder="Remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={() => {
            const fd = new FormData();
            fd.set("projectId", projectId);
            fd.set("offshoreSiteId", offshoreSiteId);
            fd.set("fromLocation", fromLocation);
            fd.set("toLocation", toLocation);
            fd.set("dispatchDate", dispatchDate);
            fd.set("expectedArrivalDate", expectedArrivalDate);
            fd.set("transportReference", transportReference);
            fd.set("shippingCost", shippingCost);
            fd.set("customsPortCost", customsPortCost);
            fd.set("handlingCost", handlingCost);
            fd.set("currency", currency);
            fd.set("remarks", remarks);
            onSubmit(fd);
          }}
          disabled={busy || !projectId}
          className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          {submitLabel}
        </button>
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-line)" }}>Cancel</button>
      </div>
    </div>
  );
}

function MovementCard({
  container,
  m,
  items,
  projects,
  sites,
  canManage,
  today,
  run,
  busy,
}: {
  container: Container;
  m: Movement;
  items: LoadItem[];
  projects: ProjectOpt[];
  sites: SiteOpt[];
  canManage: boolean;
  today: string;
  run: (fn: () => Promise<{ error?: string } | undefined>, after?: () => void) => void;
  busy: boolean;
}) {
  const [panel, setPanel] = useState<"none" | "advance" | "edit" | "costs" | "load" | "cancel">("none");
  const isOpen = !["returned", "cancelled"].includes(m.status);
  const nextLabel = STEP_LABEL[m.status];
  const canEditLoad = ["reserved", "loading", "dispatched", "in_transit"].includes(m.status);
  const colors = STATUS_COLORS[m.status] ?? STATUS_COLORS.returned;
  const totalLoadValue = items.reduce((n, i) => n + (i.value ?? 0), 0);

  return (
    <div className={cardCls} style={cardStyle}>
      <div className="p-3 flex items-center gap-2 flex-wrap">
        {pill(MOVEMENT_STATUS_LABELS[m.status] ?? m.status, colors)}
        <span className="text-sm font-semibold" style={{ color: "var(--ch-ink)" }}>{m.projectLabel}</span>
        {m.siteName && <span className="text-xs" style={{ color: "var(--ch-sub)" }}>· {m.siteName}</span>}
        <span className="text-xs" style={{ color: "var(--ch-sub)" }}>{m.fromLocation ?? "—"} → {m.toLocation ?? "—"}</span>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          {canManage && isOpen && nextLabel && (
            <button onClick={() => setPanel(panel === "advance" ? "none" : "advance")} className="ch-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold">{nextLabel} ›</button>
          )}
          {canManage && isOpen && <button onClick={() => setPanel(panel === "edit" ? "none" : "edit")} className="text-xs font-semibold ch-link-navy">Edit</button>}
          {canManage && <button onClick={() => setPanel(panel === "costs" ? "none" : "costs")} className="text-xs font-semibold ch-link-navy">Costs</button>}
          <button onClick={() => setPanel(panel === "load" ? "none" : "load")} className="text-xs font-semibold ch-link-navy">Load ({items.length})</button>
          {canManage && ["reserved", "loading"].includes(m.status) && <button onClick={() => setPanel(panel === "cancel" ? "none" : "cancel")} className="text-xs font-semibold" style={{ color: "var(--ch-fail)" }}>Cancel</button>}
        </div>
      </div>
      <div className="px-3 pb-2 text-xs grid gap-0.5 sm:grid-cols-2 lg:grid-cols-4" style={{ color: "var(--ch-sub)" }}>
        <div>Dispatch {m.dispatchDate ?? "—"} · expected {m.expectedArrivalDate ?? "—"}</div>
        <div>Arrived {m.actualArrivalDate ?? "—"} · returned {m.returnDate ?? "—"}</div>
        <div>{m.daysDeployed}d deployed · ref {m.transportReference ?? "—"}</div>
        <div>Cost {fmtMoney(m.totalCost, m.currency)}{m.rentalShare ? ` (incl. rental ${fmtMoney(m.rentalShare)})` : ""}</div>
      </div>
      {m.receivedBy && (
        <div className="px-3 pb-2 text-xs" style={{ color: "var(--ch-sub)" }}>
          Received by <b style={{ color: "var(--ch-ink)" }}>{m.receivedBy}</b> · shortages: {m.receiptShortages ?? "—"} · damage: {m.receiptDamage ?? "—"} · temperature: {m.receiptTemperatureExceptions ?? "—"}
        </div>
      )}
      {m.remarks && <div className="px-3 pb-2 text-xs" style={{ color: "var(--ch-sub)" }}>{m.remarks}</div>}

      {panel === "advance" && (
        <div className="border-t p-3" style={{ borderColor: "var(--ch-line)" }}>
          <AdvanceForm m={m} container={container} today={today} busy={busy} onSubmit={(fd) => run(() => advanceMovement(m.id, fd), () => setPanel("none"))} onCancel={() => setPanel("none")} />
        </div>
      )}
      {panel === "edit" && (
        <div className="border-t p-3" style={{ borderColor: "var(--ch-line)" }}>
          <MovementForm
            projects={projects}
            sites={sites}
            initial={{ projectId: m.projectId, offshoreSiteId: m.offshoreSiteId ?? "", fromLocation: m.fromLocation ?? "", toLocation: m.toLocation ?? "", dispatchDate: m.dispatchDate ?? "", expectedArrivalDate: m.expectedArrivalDate ?? "", transportReference: m.transportReference ?? "", shippingCost: m.shippingCost, customsPortCost: m.customsPortCost, handlingCost: m.handlingCost, currency: m.currency, remarks: m.remarks ?? "" }}
            submitLabel="Save movement"
            busy={busy}
            onSubmit={(fd) => run(() => updateMovementDetails(m.id, fd), () => setPanel("none"))}
            onCancel={() => setPanel("none")}
          />
        </div>
      )}
      {panel === "costs" && (
        <div className="border-t p-3" style={{ borderColor: "var(--ch-line)" }}>
          <CostsForm m={m} busy={busy} onSubmit={(fd) => run(() => updateMovementCosts(m.id, fd), () => setPanel("none"))} onCancel={() => setPanel("none")} />
        </div>
      )}
      {panel === "load" && (
        <div className="border-t p-3" style={{ borderColor: "var(--ch-line)" }}>
          {items.length === 0 && <div className="text-sm mb-2" style={{ color: "var(--ch-sub)" }}>No load recorded.</div>}
          <div className="space-y-1.5 mb-3">
            {items.map((i) => (
              <div key={i.id} className="text-xs border rounded-lg px-2.5 py-1.5 flex items-center gap-2 flex-wrap" style={{ borderColor: "var(--ch-line)" }}>
                <span className="font-semibold" style={{ color: "var(--ch-ink)" }}>{LOAD_CATEGORIES.find((c) => c.value === i.category)?.label ?? i.category}</span>
                {i.description && <span style={{ color: "var(--ch-sub)" }}>{i.description}</span>}
                {i.quantity != null && <span style={{ color: "var(--ch-sub)" }}>{i.quantity} {i.unit ?? ""}</span>}
                {i.value != null && <span style={{ color: "var(--ch-sub)" }}>{fmtMoney(i.value, i.currency)}</span>}
                {i.temperatureRequirement && <span style={{ color: "var(--ch-sub)" }}>🌡 {i.temperatureRequirement}</span>}
                {i.expiryConsideration && <span style={{ color: "var(--ch-sub)" }}>exp: {i.expiryConsideration}</span>}
                {i.notes && <span style={{ color: "var(--ch-sub)" }}>{i.notes}</span>}
                {canManage && canEditLoad && <button onClick={() => run(() => removeLoadItem(i.id, container.id))} className="ml-auto text-xs" style={{ color: "var(--ch-fail)" }}>✕</button>}
              </div>
            ))}
            {items.length > 0 && totalLoadValue > 0 && <div className="text-xs" style={{ color: "var(--ch-sub)" }}>Declared load value: {fmtMoney(totalLoadValue, m.currency)}</div>}
          </div>
          {canManage && canEditLoad && <LoadForm currency={m.currency} busy={busy} onSubmit={(fd) => run(() => addLoadItem(m.id, fd))} />}
        </div>
      )}
      {panel === "cancel" && (
        <div className="border-t p-3" style={{ borderColor: "var(--ch-line)" }}>
          <ReasonForm label="Cancel movement" busy={busy} onSubmit={(reason) => run(() => cancelMovement(m.id, reason), () => setPanel("none"))} onCancel={() => setPanel("none")} />
        </div>
      )}
    </div>
  );
}

function AdvanceForm({ m, container, today, busy, onSubmit, onCancel }: { m: Movement; container: Container; today: string; busy: boolean; onSubmit: (fd: FormData) => void; onCancel: () => void }) {
  const [dispatchDate, setDispatchDate] = useState(m.dispatchDate ?? today);
  const [transportReference, setTransportReference] = useState(m.transportReference ?? "");
  const [expectedArrivalDate, setExpectedArrivalDate] = useState(m.expectedArrivalDate ?? "");
  const [actualArrivalDate, setActualArrivalDate] = useState(today);
  const [receivedBy, setReceivedBy] = useState("");
  const [shortages, setShortages] = useState("");
  const [damage, setDamage] = useState("");
  const [temp, setTemp] = useState("");
  const [returnDate, setReturnDate] = useState(today);
  const [returnLocation, setReturnLocation] = useState(m.fromLocation ?? "");

  const next = m.status;
  const inspectionExpired = !!container.next_inspection_date && container.next_inspection_date < dispatchDate;

  const submit = () => {
    const fd = new FormData();
    fd.set("dispatchDate", dispatchDate);
    fd.set("transportReference", transportReference);
    fd.set("expectedArrivalDate", expectedArrivalDate);
    fd.set("actualArrivalDate", actualArrivalDate);
    fd.set("receivedBy", receivedBy);
    fd.set("receiptShortages", shortages);
    fd.set("receiptDamage", damage);
    fd.set("receiptTemperatureExceptions", temp);
    fd.set("returnDate", returnDate);
    fd.set("returnLocation", returnLocation);
    onSubmit(fd);
  };

  return (
    <div>
      <div className="text-sm font-semibold mb-2" style={{ color: "var(--ch-ink)" }}>{STEP_LABEL[next]}</div>
      {next === "loading" && (
        <div className="grid gap-3 sm:grid-cols-3 mb-3">
          <label className={lbl} style={lblStyle}>Dispatch date<input type="date" className={`${inputCls} w-full mt-1`} style={inputStyle} value={dispatchDate} onChange={(e) => setDispatchDate(e.target.value)} /></label>
          <label className={lbl} style={lblStyle}>Transport reference<input className={`${inputCls} w-full mt-1`} style={inputStyle} value={transportReference} onChange={(e) => setTransportReference(e.target.value)} /></label>
          <label className={lbl} style={lblStyle}>Expected arrival<input type="date" className={`${inputCls} w-full mt-1`} style={inputStyle} value={expectedArrivalDate} onChange={(e) => setExpectedArrivalDate(e.target.value)} /></label>
          {inspectionExpired && <div className="sm:col-span-3 text-xs" style={{ color: "var(--ch-fail)" }}>Inspection expired on {container.next_inspection_date} — record an inspection under Incidents &amp; maintenance before dispatching.</div>}
        </div>
      )}
      {next === "in_transit" && (
        <div className="grid gap-3 sm:grid-cols-3 mb-3">
          <label className={lbl} style={lblStyle}>Actual arrival<input type="date" className={`${inputCls} w-full mt-1`} style={inputStyle} value={actualArrivalDate} onChange={(e) => setActualArrivalDate(e.target.value)} /></label>
          <label className={lbl} style={lblStyle}>Received by *<input className={`${inputCls} w-full mt-1`} style={inputStyle} value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} placeholder="Name / role offshore" /></label>
          <div />
          <label className={lbl} style={lblStyle}>Shortages<input className={`${inputCls} w-full mt-1`} style={inputStyle} value={shortages} onChange={(e) => setShortages(e.target.value)} placeholder="None" /></label>
          <label className={lbl} style={lblStyle}>Damage<input className={`${inputCls} w-full mt-1`} style={inputStyle} value={damage} onChange={(e) => setDamage(e.target.value)} placeholder="None" /></label>
          <label className={lbl} style={lblStyle}>Temperature exceptions<input className={`${inputCls} w-full mt-1`} style={inputStyle} value={temp} onChange={(e) => setTemp(e.target.value)} placeholder="None" /></label>
        </div>
      )}
      {next === "return_requested" && (
        <div className="grid gap-3 sm:grid-cols-3 mb-3">
          <label className={lbl} style={lblStyle}>Return date<input type="date" className={`${inputCls} w-full mt-1`} style={inputStyle} value={returnDate} onChange={(e) => setReturnDate(e.target.value)} /></label>
          <label className={lbl} style={lblStyle}>Returned to<input className={`${inputCls} w-full mt-1`} style={inputStyle} value={returnLocation} onChange={(e) => setReturnLocation(e.target.value)} /></label>
          <div className="text-xs self-end" style={{ color: "var(--ch-sub)" }}>The container goes to Inspection; recording an inspection makes it available again.</div>
        </div>
      )}
      {!["loading", "in_transit", "return_requested"].includes(next) && <div className="text-xs mb-3" style={{ color: "var(--ch-sub)" }}>Confirm to move this movement to “{MOVEMENT_STATUS_LABELS[{ reserved: "loading", dispatched: "in_transit", received_offshore: "in_use", in_use: "return_requested" }[next] ?? next]}”.</div>}
      <div className="flex items-center gap-2">
        <button onClick={submit} disabled={busy || (next === "loading" && inspectionExpired) || (next === "in_transit" && !receivedBy.trim())} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
          Confirm
        </button>
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-line)" }}>Cancel</button>
      </div>
    </div>
  );
}

function CostsForm({ m, busy, onSubmit, onCancel }: { m: Movement; busy: boolean; onSubmit: (fd: FormData) => void; onCancel: () => void }) {
  const [shipping, setShipping] = useState(String(m.shippingCost));
  const [port, setPort] = useState(String(m.customsPortCost));
  const [handling, setHandling] = useState(String(m.handlingCost));
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-3 mb-3">
        <label className={lbl} style={lblStyle}>Shipping / vendor ({m.currency})<input type="number" min={0} step="0.01" className={`${inputCls} w-full mt-1`} style={inputStyle} value={shipping} onChange={(e) => setShipping(e.target.value)} /></label>
        <label className={lbl} style={lblStyle}>Customs / port<input type="number" min={0} step="0.01" className={`${inputCls} w-full mt-1`} style={inputStyle} value={port} onChange={(e) => setPort(e.target.value)} /></label>
        <label className={lbl} style={lblStyle}>Handling<input type="number" min={0} step="0.01" className={`${inputCls} w-full mt-1`} style={inputStyle} value={handling} onChange={(e) => setHandling(e.target.value)} /></label>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={() => { const fd = new FormData(); fd.set("shippingCost", shipping); fd.set("customsPortCost", port); fd.set("handlingCost", handling); onSubmit(fd); }} disabled={busy} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">Save costs</button>
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-line)" }}>Cancel</button>
      </div>
    </div>
  );
}

function LoadForm({ currency, busy, onSubmit }: { currency: string; busy: boolean; onSubmit: (fd: FormData) => void }) {
  const [category, setCategory] = useState("dry_food");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [value, setValue] = useState("");
  const [temperature, setTemperature] = useState("");
  const [expiry, setExpiry] = useState("");
  const [notes, setNotes] = useState("");
  const tempDefault: Record<string, string> = { chilled_food: "Chilled 0–5°C", frozen_food: "Frozen ≤ −18°C" };

  return (
    <div className="border-t pt-3" style={{ borderColor: "var(--ch-line)" }}>
      <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
        <select className={inputCls} style={inputStyle} value={category} onChange={(e) => { setCategory(e.target.value); if (!temperature) setTemperature(tempDefault[e.target.value] ?? ""); }}>
          {LOAD_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <input className={inputCls} style={inputStyle} placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
        <input type="number" min={0} step="0.01" className={inputCls} style={inputStyle} placeholder="Qty" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        <input className={inputCls} style={inputStyle} placeholder="Unit (kg, ctn, pcs)" value={unit} onChange={(e) => setUnit(e.target.value)} />
        <input type="number" min={0} step="0.01" className={inputCls} style={inputStyle} placeholder={`Value (${currency})`} value={value} onChange={(e) => setValue(e.target.value)} />
        <input className={inputCls} style={inputStyle} placeholder="Temperature requirement" value={temperature} onChange={(e) => setTemperature(e.target.value)} />
        <input className={inputCls} style={inputStyle} placeholder="Expiry consideration" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        <input className={inputCls} style={inputStyle} placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <button
        onClick={() => {
          const fd = new FormData();
          fd.set("category", category);
          fd.set("description", description);
          fd.set("quantity", quantity);
          fd.set("unit", unit);
          fd.set("value", value);
          fd.set("currency", currency);
          fd.set("temperatureRequirement", temperature);
          fd.set("expiryConsideration", expiry);
          fd.set("notes", notes);
          onSubmit(fd);
          setDescription(""); setQuantity(""); setValue(""); setNotes("");
        }}
        disabled={busy}
        className="ch-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold mt-2 disabled:opacity-50"
      >
        + Add load line
      </button>
    </div>
  );
}

function ReasonForm({ label, busy, onSubmit, onCancel }: { label: string; busy: boolean; onSubmit: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState("");
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <input className={`${inputCls} flex-1 min-w-[200px]`} style={inputStyle} placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <button onClick={() => onSubmit(reason.trim())} disabled={busy || !reason.trim()} className="rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>{label}</button>
      <button onClick={onCancel} className="text-xs font-semibold" style={{ color: "var(--ch-sub)" }}>Cancel</button>
    </div>
  );
}

/* ================= Costs & utilization ================= */

function CostsTab({ container, summary, movements }: { container: Container; summary: ContainerCostSummary; movements: Movement[] }) {
  const cur = container.currency;
  const tiles: [string, string][] = [
    ["Movements", String(summary.movements)],
    ["Days deployed", String(summary.daysDeployed)],
    ["Utilization (last " + summary.windowDays + "d)", summary.utilizationPct + "%"],
    ["Idle days", String(summary.idleDays)],
    ["Rental cost", fmtMoney(summary.rentalCost, cur)],
    ["Transportation", fmtMoney(summary.transportationCost, cur)],
    ["Port / customs", fmtMoney(summary.portCustomsCost, cur)],
    ["Handling", fmtMoney(summary.handlingCost, cur)],
    ["Maintenance", fmtMoney(summary.maintenanceCost, cur)],
    ["Total utilization cost", fmtMoney(summary.totalCost, cur)],
    ["Cost per deployment", summary.costPerDeployment != null ? fmtMoney(summary.costPerDeployment, cur) : "—"],
  ];
  const byProject: Record<string, { label: string; days: number; total: number; movements: number }> = {};
  const bySite: Record<string, { label: string; days: number; total: number; movements: number }> = {};
  for (const m of movements) {
    if (m.status === "cancelled") continue;
    const p = (byProject[m.projectId] ??= { label: m.projectLabel, days: 0, total: 0, movements: 0 });
    p.days += m.daysDeployed; p.total += m.totalCost; p.movements += 1;
    if (m.offshoreSiteId) {
      const s = (bySite[m.offshoreSiteId] ??= { label: m.siteName ?? "—", days: 0, total: 0, movements: 0 });
      s.days += m.daysDeployed; s.total += m.totalCost; s.movements += 1;
    }
  }
  const group = (title: string, rows: Record<string, { label: string; days: number; total: number; movements: number }>) => (
    <div className={`${cardCls} p-4`} style={cardStyle}>
      <div className="text-sm font-bold mb-2" style={{ color: "var(--ch-ink)" }}>{title}</div>
      {Object.keys(rows).length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>Nothing yet.</div>}
      {Object.entries(rows).map(([k, r]) => (
        <div key={k} className="text-sm flex items-center gap-2 flex-wrap border-t py-1.5" style={{ borderColor: "var(--ch-line)" }}>
          <span className="font-semibold" style={{ color: "var(--ch-ink)" }}>{r.label}</span>
          <span className="text-xs" style={{ color: "var(--ch-sub)" }}>{r.movements} mov · {r.days}d</span>
          <span className="ml-auto font-semibold" style={{ color: "var(--ch-ink)" }}>{fmtMoney(r.total, cur)}</span>
        </div>
      ))}
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
        {tiles.map(([label, value]) => (
          <div key={label} className={`${cardCls} p-3`} style={cardStyle}>
            <div className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--ch-sub)" }}>{label}</div>
            <div className="text-lg font-bold" style={{ color: "var(--ch-ink)" }}>{value}</div>
          </div>
        ))}
      </div>
      {group("Cost by project", byProject)}
      {group("Cost by vessel", bySite)}
      <p className="text-xs" style={{ color: "var(--ch-sub)" }}>
        Deployed days run from dispatch to return (or today while open). Rental applies to rented containers only, pro-rated to the rate basis. Utilization = deployed days in the trailing window ÷ window days (clipped to the commission date).
      </p>
    </div>
  );
}

/* ================= Incidents & maintenance ================= */

function CareTab({
  container,
  incidents,
  maintenance,
  openMovement,
  canManage,
  today,
  run,
}: {
  container: Container;
  incidents: Incident[];
  maintenance: Maintenance[];
  openMovement: Movement | null;
  canManage: boolean;
  today: string;
  run: (fn: () => Promise<{ error?: string } | undefined>, after?: () => void) => void;
}) {
  const [showIncident, setShowIncident] = useState(false);
  const [showMaintenance, setShowMaintenance] = useState(container.availability_status === "inspection");
  const [incType, setIncType] = useState("damage");
  const [incDesc, setIncDesc] = useState("");
  const [incCost, setIncCost] = useState("");
  const [mType, setMType] = useState(container.availability_status === "inspection" ? "inspection" : "repair");
  const [mDate, setMDate] = useState(today);
  const [mCost, setMCost] = useState("");
  const [mNext, setMNext] = useState("");
  const [mCondition, setMCondition] = useState("");
  const [mNotes, setMNotes] = useState("");
  const [resolveFor, setResolveFor] = useState<string | null>(null);
  const [resolveNote, setResolveNote] = useState("");

  return (
    <div className="space-y-4">
      {container.availability_status === "inspection" && (
        <div className="text-sm rounded-lg px-3 py-2" style={{ background: "#fef3e2", color: "#b45309" }}>
          This container is awaiting inspection after its last movement — record an inspection below to make it available again.
        </div>
      )}

      <div className={`${cardCls} p-4`} style={cardStyle}>
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-bold" style={{ color: "var(--ch-ink)" }}>Maintenance & inspections</div>
          {canManage && <button onClick={() => setShowMaintenance((v) => !v)} className="text-xs font-semibold ch-link-navy">{showMaintenance ? "Close" : "+ Record"}</button>}
        </div>
        {showMaintenance && canManage && (
          <div className="mb-3 border rounded-lg p-3" style={{ borderColor: "var(--ch-line)" }}>
            <div className="grid gap-2 sm:grid-cols-3">
              <label className={lbl} style={lblStyle}>Type
                <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={mType} onChange={(e) => setMType(e.target.value)}>
                  <option value="inspection">Inspection</option><option value="repair">Repair</option><option value="cleaning">Cleaning</option><option value="other">Other</option>
                </select>
              </label>
              <label className={lbl} style={lblStyle}>Date<input type="date" className={`${inputCls} w-full mt-1`} style={inputStyle} value={mDate} onChange={(e) => setMDate(e.target.value)} /></label>
              <label className={lbl} style={lblStyle}>Cost ({container.currency})<input type="number" min={0} step="0.01" className={`${inputCls} w-full mt-1`} style={inputStyle} value={mCost} onChange={(e) => setMCost(e.target.value)} /></label>
              <label className={lbl} style={lblStyle}>Next inspection due{mType === "inspection" ? " *" : ""}<input type="date" className={`${inputCls} w-full mt-1`} style={inputStyle} value={mNext} onChange={(e) => setMNext(e.target.value)} /></label>
              <label className={lbl} style={lblStyle}>Condition after
                <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={mCondition} onChange={(e) => setMCondition(e.target.value)}>
                  <option value="">— unchanged —</option><option value="good">Good</option><option value="fair">Fair</option><option value="damaged">Damaged</option><option value="out_of_service">Out of service</option>
                </select>
              </label>
              <label className={lbl} style={lblStyle}>Notes<input className={`${inputCls} w-full mt-1`} style={inputStyle} value={mNotes} onChange={(e) => setMNotes(e.target.value)} /></label>
            </div>
            <button
              onClick={() => {
                const fd = new FormData();
                fd.set("maintenanceType", mType); fd.set("performedDate", mDate); fd.set("cost", mCost); fd.set("currency", container.currency);
                fd.set("nextInspectionDate", mNext); fd.set("conditionAfter", mCondition); fd.set("notes", mNotes);
                run(() => addMaintenance(container.id, fd), () => { setShowMaintenance(false); setMCost(""); setMNotes(""); });
              }}
              disabled={mType === "inspection" && !mNext}
              className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold mt-2 disabled:opacity-50"
            >
              Save
            </button>
          </div>
        )}
        {maintenance.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No maintenance recorded.</div>}
        <div className="space-y-1.5">
          {maintenance.map((x) => (
            <div key={x.id} className="text-xs border rounded-lg px-2.5 py-1.5 flex items-center gap-2 flex-wrap" style={{ borderColor: "var(--ch-line)" }}>
              <span className="font-semibold capitalize" style={{ color: "var(--ch-ink)" }}>{x.type}</span>
              <span style={{ color: "var(--ch-sub)" }}>{x.performedDate}</span>
              {x.cost > 0 && <span style={{ color: "var(--ch-sub)" }}>{fmtMoney(x.cost, x.currency ?? container.currency)}</span>}
              {x.nextInspectionDate && <span style={{ color: "var(--ch-sub)" }}>next due {x.nextInspectionDate}</span>}
              {x.conditionAfter && <span style={{ color: "var(--ch-sub)" }}>→ {x.conditionAfter.replace(/_/g, " ")}</span>}
              {x.notes && <span style={{ color: "var(--ch-sub)" }}>{x.notes}</span>}
              <span className="ml-auto" style={{ color: "var(--ch-sub)" }}>{x.byName}</span>
            </div>
          ))}
        </div>
      </div>

      <div className={`${cardCls} p-4`} style={cardStyle}>
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-bold" style={{ color: "var(--ch-ink)" }}>Damage / loss incidents</div>
          {canManage && <button onClick={() => setShowIncident((v) => !v)} className="text-xs font-semibold ch-link-navy">{showIncident ? "Close" : "+ Report"}</button>}
        </div>
        {showIncident && canManage && (
          <div className="mb-3 border rounded-lg p-3" style={{ borderColor: "var(--ch-line)" }}>
            <div className="grid gap-2 sm:grid-cols-3">
              <label className={lbl} style={lblStyle}>Type
                <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={incType} onChange={(e) => setIncType(e.target.value)}><option value="damage">Damage</option><option value="loss">Loss</option></select>
              </label>
              <label className={lbl} style={lblStyle}>Estimated recovery cost ({container.currency})<input type="number" min={0} step="0.01" className={`${inputCls} w-full mt-1`} style={inputStyle} value={incCost} onChange={(e) => setIncCost(e.target.value)} /></label>
              <div className="text-xs self-end" style={{ color: "var(--ch-sub)" }}>{openMovement ? `Linked to the open movement (${openMovement.projectLabel})` : "No open movement"}</div>
            </div>
            <textarea className={`${inputCls} w-full mt-2`} style={inputStyle} rows={2} placeholder="What happened (required)" value={incDesc} onChange={(e) => setIncDesc(e.target.value)} />
            <button
              onClick={() => {
                const fd = new FormData();
                fd.set("incidentType", incType); fd.set("description", incDesc.trim()); fd.set("estimatedRecoveryCost", incCost); fd.set("currency", container.currency); fd.set("movementId", openMovement?.id ?? "");
                run(() => addIncident(container.id, fd), () => { setShowIncident(false); setIncDesc(""); setIncCost(""); });
              }}
              disabled={!incDesc.trim()}
              className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold mt-2 disabled:opacity-50"
            >
              Report {incType}
            </button>
          </div>
        )}
        {incidents.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No incidents recorded.</div>}
        <div className="space-y-1.5">
          {incidents.map((i) => (
            <div key={i.id} className="text-xs border rounded-lg px-2.5 py-1.5" style={{ borderColor: "var(--ch-line)" }}>
              <div className="flex items-center gap-2 flex-wrap">
                {pill(i.type, i.isResolved ? STATUS_COLORS.returned : CONDITION_COLORS.damaged)}
                {i.isResolved && pill("resolved", STATUS_COLORS.available)}
                <span className="font-semibold" style={{ color: "var(--ch-ink)" }}>{i.description}</span>
                {i.estimatedRecoveryCost != null && <span style={{ color: "var(--ch-sub)" }}>est. recovery {fmtMoney(i.estimatedRecoveryCost, i.currency ?? container.currency)}</span>}
                <span className="ml-auto" style={{ color: "var(--ch-sub)" }}>{i.reportedAt.slice(0, 10)} · {i.reportedByName}</span>
              </div>
              {i.resolutionNotes && <div className="mt-0.5" style={{ color: "var(--ch-sub)" }}>Resolution: {i.resolutionNotes}</div>}
              {canManage && !i.isResolved && (
                resolveFor === i.id ? (
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <input className={`${inputCls} flex-1 min-w-[160px]`} style={inputStyle} placeholder="Resolution notes" value={resolveNote} onChange={(e) => setResolveNote(e.target.value)} />
                    <button onClick={() => run(() => resolveIncident(i.id, container.id, resolveNote), () => { setResolveFor(null); setResolveNote(""); })} className="text-xs font-semibold" style={{ color: "var(--ch-pass)" }}>Mark resolved</button>
                    <button onClick={() => setResolveFor(null)} className="text-xs" style={{ color: "var(--ch-sub)" }}>Cancel</button>
                  </div>
                ) : (
                  <button onClick={() => setResolveFor(i.id)} className="text-xs font-semibold mt-1 ch-link-navy">Resolve</button>
                )
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
