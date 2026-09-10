import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import { getEffectiveAccess, can } from "@/lib/rbac";
import ContractDetail from "./contract-detail";

export default async function ContractDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "contracts.view") || !access.orgId) redirect("/");

  const [
    { data: contract },
    { data: services },
    { data: projects },
    { data: documents },
    { data: history },
    { data: clients },
    { data: members },
  ] = await Promise.all([
    supabase
      .from("contracts")
      .select("*, clients(id, name)")
      .eq("id", id)
      .eq("org_id", access.orgId)
      .single(),
    supabase.from("contract_services").select("service").eq("contract_id", id),
    supabase
      .from("projects")
      .select("id, project_code, project_name, status, contractors(id, name)")
      .eq("contract_id", id)
      .order("created_at", { ascending: false }),
    supabase.from("contract_documents").select("id, title, document_url, notes, created_at").eq("contract_id", id).order("created_at", { ascending: false }),
    supabase
      .from("contract_status_history")
      .select("id, old_status, new_status, changed_at")
      .eq("contract_id", id)
      .order("changed_at", { ascending: false })
      .limit(20),
    supabase.from("clients").select("id, name").eq("org_id", access.orgId).eq("is_active", true).order("name"),
    supabase.from("profiles").select("id, full_name").eq("org_id", access.orgId).eq("status", "active").order("full_name"),
  ]);

  if (!contract) notFound();

  const clientRel = Array.isArray(contract.clients) ? contract.clients[0] : contract.clients;
  const relatedContractors = new Map<string, string>();
  for (const p of projects ?? []) {
    const c = Array.isArray(p.contractors) ? p.contractors[0] : p.contractors;
    if (c?.id) relatedContractors.set(c.id, c.name);
  }

  return (
    <ContractDetail
      contract={{
        id: contract.id,
        contract_code: contract.contract_code,
        contract_number: contract.contract_number,
        contract_title: contract.contract_title,
        description: contract.description,
        award_date: contract.award_date,
        planned_start_date: contract.planned_start_date,
        planned_end_date: contract.planned_end_date,
        actual_start_date: contract.actual_start_date,
        actual_end_date: contract.actual_end_date,
        currency: contract.currency,
        estimated_contract_value: contract.estimated_contract_value,
        billing_model: contract.billing_model,
        payment_terms: contract.payment_terms,
        mobilization_notice_days: contract.mobilization_notice_days,
        contract_manager_user_id: contract.contract_manager_user_id,
        operations_manager_user_id: contract.operations_manager_user_id,
        status: contract.status,
        notes: contract.notes,
        client_id: clientRel?.id ?? contract.client_id,
        client_name: clientRel?.name ?? "—",
      }}
      services={(services ?? []).map((s) => s.service as string)}
      projects={(projects ?? []).map((p) => {
        const c = Array.isArray(p.contractors) ? p.contractors[0] : p.contractors;
        return {
          id: p.id as string,
          project_code: p.project_code as string | null,
          project_name: p.project_name as string,
          status: p.status as string,
          contractor_name: (c as { name?: string } | null)?.name ?? "—",
        };
      })}
      contractors={Array.from(relatedContractors, ([id, name]) => ({ id, name }))}
      documents={documents ?? []}
      history={history ?? []}
      clients={clients ?? []}
      members={members ?? []}
      canManage={can(access, "contracts.manage")}
      canViewValue={can(access, "contracts.view_value")}
    />
  );
}
