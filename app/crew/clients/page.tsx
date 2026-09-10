import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getEffectiveAccess, can } from "@/lib/rbac";
import ClientsManager from "./clients-manager";

export default async function ClientsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "crew.manage")) redirect("/");

  const { data: clients } = await supabase
    .from("clients")
    .select("id, name, code, contract_number, contract_start_date, contract_end_date, billing_model, notes, is_active")
    .eq("org_id", access.orgId)
    .order("name");

  return (
    <>
      <p className="text-sm mb-6" style={{ color: "var(--ch-sub)" }}>
        Asset owners / end customers at the top of the hierarchy — each may have multiple EPC
        Contractors under them.
      </p>
      <ClientsManager clients={clients ?? []} />
    </>
  );
}
