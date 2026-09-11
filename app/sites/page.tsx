import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getEffectiveAccess, can } from "@/lib/rbac";
import OffshoreSitesPanel from "./sites-panel";

export default async function OffshoreSitesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "crew.manage")) redirect("/");

  const [sitesRes, manningRes, contractorsRes, clientsRes, projectsRes, rotationTemplatesRes, jobRolesRes] = await Promise.all([
    supabase
      .from("offshore_sites")
      .select(
        "id, name, code, site_type, country, operating_region, port_or_heliport, crew_change_location, status, notes, contractor_id, standard_rotation_template_id, project_id"
      )
      .eq("org_id", access.orgId)
      .order("name"),
    supabase.from("site_manning_requirements").select("id, offshore_site_id, job_role_id, minimum_headcount").eq("org_id", access.orgId),
    supabase.from("contractors").select("id, name, client_id").eq("org_id", access.orgId).order("name"),
    supabase.from("clients").select("id, name").eq("org_id", access.orgId).order("name"),
    supabase.from("projects").select("id, project_name, contractor_id").eq("org_id", access.orgId).order("project_name"),
    supabase.from("rotation_templates").select("id, name").eq("org_id", access.orgId).order("name"),
    supabase.from("job_roles").select("id, name, category, is_active").eq("org_id", access.orgId).order("name"),
  ]);

  return (
    <>
      <p className="text-sm mb-6" style={{ color: "var(--ch-sub)" }}>
        Vessels, rigs, platforms and camps you crew and supply. Each site sits under an EPC
        contractor and project; crew matrices, mobilizations, rotations, containers and daily
        operations all hang off the site.
      </p>
      <OffshoreSitesPanel
        sites={sitesRes.data ?? []}
        contractors={contractorsRes.data ?? []}
        clients={clientsRes.data ?? []}
        rotationTemplates={rotationTemplatesRes.data ?? []}
        jobRoles={jobRolesRes.data ?? []}
        manningRequirements={manningRes.data ?? []}
        projects={projectsRes.data ?? []}
      />
    </>
  );
}
