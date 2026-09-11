"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveAccess, can } from "@/lib/rbac";
import { LOAD_CATEGORIES } from "@/lib/containers";

type Supa = Awaited<ReturnType<typeof createClient>>;

async function requireManage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "containers.manage")) throw new Error("You don't have permission to manage containers.");
  if (!access.orgId) throw new Error("No company context.");
  return { supabase, access, userId: user.id, orgId: access.orgId };
}

function str(formData: FormData, key: string) {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}
function optStr(formData: FormData, key: string) {
  const v = str(formData, key);
  return v || null;
}
function optNum(formData: FormData, key: string) {
  const v = str(formData, key);
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function num0(formData: FormData, key: string) {
  return optNum(formData, key) ?? 0;
}
const today = () => new Date().toISOString().slice(0, 10);

const revalidate = (containerId?: string) => {
  revalidatePath("/containers");
  if (containerId) revalidatePath(`/containers/${containerId}`);
};

async function getContainer(supabase: Supa, id: string) {
  const { data, error } = await supabase
    .from("containers")
    .select("id, org_id, container_code, availability_status, next_inspection_date, current_location, current_condition, is_active")
    .eq("id", id)
    .single();
  if (error || !data) throw new Error("Could not find that container.");
  return data;
}

async function getMovement(supabase: Supa, id: string) {
  const { data, error } = await supabase
    .from("container_movements")
    .select("id, org_id, container_id, project_id, offshore_site_id, status, from_location, to_location, dispatch_date, return_date")
    .eq("id", id)
    .single();
  if (error || !data) throw new Error("Could not find that movement.");
  return data;
}

/* ================= Container master ================= */

function containerFields(formData: FormData) {
  return {
    container_type: optStr(formData, "containerType"),
    ownership: str(formData, "ownership") || "owned",
    supplier_lessor: optStr(formData, "supplierLessor"),
    purchase_cost: optNum(formData, "purchaseCost"),
    rental_rate: optNum(formData, "rentalRate"),
    rate_basis: optStr(formData, "rateBasis"),
    currency: str(formData, "currency") || "USD",
    capacity: optStr(formData, "capacity"),
    tare_weight_kg: optNum(formData, "tareWeightKg"),
    current_condition: str(formData, "currentCondition") || "good",
    current_location: optStr(formData, "currentLocation"),
    commission_date: optStr(formData, "commissionDate"),
    last_inspection_date: optStr(formData, "lastInspectionDate"),
    next_inspection_date: optStr(formData, "nextInspectionDate"),
    notes: optStr(formData, "notes"),
  };
}

export async function createContainer(formData: FormData) {
  const { supabase, orgId, userId } = await requireManage();
  const code = str(formData, "containerCode");
  if (!code) return { error: "Container number/code is required." };
  const fields = containerFields(formData);
  if (fields.ownership === "rented" && fields.rental_rate == null) return { error: "A rented container needs a rental rate." };

  const { data, error } = await supabase
    .from("containers")
    .insert({ org_id: orgId, container_code: code, ...fields, created_by: userId, updated_by: userId })
    .select("id")
    .single();
  if (error) {
    if (error.message.includes("containers_org_id_container_code_key")) return { error: `A container with code "${code}" already exists.` };
    return { error: error.message };
  }
  revalidate();
  return { id: data?.id };
}

export async function updateContainer(id: string, formData: FormData) {
  const { supabase, userId } = await requireManage();
  const code = str(formData, "containerCode");
  if (!code) return { error: "Container number/code is required." };
  const fields = containerFields(formData);
  const { error } = await supabase
    .from("containers")
    .update({ container_code: code, ...fields, updated_by: userId, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidate(id);
  return {};
}

export async function setContainerActive(id: string, active: boolean) {
  const { supabase, userId } = await requireManage();
  const container = await getContainer(supabase, id);
  if (!active && container.availability_status !== "available") return { error: "Only an available container can be retired — close its open movement first." };
  const { error } = await supabase.from("containers").update({ is_active: active, updated_by: userId }).eq("id", id);
  if (error) return { error: error.message };
  revalidate(id);
  return {};
}

/* ================= Movements ================= */

export async function createMovement(containerId: string, formData: FormData) {
  const { supabase, orgId, userId } = await requireManage();
  const container = await getContainer(supabase, containerId);
  if (!container.is_active) return { error: "This container is retired." };
  if (container.availability_status !== "available") {
    return { error: `This container is ${container.availability_status.replace(/_/g, " ")} — it can only be reserved while available.` };
  }
  const projectId = str(formData, "projectId");
  if (!projectId) return { error: "Every movement must be linked to a project." };

  const { data, error } = await supabase
    .from("container_movements")
    .insert({
      org_id: orgId,
      container_id: containerId,
      project_id: projectId,
      offshore_site_id: optStr(formData, "offshoreSiteId"),
      from_location: optStr(formData, "fromLocation") ?? container.current_location,
      to_location: optStr(formData, "toLocation"),
      dispatch_date: optStr(formData, "dispatchDate"),
      expected_arrival_date: optStr(formData, "expectedArrivalDate"),
      transport_reference: optStr(formData, "transportReference"),
      shipping_cost: num0(formData, "shippingCost"),
      customs_port_cost: num0(formData, "customsPortCost"),
      handling_cost: num0(formData, "handlingCost"),
      currency: str(formData, "currency") || "USD",
      remarks: optStr(formData, "remarks"),
      status: "reserved",
      created_by: userId,
      updated_by: userId,
    })
    .select("id")
    .single();
  if (error) {
    if (error.message.includes("container_movements_one_open_idx")) return { error: "This container already has an open movement — overlapping movements aren't allowed." };
    return { error: error.message };
  }
  await supabase.from("containers").update({ availability_status: "reserved", updated_by: userId }).eq("id", containerId);
  revalidate(containerId);
  return { id: data?.id };
}

export async function updateMovementDetails(movementId: string, formData: FormData) {
  const { supabase, userId } = await requireManage();
  const m = await getMovement(supabase, movementId);
  if (["returned", "cancelled"].includes(m.status)) return { error: "This movement is closed." };
  const projectId = str(formData, "projectId");
  if (!projectId) return { error: "Every movement must be linked to a project." };
  const { error } = await supabase
    .from("container_movements")
    .update({
      project_id: projectId,
      offshore_site_id: optStr(formData, "offshoreSiteId"),
      from_location: optStr(formData, "fromLocation"),
      to_location: optStr(formData, "toLocation"),
      expected_arrival_date: optStr(formData, "expectedArrivalDate"),
      transport_reference: optStr(formData, "transportReference"),
      shipping_cost: num0(formData, "shippingCost"),
      customs_port_cost: num0(formData, "customsPortCost"),
      handling_cost: num0(formData, "handlingCost"),
      currency: str(formData, "currency") || "USD",
      remarks: optStr(formData, "remarks"),
      updated_by: userId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", movementId);
  if (error) return { error: error.message };
  revalidate(m.container_id);
  return {};
}

// Movement costs can be adjusted any time (invoices arrive late).
export async function updateMovementCosts(movementId: string, formData: FormData) {
  const { supabase, userId } = await requireManage();
  const m = await getMovement(supabase, movementId);
  const { error } = await supabase
    .from("container_movements")
    .update({
      shipping_cost: num0(formData, "shippingCost"),
      customs_port_cost: num0(formData, "customsPortCost"),
      handling_cost: num0(formData, "handlingCost"),
      updated_by: userId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", movementId);
  if (error) return { error: error.message };
  revalidate(m.container_id);
  return {};
}

const NEXT: Record<string, string> = {
  reserved: "loading",
  loading: "dispatched",
  dispatched: "in_transit",
  in_transit: "received_offshore",
  received_offshore: "in_use",
  in_use: "return_requested",
  return_requested: "returned",
};

// One linear step forward. Dispatch checks the inspection window; receipt
// requires the offshore receipt fields; return moves the container into
// inspection (an inspection record makes it available again).
export async function advanceMovement(movementId: string, formData: FormData) {
  const { supabase, userId } = await requireManage();
  const m = await getMovement(supabase, movementId);
  const next = NEXT[m.status];
  if (!next) return { error: `This movement is ${m.status.replace(/_/g, " ")} and can't move forward.` };
  const container = await getContainer(supabase, m.container_id);

  const update: Record<string, unknown> = { status: next, updated_by: userId, updated_at: new Date().toISOString() };
  const containerUpdate: Record<string, unknown> = { availability_status: next, updated_by: userId };

  if (next === "dispatched") {
    const dispatchDate = str(formData, "dispatchDate") || today();
    if (container.next_inspection_date && container.next_inspection_date < dispatchDate) {
      return { error: `Inspection expired on ${container.next_inspection_date} — record an inspection before dispatching.` };
    }
    if (container.current_condition === "out_of_service") return { error: "This container is out of service." };
    update.dispatch_date = dispatchDate;
    if (optStr(formData, "transportReference")) update.transport_reference = optStr(formData, "transportReference");
    if (optStr(formData, "expectedArrivalDate")) update.expected_arrival_date = optStr(formData, "expectedArrivalDate");
    containerUpdate.current_location = m.to_location ? `In transit to ${m.to_location}` : "In transit";
  }
  if (next === "in_transit") {
    containerUpdate.current_location = m.to_location ? `In transit to ${m.to_location}` : "In transit";
  }
  if (next === "received_offshore") {
    const receivedBy = str(formData, "receivedBy");
    if (!receivedBy) return { error: "Receipt must record who received the container." };
    update.actual_arrival_date = str(formData, "actualArrivalDate") || today();
    update.received_at = new Date().toISOString();
    update.received_by = receivedBy;
    update.receipt_shortages = str(formData, "receiptShortages") || "None";
    update.receipt_damage = str(formData, "receiptDamage") || "None";
    update.receipt_temperature_exceptions = str(formData, "receiptTemperatureExceptions") || "None";
    containerUpdate.current_location = m.to_location ?? "Offshore";
  }
  if (next === "returned") {
    const returnDate = str(formData, "returnDate") || today();
    if (m.dispatch_date && returnDate < m.dispatch_date) return { error: "Return date can't be before the dispatch date." };
    update.return_date = returnDate;
    containerUpdate.availability_status = "inspection";
    containerUpdate.current_location = optStr(formData, "returnLocation") ?? m.from_location ?? "Base";
  }

  const { error } = await supabase.from("container_movements").update(update).eq("id", movementId);
  if (error) return { error: error.message };
  await supabase.from("containers").update(containerUpdate).eq("id", m.container_id);
  revalidate(m.container_id);
  return { status: next };
}

export async function cancelMovement(movementId: string, reason: string) {
  const { supabase, userId } = await requireManage();
  const m = await getMovement(supabase, movementId);
  if (!["reserved", "loading"].includes(m.status)) return { error: "Only a reserved or loading movement can be cancelled — a dispatched container must be returned instead." };
  if (!reason.trim()) return { error: "A reason is required to cancel a movement." };
  const { error } = await supabase
    .from("container_movements")
    .update({ status: "cancelled", remarks: `Cancelled — ${reason.trim()}`, updated_by: userId, updated_at: new Date().toISOString() })
    .eq("id", movementId);
  if (error) return { error: error.message };
  await supabase.from("containers").update({ availability_status: "available", updated_by: userId }).eq("id", m.container_id);
  revalidate(m.container_id);
  return {};
}

/* ================= Load ================= */

export async function addLoadItem(movementId: string, formData: FormData) {
  const { supabase, orgId } = await requireManage();
  const m = await getMovement(supabase, movementId);
  if (!["reserved", "loading", "dispatched", "in_transit"].includes(m.status)) return { error: "Load can only be edited before the container is received offshore." };
  const category = str(formData, "category");
  if (!LOAD_CATEGORIES.some((c) => c.value === category)) return { error: "Select a load category." };
  const { error } = await supabase.from("container_load_items").insert({
    org_id: orgId,
    movement_id: movementId,
    category,
    description: optStr(formData, "description"),
    quantity: optNum(formData, "quantity"),
    unit: optStr(formData, "unit"),
    value: optNum(formData, "value"),
    currency: optStr(formData, "currency"),
    temperature_requirement: optStr(formData, "temperatureRequirement"),
    expiry_consideration: optStr(formData, "expiryConsideration"),
    notes: optStr(formData, "notes"),
  });
  if (error) return { error: error.message };
  revalidate(m.container_id);
  return {};
}

export async function removeLoadItem(itemId: string, containerId: string) {
  const { supabase } = await requireManage();
  const { error } = await supabase.from("container_load_items").delete().eq("id", itemId);
  if (error) return { error: error.message };
  revalidate(containerId);
  return {};
}

/* ================= Incidents (damage / loss) ================= */

export async function addIncident(containerId: string, formData: FormData) {
  const { supabase, orgId, userId } = await requireManage();
  const incidentType = str(formData, "incidentType");
  if (!["damage", "loss"].includes(incidentType)) return { error: "Select damage or loss." };
  const description = str(formData, "description");
  if (!description) return { error: "Describe the damage/loss." };
  const { error } = await supabase.from("container_incidents").insert({
    org_id: orgId,
    container_id: containerId,
    movement_id: optStr(formData, "movementId"),
    incident_type: incidentType,
    description,
    estimated_recovery_cost: optNum(formData, "estimatedRecoveryCost"),
    currency: optStr(formData, "currency"),
    reported_by: userId,
  });
  if (error) return { error: error.message };
  // Damage marks the container damaged; loss takes it out of service.
  await supabase
    .from("containers")
    .update({ current_condition: incidentType === "loss" ? "out_of_service" : "damaged", updated_by: userId })
    .eq("id", containerId);
  revalidate(containerId);
  return {};
}

export async function resolveIncident(incidentId: string, containerId: string, notes: string) {
  const { supabase } = await requireManage();
  const { error } = await supabase
    .from("container_incidents")
    .update({ is_resolved: true, resolution_notes: notes.trim() || null, resolved_at: new Date().toISOString() })
    .eq("id", incidentId);
  if (error) return { error: error.message };
  revalidate(containerId);
  return {};
}

/* ================= Maintenance & inspection ================= */

export async function addMaintenance(containerId: string, formData: FormData) {
  const { supabase, orgId, userId } = await requireManage();
  const container = await getContainer(supabase, containerId);
  const maintenanceType = str(formData, "maintenanceType");
  if (!["inspection", "repair", "cleaning", "other"].includes(maintenanceType)) return { error: "Select a maintenance type." };
  const performedDate = str(formData, "performedDate") || today();
  const nextInspectionDate = optStr(formData, "nextInspectionDate");
  const conditionAfter = optStr(formData, "conditionAfter");
  if (maintenanceType === "inspection" && !nextInspectionDate) return { error: "An inspection needs a next inspection date." };

  const { error } = await supabase.from("container_maintenance").insert({
    org_id: orgId,
    container_id: containerId,
    maintenance_type: maintenanceType,
    performed_date: performedDate,
    cost: num0(formData, "cost"),
    currency: optStr(formData, "currency"),
    next_inspection_date: nextInspectionDate,
    condition_after: conditionAfter,
    notes: optStr(formData, "notes"),
    created_by: userId,
  });
  if (error) return { error: error.message };

  const update: Record<string, unknown> = { updated_by: userId };
  if (conditionAfter) update.current_condition = conditionAfter;
  if (maintenanceType === "inspection") {
    update.last_inspection_date = performedDate;
    update.next_inspection_date = nextInspectionDate;
    if (container.availability_status === "inspection") update.availability_status = "available";
  }
  await supabase.from("containers").update(update).eq("id", containerId);
  revalidate(containerId);
  return {};
}
