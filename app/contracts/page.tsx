import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getEffectiveAccess, can } from "@/lib/rbac";
import ContractsManager from "./contracts-manager";

export default async function ContractsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "contracts.view") || !access.orgId) redirect("/");

  const [{ data: contracts }, { data: clients }] = await Promise.all([
    supabase
      .from("contracts")
      .select("id, contract_code, contract_title, status, planned_start_date, planned_end_date, estimated_contract_value, clients(name)")
      .eq("org_id", access.orgId)
      .order("created_at", { ascending: false }),
    supabase.from("clients").select("id, name").eq("org_id", access.orgId).eq("is_active", true).order("name"),
  ]);

  const rows = (contracts ?? []).map((c) => {
    const client = Array.isArray(c.clients) ? c.clients[0] : c.clients;
    return {
      id: c.id as string,
      contract_code: c.contract_code as string | null,
      contract_title: c.contract_title as string,
      status: c.status as string,
      planned_start_date: c.planned_start_date as string | null,
      planned_end_date: c.planned_end_date as string | null,
      estimated_contract_value: c.estimated_contract_value as number | null,
      client_name: (client as { name?: string } | null)?.name ?? "—",
    };
  });

  return (
    <>
      <p className="text-sm mb-6" style={{ color: "var(--ch-sub)" }}>
        Commercial contracts with your Clients — each contract holds one or more EPC Contractor
        Projects/Campaigns underneath it.
      </p>
      <ContractsManager
        contracts={rows}
        clients={clients ?? []}
        canManage={can(access, "contracts.manage")}
        canViewValue={can(access, "contracts.view_value")}
      />
    </>
  );
}
