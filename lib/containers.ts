// Phase 7 — container cost & utilization maths. Pure functions over
// already-fetched rows so the list page, detail page and project/vessel
// report all agree on the numbers (same role as lib/document-status.ts
// and lib/readiness.ts).
//
// Definitions (documented in claude/phase7-containers.md):
//  * A movement's deployed days run from dispatch_date to return_date
//    (or today while still open). Movements never dispatched count 0.
//  * Rental cost applies to rented containers only: rental_rate × the
//    deployed days converted to the rate basis (daily = days, weekly =
//    days / 7, monthly = days / 30). Owned / client-owned / contractor-
//    owned containers carry no rental cost.
//  * Utilization is measured over a trailing 365-day window (or since
//    commission date, whichever is shorter): deployed days in window /
//    window days. Idle days is the remainder.
//  * Total utilization cost = rental + shipping + customs/port + handling
//    + maintenance. Cost per deployment = total / dispatched movements.
//  * Cost per project / vessel attributes each movement's own costs plus
//    that movement's share of rental cost (its deployed days × rate).

export const MOVEMENT_STATUSES = [
  "reserved",
  "loading",
  "dispatched",
  "in_transit",
  "received_offshore",
  "in_use",
  "return_requested",
  "returned",
] as const;
export type MovementStatus = (typeof MOVEMENT_STATUSES)[number] | "cancelled";

export const MOVEMENT_STATUS_LABELS: Record<string, string> = {
  reserved: "Reserved",
  loading: "Loading",
  dispatched: "Dispatched",
  in_transit: "In transit",
  received_offshore: "Received offshore",
  in_use: "In use",
  return_requested: "Return requested",
  returned: "Returned",
  cancelled: "Cancelled",
};

export const CONTAINER_STATUS_LABELS: Record<string, string> = {
  available: "Available",
  reserved: "Reserved",
  loading: "Loading",
  dispatched: "Dispatched",
  in_transit: "In transit",
  received_offshore: "Received offshore",
  in_use: "In use",
  return_requested: "Return requested",
  returned: "Returned",
  inspection: "Inspection",
};

export const LOAD_CATEGORIES: { value: string; label: string }[] = [
  { value: "dry_food", label: "Dry food" },
  { value: "chilled_food", label: "Chilled food" },
  { value: "frozen_food", label: "Frozen food" },
  { value: "beverages", label: "Beverages" },
  { value: "cleaning_materials", label: "Cleaning materials" },
  { value: "laundry_materials", label: "Laundry materials" },
  { value: "ppe", label: "PPE" },
  { value: "catering_equipment", label: "Catering equipment" },
  { value: "other", label: "Other" },
];

export const OWNERSHIP_LABELS: Record<string, string> = {
  owned: "Owned",
  rented: "Rented",
  client_owned: "Client-owned",
  contractor_owned: "Contractor-owned",
};

export type ContainerLike = {
  id: string;
  ownership: string;
  rental_rate: number | null;
  rate_basis: string | null;
  commission_date: string | null;
  created_at?: string | null;
};
export type MovementLike = {
  id: string;
  container_id: string;
  project_id: string | null;
  offshore_site_id: string | null;
  status: string;
  dispatch_date: string | null;
  return_date: string | null;
  shipping_cost: number | null;
  customs_port_cost: number | null;
  handling_cost: number | null;
};
export type MaintenanceLike = { container_id: string; cost: number | null };

export type ContainerCostSummary = {
  movements: number;
  dispatchedMovements: number;
  daysDeployed: number;
  rentalCost: number;
  transportationCost: number;
  portCustomsCost: number;
  handlingCost: number;
  maintenanceCost: number;
  totalCost: number;
  windowDays: number;
  utilizationPct: number;
  idleDays: number;
  costPerDeployment: number | null;
};

const DAY_MS = 86400000;
const WINDOW_DAYS = 365;

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string) {
  return Math.max(0, Math.round((new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) / DAY_MS));
}
function clampDate(d: string, min: string, max: string) {
  return d < min ? min : d > max ? max : d;
}

export function movementDeployedDays(m: MovementLike, today = isoToday()): number {
  if (!m.dispatch_date || m.status === "cancelled") return 0;
  const end = m.return_date ?? today;
  return daysBetween(m.dispatch_date, end);
}

