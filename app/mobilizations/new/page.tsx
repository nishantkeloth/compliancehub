import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getEffectiveAccess, can } from "@/lib/rbac";
import NewMobilizationForm from "./new-mobilization-form";

export default async function NewMobilizationPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "mobilization.manage") || !access.orgId) redirect("/mobilizations");

  const [{ data: matrices }, { data: profiles }] = await Promise.all([
    supabase
      .from("crew_matrices")
      .select("id, matrix_number, version_number, title, status, offshore_site_id, projects(project_name), offshore_sites(name)")
      .eq("org_id", access.orgId)
      .in("status", ["approved", "active"])
      .order("matrix_number"),
    supabase.from("profiles").select("id, full_name").eq("org_id", access.orgId).eq("status", "active").order("full_name"),
  ]);

  const matrixOptions = (matrices ?? []).map((m) => {
    const project = (Array.isArray(m.projects) ? m.projects[0] : m.projects) as { project_name?: string } | null;
    const site = (Array.isArray(m.offshore_sites) ? m.offshore_sites[0] : m.offshore_sites) as { name?: string } | null;
    return {
      id: m.id as string,
      label: `${m.matrix_number ?? "—"} · v${m.version_number} — ${m.title}`,
      site_name: site?.name ?? "—",
      project_name: project?.project_name ?? "—",
      status: m.status as string,
    };
  });

  return (
    <>
      <p className="text-sm mb-6" style={{ color: "var(--ch-sub)" }}>
        A mobilization request must be generated from an approved or active crew matrix — the
        project and offshore site are taken from the matrix you select.
      </p>
      <NewMobilizationForm matrices={matrixOptions} profiles={profiles ?? []} />
    </>
  );
}
