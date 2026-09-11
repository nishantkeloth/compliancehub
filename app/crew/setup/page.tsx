import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
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

  const [jobRolesRes, skillsRes, rotationTemplatesRes, documentTypesRes, customFieldDefinitionsRes] = await Promise.all([
    supabase.from("job_roles").select("id, name, category, is_active").eq("org_id", access.orgId).order("name"),
    supabase.from("skills").select("id, name").eq("org_id", access.orgId).order("name"),
    supabase.from("rotation_templates").select("id, name, pattern_type, days_on, days_off, notes, is_active").eq("org_id", access.orgId).order("name"),
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
  ]);

  return (
    <>
      <p className="text-sm mb-6" style={{ color: "var(--ch-sub)" }}>
        Reference data for the Crew Matrix & Offshore Deployment module — job roles, skills,
        rotation templates, document types and custom fields. Offshore sites are managed under{" "}
        <Link href="/sites" className="font-semibold underline" style={{ color: "var(--ch-navy)" }}>
          Contracts & Projects → Offshore Sites
        </Link>
        .
      </p>

      <SetupTabs
        jobRoles={jobRolesRes.data ?? []}
        skills={skillsRes.data ?? []}
        rotationTemplates={rotationTemplatesRes.data ?? []}
        documentTypes={documentTypesRes.data ?? []}
        customFieldDefinitions={customFieldDefinitionsRes.data ?? []}
      />
    </>
  );
}
