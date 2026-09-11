import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getEffectiveAccess, can } from "@/lib/rbac";
import { summarizeContainer, costByKey } from "@/lib/containers";
import ContainersList, { type ContainerRow, type CostReportRow } from "./containers-list";

function unwrap<T>(x: T | T[] | null | undefined): T | null {
  if (!x) return null;
  return Array.isArray(x) ? x[0] ?? null : x;
}

export default async function ContainersPage() {
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

  const [containersRes, movementsRes, maintenanceRes, projectsRes, sitesRes] = await Promise.all([
    supabase
      .from("containers")
      .select("id, container_code, container_type, ownership, supplier_lessor, rental_rate, rate_basis, currency, current_condition, current_location, availability_status, commission_date, next_inspection_date, is_active, created_at")
      .eq("org_id", orgId)
      .order("container_code"),
    supabase
      .from("container_movements")
      .select("id, container_id, project_id, offshore_site_id, status, dispatch_date, return_date, shipping_cost, customs_port_cost, handling_cost, to_location, projects(project_code, project_name), offshore_sites(name)")
      .eq("org_id", orgId),
    supabase.from("container_maintenance").select("container_id, cost").eq("org_id", orgId),
    supabase.from("projects").select("id, project_code, project_name").eq("org_id", orgId),
    supabase.from("offshore_sites").select("id, name").eq("org_id", orgId),
  ]);

  const containers = containersRes.data ?? [];
  const movements = (movementsRes.data ?? []) as any[];
  const maintenance = maintenanceRes.data ?? [];

  const openByContainer: Record<string, any> = {};
  for (const m of movements) if (!["returned", "cancelled"].includes(m.status)) openByContainer[m.container_id] = m;

  const rows: ContainerRow[] = containers.map((c: any) => {
    const s = summarizeContainer(c, movements, maintenance, today);
    const open = openByContainer[c.id];
    const project = unwrap<{ project_code?: string; project_name?: string }>(open?.projects);
    const site = unwrap<{ name?: string }>(open?.offshore_sites);
    return {
      id: c.id,
      code: c.container_code,
      type: c.container_type,
      ownership: c.ownership,
      currency: c.currency,
      condition: c.current_condition,
      location: c.current_location,
      status: c.availability_status,
      nextInspectionDate: c.next_inspection_date,
      inspectionExpired: !!c.next_inspection_date && c.next_inspection_date < today,
      isActive: c.is_active,
      openProject: project ? `${project.project_code ?? ""} ${project.project_name ?? ""}`.trim() : null,
      openVessel: site?.name ?? null,
      movements: s.movements,
      daysDeployed: s.daysDeployed,
      utilizationPct: s.utilizationPct,
      totalCost: s.totalCost,
    };
  });

  const byProject = costByKey(containers, movements, "project_id", today);
  const bySite = costByKey(containers, movements, "offshore_site_id", today);
  const projectReport: CostReportRow[] = Object.entries(byProject).map(([id, v]) => {
    const p = (projectsRes.data ?? []).find((x) => x.id === id);
    return { id, label: p ? `${p.project_code ?? ""} ${p.project_name ?? ""}`.trim() : "Unknown project", ...v };
  });
  const siteReport: CostReportRow[] = Object.entries(bySite).map(([id, v]) => {
    const s = (sitesRes.data ?? []).find((x) => x.id === id);
    return { id, label: s?.name ?? "Unknown vessel", ...v };
  });

  return (
    <>
      <p className="text-sm mb-6" style={{ color: "var(--ch-sub)" }}>
        Container master, movements and load — kept deliberately simple. Status and location
        update automatically as a movement progresses; costs and utilization are computed from
        the movement history.
      </p>
      <ContainersList rows={rows} projectReport={projectReport} siteReport={siteReport} canManage={canManage} />
    </>
  );
}
