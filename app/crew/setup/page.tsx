import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getEffectiveAccess, can } from "@/lib/rbac";
import SetupTabs from "./setup-tabs";

export default async function CrewSetupPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "crew.manage")) redirect("/");

  const [jobRolesRes, skillsRes, clientsRes, contractorsRes, rotationTemplatesRes, offshoreSitesRes, manningRes, documentTypesRes, customFieldDefinitionsRes, projectsRes] = await Promise.all([
    supabase.from("job_roles").select("id, name, category, is_active").eq("org_id", access.orgId).order("name"),
    supabase.from("skills").select("id, name").eq("org_id", access.orgId).order("name"),
    supabase.from("clients").select("id, name, code, contract_number, contract_start_date, contract_end_date, billing_model, notes, is_active").eq("org_id", access.orgId).order("name"),
    supabase.from("contractors").select("id, name, code, client_id, notes, is_active").eq("org_id", access.orgId).order("name"),
    supabase.from("rotation_templates").select("id, name, pattern_type, days_on, days_off, notes, is_active").eq("org_id", access.orgId).order("name"),
    supabase
      .from("offshore_sites")
      .select(
        "id, name, code, site_type, country, operating_region, port_or_heliport, crew_change_location, status, notes, contractor_id, standard_rotation_template_id, project_id"
      )
      .eq("org_id", access.orgId)
      .order("name"),
    supabase
      .from("site_manning_requirements")
      .select("id, offshore_site_id, job_role_id, minimum_headcount")
      .eq("org_id", access.orgId),
    supabase
      .from("document_types")
      .select("id, name, category, default_validity_months, warning_threshold_days, tracks_number, is_active")
      .eq("org_id", access.orgId)
      .order("name"),
    supabase
      .from("document_custom_field_definitions")
      .select("id, label, field_key, field_type, applies_to_document_type_id, sort_order, is_active")
      .eq("org_id", access.orgId)
      .order("label"),
    supabase.from("projects").select("id, project_name, contractor_id").eq("org_id", access.orgId).order("project_name"),
  ]);

  return (
    <>
      <p className="text-sm mb-6" style={{ color: "var(--ch-sub)" }}>
        Master data for the Crew Matrix & Offshore Deployment module — job roles, skills, clients,
        rotation templates, and offshore sites. The crew matrix and assignment screens build on
        this and come next.
      </p>

      <SetupTabs
        jobRoles={jobRolesRes.data ?? []}
        skills={skillsRes.data ?? []}
        clients={clientsRes.data ?? []}
        contractors={contractorsRes.data ?? []}
        rotationTemplates={rotationTemplatesRes.data ?? []}
        offshoreSites={offshoreSitesRes.data ?? []}
        manningRequirements={manningRes.data ?? []}
        documentTypes={documentTypesRes.data ?? []}
        customFieldDefinitions={customFieldDefinitionsRes.data ?? []}
        projects={projectsRes.data ?? []}
      />
    </>
  );
}
