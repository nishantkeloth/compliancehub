import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getEffectiveAccess, can } from "@/lib/rbac";
import MobilizationsManager from "./mobilizations-manager";

export default async function MobilizationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "mobilization.view") || !access.orgId) redirect("/");

  const { data: requests } = await supabase
    .from("mobilization_requests")
    .select(
      "id, mobilization_number, mobilization_type, status, priority, required_onboard_date, projects(project_name), offshore_sites(name)"
    )
    .eq("org_id", access.orgId)
    .order("created_at", { ascending: false });

  const rows = (requests ?? []).map((r) => {
    const project = (Array.isArray(r.projects) ? r.projects[0] : r.projects) as { project_name?: string } | null;
    const site = (Array.isArray(r.offshore_sites) ? r.offshore_sites[0] : r.offshore_sites) as { name?: string } | null;
    return {
      id: r.id as string,
      mobilization_number: r.mobilization_number as string | null,
      mobilization_type: r.mobilization_type as string,
      status: r.status as string,
      priority: r.priority as string,
      required_onboard_date: r.required_onboard_date as string,
      project_name: project?.project_name ?? "—",
      site_name: site?.name ?? "—",
    };
  });

  return (
    <>
      <p className="text-sm mb-6" style={{ color: "var(--ch-sub)" }}>
        Mobilization requests and manpower planning — generated from an approved crew matrix,
        carried from candidate selection through boarding.
      </p>
      <MobilizationsManager requests={rows} canManage={can(access, "mobilization.manage")} />
    </>
  );
}
