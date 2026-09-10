import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getEffectiveAccess, can } from "@/lib/rbac";
import MatricesManager from "./matrices-manager";

export default async function CrewMatricesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "crew.matrix.view") || !access.orgId) redirect("/");

  const { data: matrices } = await supabase
    .from("crew_matrices")
    .select("id, matrix_number, version_number, title, status, expected_pob, total_required_headcount, effective_from, effective_to, projects(project_name), offshore_sites(name)")
    .eq("org_id", access.orgId)
    .order("matrix_number", { ascending: true })
    .order("version_number", { ascending: false });

  const rows = (matrices ?? []).map((m) => {
    const project = Array.isArray(m.projects) ? m.projects[0] : m.projects;
    const site = Array.isArray(m.offshore_sites) ? m.offshore_sites[0] : m.offshore_sites;
    return {
      id: m.id as string,
      matrix_number: m.matrix_number as string | null,
      version_number: m.version_number as number,
      title: m.title as string,
      status: m.status as string,
      expected_pob: m.expected_pob as number | null,
      total_required_headcount: m.total_required_headcount as number,
      effective_from: m.effective_from as string | null,
      effective_to: m.effective_to as string | null,
      project_name: (project as { project_name?: string } | null)?.project_name ?? "—",
      site_name: (site as { name?: string } | null)?.name ?? "—",
    };
  });

  return (
    <>
      <p className="text-sm mb-6" style={{ color: "var(--ch-sub)" }}>
        Version-controlled crew matrices — one required-manning plan per vessel/site, carried
        through draft, internal approval, client approval, and activation.
      </p>
      <MatricesManager matrices={rows} canManage={can(access, "crew.matrix.manage")} />
    </>
  );
}
