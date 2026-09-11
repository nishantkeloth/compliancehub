import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getEffectiveAccess, can } from "@/lib/rbac";
import { summarizeContainer, movementCost } from "@/lib/containers";
import ContainerDetail, { type Movement, type LoadItem, type Incident, type Maintenance } from "./container-detail";

function unwrap<T>(x: T | T[] | null | undefined): T | null {
  if (!x) return null;
  return Array.isArray(x) ? x[0] ?? null : x;
}

export default async function ContainerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "containers.view") || !access.orgId) redirect("/");
  const canManage = can(access, "containers.manage");
  const orgId = access.orgId;
  const today = new Date().toISOString().slice(0, 10);

  const { data: container } = await supabase.from("containers").select("*").eq("id", id).single();
  if (!container || container.org_id !== orgId) notFound();

  const [movementsRes, maintenanceRes, incidentsRes, projectsRes, sitesRes, profilesRes] = await Promise.all([
    supabase
      .from("container_movements")
      .select("*, projects(project_code, project_name), offshore_sites(name)")
      .eq("container_id", id)
      .order("created_at", { ascending: false }),
    supabase.from("container_maintenance").select("*").eq("container_id", id).order("performed_date", { ascending: false }),
    supabase.from("container_incidents").select("*").eq("container_id", id).order("reported_at", { ascending: false }),
    supabase.from("projects").select("id, project_code, project_name, status").eq("org_id", orgId).order("project_name"),
    supabase.from("offshore_sites").select("id, name").eq("org_id", orgId).eq("status", "active").order("name"),
    supabase.from("profiles").select("id, full_name").eq("org_id", orgId),
  ]);
  const movementRows = (movementsRes.data ?? []) as any[];
  const movementIds = movementRows.map((m) => m.id);
  const { data: loadRows } = movementIds.length
    ? await supabase.from("container_load_items").select("*").in("movement_id", movementIds).order("created_at")
    : { data: [] };

  const profileName = (uid: string | null) => (uid ? (profilesRes.data ?? []).find((p) => p.id === uid)?.full_name ?? "—" : "—");

  const summary = summarizeContainer(container, movementRows, maintenanceRes.data ?? [], today);

  const movements: Movement[] = movementRows.map((m) => {
    const project = unwrap<{ project_code?: string; project_name?: string }>(m.projects);
    const site = unwrap<{ name?: string }>(m.offshore_sites);
    const cost = movementCost(container, m, today);
    return {
      id: m.id,
      status: m.status,
      projectId: m.project_id,
      projectLabel: project ? `${project.project_code ?? ""} ${project.project_name ?? ""}`.trim() : "—",
      offshoreSiteId: m.offshore_site_id,
      siteName: site?.name ?? null,
      fromLocation: m.from_location,
      toLocation: m.to_location,
      dispatchDate: m.dispatch_date,
      expectedArrivalDate: m.expected_arrival_date,
      actualArrivalDate: m.actual_arrival_date,
      returnDate: m.return_date,
      transportReference: m.transport_reference,
      shippingCost: Number(m.shipping_cost ?? 0),
      customsPortCost: Number(m.customs_port_cost ?? 0),
      handlingCost: Number(m.handling_cost ?? 0),
      currency: m.currency,
      receivedBy: m.received_by,
      receivedAt: m.received_at,
      receiptShortages: m.receipt_shortages,
      receiptDamage: m.receipt_damage,
      receiptTemperatureExceptions: m.receipt_temperature_exceptions,
      remarks: m.remarks,
      createdAt: m.created_at,
      daysDeployed: cost.days,
      rentalShare: cost.rental,
      totalCost: cost.total,
    };
  });

  const loadItems: LoadItem[] = (loadRows ?? []).map((l: any) => ({
    id: l.id,
    movementId: l.movement_id,
    category: l.category,
    description: l.description,
    quantity: l.quantity != null ? Number(l.quantity) : null,
    unit: l.unit,
    value: l.value != null ? Number(l.value) : null,
    currency: l.currency,
    temperatureRequirement: l.temperature_requirement,
    expiryConsideration: l.expiry_consideration,
    notes: l.notes,
  }));

  const incidents: Incident[] = (incidentsRes.data ?? []).map((i: any) => ({
    id: i.id,
    movementId: i.movement_id,
    type: i.incident_type,
    description: i.description,
    estimatedRecoveryCost: i.estimated_recovery_cost != null ? Number(i.estimated_recovery_cost) : null,
    currency: i.currency,
    reportedAt: i.reported_at,
    reportedByName: profileName(i.reported_by),
    isResolved: i.is_resolved,
    resolutionNotes: i.resolution_notes,
  }));

  const maintenance: Maintenance[] = (maintenanceRes.data ?? []).map((x: any) => ({
    id: x.id,
    type: x.maintenance_type,
    performedDate: x.performed_date,
    cost: Number(x.cost ?? 0),
    currency: x.currency,
    nextInspectionDate: x.next_inspection_date,
    conditionAfter: x.condition_after,
    notes: x.notes,
    byName: profileName(x.created_by),
  }));

  return (
    <>
      <Link href="/containers" className="text-sm hover:underline" style={{ color: "var(--ch-navy)" }}>‹ All containers</Link>
      <ContainerDetail
        container={{
          id: container.id,
          container_code: container.container_code,
          container_type: container.container_type,
          ownership: container.ownership,
          supplier_lessor: container.supplier_lessor,
          purchase_cost: container.purchase_cost != null ? Number(container.purchase_cost) : null,
          rental_rate: container.rental_rate != null ? Number(container.rental_rate) : null,
          rate_basis: container.rate_basis,
          currency: container.currency,
          capacity: container.capacity,
          tare_weight_kg: container.tare_weight_kg != null ? Number(container.tare_weight_kg) : null,
          current_condition: container.current_condition,
          current_location: container.current_location,
          availability_status: container.availability_status,
          commission_date: container.commission_date,
          last_inspection_date: container.last_inspection_date,
          next_inspection_date: container.next_inspection_date,
          notes: container.notes,
          is_active: container.is_active,
        }}
        summary={summary}
        movements={movements}
        loadItems={loadItems}
        incidents={incidents}
        maintenance={maintenance}
        projects={(projectsRes.data ?? []).map((p: any) => ({ id: p.id, label: `${p.project_code ?? ""} ${p.project_name ?? ""}`.trim(), status: p.status }))}
        sites={(sitesRes.data ?? []).map((s: any) => ({ id: s.id, name: s.name }))}
        canManage={canManage}
        today={today}
      />
    </>
  );
}