export function rentalCostForDays(container: ContainerLike, days: number): number {
  if (container.ownership !== "rented" || !container.rental_rate || days <= 0) return 0;
  const rate = Number(container.rental_rate);
  switch (container.rate_basis) {
    case "weekly":
      return (days / 7) * rate;
    case "monthly":
      return (days / 30) * rate;
    default:
      return days * rate;
  }
}

export function movementCost(container: ContainerLike, m: MovementLike, today = isoToday()) {
  const days = movementDeployedDays(m, today);
  const rental = rentalCostForDays(container, days);
  const shipping = Number(m.shipping_cost ?? 0);
  const port = Number(m.customs_port_cost ?? 0);
  const handling = Number(m.handling_cost ?? 0);
  return { days, rental, shipping, port, handling, total: rental + shipping + port + handling };
}

export function summarizeContainer(container: ContainerLike, movements: MovementLike[], maintenance: MaintenanceLike[], today = isoToday()): ContainerCostSummary {
  const own = movements.filter((m) => m.container_id === container.id && m.status !== "cancelled");
  let daysDeployed = 0;
  let rentalCost = 0;
  let transportationCost = 0;
  let portCustomsCost = 0;
  let handlingCost = 0;
  for (const m of own) {
    const c = movementCost(container, m, today);
    daysDeployed += c.days;
    rentalCost += c.rental;
    transportationCost += c.shipping;
    portCustomsCost += c.port;
    handlingCost += c.handling;
  }
  const maintenanceCost = maintenance.filter((x) => x.container_id === container.id).reduce((n, x) => n + Number(x.cost ?? 0), 0);
  const totalCost = rentalCost + transportationCost + portCustomsCost + handlingCost + maintenanceCost;

  // Utilization over a trailing window, clipped to the commission date.
  const windowStartRaw = new Date(new Date(today + "T00:00:00Z").getTime() - WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10);
  const commission = container.commission_date ?? (container.created_at ? container.created_at.slice(0, 10) : null);
  const windowStart = commission && commission > windowStartRaw ? commission : windowStartRaw;
  const windowDays = Math.max(1, daysBetween(windowStart, today));
  let deployedInWindow = 0;
  for (const m of own) {
    if (!m.dispatch_date) continue;
    const start = clampDate(m.dispatch_date, windowStart, today);
    const end = clampDate(m.return_date ?? today, windowStart, today);
    deployedInWindow += daysBetween(start, end);
  }
  deployedInWindow = Math.min(deployedInWindow, windowDays);
  const dispatchedMovements = own.filter((m) => !!m.dispatch_date).length;

  return {
    movements: own.length,
    dispatchedMovements,
    daysDeployed,
    rentalCost,
    transportationCost,
    portCustomsCost,
    handlingCost,
    maintenanceCost,
    totalCost,
    windowDays,
    utilizationPct: Math.round((deployedInWindow / windowDays) * 100),
    idleDays: windowDays - deployedInWindow,
    costPerDeployment: dispatchedMovements ? totalCost / dispatchedMovements : null,
  };
}

// Cost attributed to each project / vessel: every movement's own costs
// plus that movement's rental share. Maintenance is a container-level
// cost and is not attributed to a project.
export function costByKey(
  containers: ContainerLike[],
  movements: MovementLike[],
  key: "project_id" | "offshore_site_id",
  today = isoToday()
): Record<string, { movements: number; days: number; rental: number; transport: number; port: number; handling: number; total: number }> {
  const byId = new Map(containers.map((c) => [c.id, c]));
  const out: Record<string, { movements: number; days: number; rental: number; transport: number; port: number; handling: number; total: number }> = {};
  for (const m of movements) {
    if (m.status === "cancelled") continue;
    const k = m[key];
    if (!k) continue;
    const container = byId.get(m.container_id);
    if (!container) continue;
    const c = movementCost(container, m, today);
    const row = (out[k] ??= { movements: 0, days: 0, rental: 0, transport: 0, port: 0, handling: 0, total: 0 });
    row.movements += 1;
    row.days += c.days;
    row.rental += c.rental;
    row.transport += c.shipping;
    row.port += c.port;
    row.handling += c.handling;
    row.total += c.total;
  }
  return out;
}

export function fmtMoney(n: number | null | undefined, currency?: string | null) {
  if (n == null) return "—";
  const v = Math.round(n * 100) / 100;
  return `${currency ? currency + " " : ""}${v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
