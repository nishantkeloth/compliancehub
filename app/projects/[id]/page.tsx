import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import { getEffectiveAccess, can } from "@/lib/rbac";
import ProjectDetail from "./project-detail";

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "projects.view") || !access.orgId) redirect("/");

  const [{ data: project }, { data: sites }, { data: contracts }, { data: contractors }, { data: members }] = await Promise.all([
    supabase
      .from("projects")
      .select("*, contracts(id, contract_title, status, client_id, clients(name)), contractors(id, name, client_id)")
      .eq("id", id)
      .eq("org_id", access.orgId)
      .single(),
    supabase.from("offshore_sites").select("id, name, code, site_type, status").eq("project_id", id).order("name"),
    supabase.from("contracts").select("id, contract_title, status, client_id").eq("org_id", access.orgId).order("contract_title"),
    supabase.from("contractors").select("id, name, is_active, client_id").eq("org_id", access.orgId).eq("is_active", true).order("name"),
    supabase.from("profiles").select("id, full_name").eq("org_id", access.orgId).eq("status", "active").order("full_name"),
  ]);

  if (!project) notFound();

  const contract = Array.isArray(project.contracts) ? project.contracts[0] : project.contracts;
  const contractClient = contract ? (Array.isArray(contract.clients) ? contract.clients[0] : contract.clients) : null;
  const contractor = Array.isArray(project.contractors) ? project.contractors[0] : project.contractors;

  return (
    <ProjectDetail
      project={{
        id: project.id,
        project_code: project.project_code,
        project_name: project.project_name,
        client_reference: project.client_reference,
        purchase_order_number: project.purchase_order_number,
        country: project.country,
        operating_region: project.operating_region,
        base_port: project.base_port,
        mobilization_location: project.mobilization_location,
        demobilization_location: project.demobilization_location,
        planned_start_date: project.planned_start_date,
        planned_end_date: project.planned_end_date,
        actual_start_date: project.actual_start_date,
        actual_end_date: project.actual_end_date,
        expected_pob: project.expected_pob,
        project_manager_user_id: project.project_manager_user_id,
        operations_coordinator_user_id: project.operations_coordinator_user_id,
        status: project.status,
        notes: project.notes,
        contract_id: project.contract_id,
        contractor_id: project.contractor_id,
        contract_title: contract?.contract_title ?? "—",
        contract_status: contract?.status ?? "draft",
        client_name: contractClient?.name ?? "—",
        contractor_name: contractor?.name ?? "—",
      }}
      sites={sites ?? []}
      contracts={contracts ?? []}
      contractors={contractors ?? []}
      members={members ?? []}
      canManage={can(access, "projects.manage")}
    />
  );
}
