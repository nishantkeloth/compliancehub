import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getEffectiveAccess, can } from "@/lib/rbac";
import ContractorsManager from "./contractors-manager";

export default async function ContractorsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "crew.manage")) redirect("/");

  const [contractorsRes, clientsRes] = await Promise.all([
    supabase
      .from("contractors")
      .select("id, name, code, client_id, notes, is_active")
      .eq("org_id", access.orgId)
      .order("name"),
    supabase.from("clients").select("id, name").eq("org_id", access.orgId).order("name"),
  ]);

  return (
    <>
      <p className="text-sm mb-6" style={{ color: "var(--ch-sub)" }}>
        EPC Contractors executing a project for a Client — each may operate multiple offshore
        vessels/sites, configured in Crew Setup.
      </p>
      <ContractorsManager contractors={contractorsRes.data ?? []} clients={clientsRes.data ?? []} />
    </>
  );
}
