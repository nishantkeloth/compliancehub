import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getEffectiveAccess, can } from "@/lib/rbac";
import ProjectsManager from "./projects-manager";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ contractId?: string }>;
}) {
  const { contractId } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "projects.view") || !access.orgId) redirect("/");

  const [{ data: projects }, { data: contracts }, { data: contractors }] = await Promise.all([
    supabase
      .from("projects")
      .select("id, project_code, project_name, status, planned_start_date, planned_end_date, expected_pob, contracts(id, contract_title), contractors(id, name)")
      .eq("org_id", access.orgId)
      .order("created_at", { ascending: false }),
    supabase.from("contracts").select("id, contract_title, status, client_id").eq("org_id", access.orgId).order("contract_title"),
    supabase.from("contractors").select("id, name, is_active, client_id").eq("org_id", access.orgId).eq("is_active", true).order("name"),
  ]);

  const rows = (projects ?? []).map((p) => {
    const contract = Array.isArray(p.contracts) ? p.contracts[0] : p.contracts;
    const contractor = Array.isArray(p.contractors) ? p.contractors[0] : p.contractors;
    return {
      id: p.id as string,
      project_code: p.project_code as string | null,
      project_name: p.project_name as string,
      status: p.status as string,
      planned_start_date: p.planned_start_date as string | null,
      planned_end_date: p.planned_end_date as string | null,
      expected_pob: p.expected_pob as number | null,
      contract_title: (contract as { contract_title?: string } | null)?.contract_title ?? "—",
      contractor_name: (contractor as { name?: string } | null)?.name ?? "—",
    };
  });

  return (
    <>
      <p className="text-sm mb-6" style={{ color: "var(--ch-sub)" }}>
        Projects/Campaigns run by an EPC Contractor under a Contract — each holds one or more
        offshore sites.
      </p>
      <ProjectsManager
        projects={rows}
        contracts={contracts ?? []}
        contractors={contractors ?? []}
        canManage={can(access, "projects.manage")}
        defaultContractId={contractId ?? ""}
      />
    </>
  );
}
