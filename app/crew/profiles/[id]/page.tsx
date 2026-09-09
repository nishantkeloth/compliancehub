import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import AppShell from "@/app/app-shell";
import { getEffectiveAccess, can } from "@/lib/rbac";
import CrewEditor from "./crew-editor";

const BASE_FIELDS =
  "id, org_id, employee_code, full_name, photo_url, employment_status, nationality, date_of_birth, gender, phone, email, home_country, current_location, nearest_airport, primary_job_role_id, employment_type, joining_date, notice_period_days, availability_date, default_rotation_template_id, emergency_contact_name, emergency_contact_phone, notes, linked_profile_id, job_roles(name), rotation_templates(name)";

export default async function CrewProfileDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "crew.view")) redirect("/");
  const canManage = can(access, "crew.manage");
  const canViewCost = can(access, "crew.view_cost");
  const canViewSensitive = can(access, "crew.view_sensitive");

  const fields =
    BASE_FIELDS +
    (canViewCost ? ", day_rate, currency" : "") +
    (canViewSensitive ? ", dietary_medical_notes" : "");

  const { data: crew } = await supabase.from("crew_profiles").select(fields).eq("id", id).single();
  if (!crew || (crew as any).org_id !== access.orgId) notFound();

  const [jobRolesRes, rotationTemplatesRes, skillsRes, crewSkillsRes, secondaryRolesRes, profilesRes] = await Promise.all([
    supabase.from("job_roles").select("id, name").eq("org_id", access.orgId).eq("is_active", true).order("name"),
    supabase.from("rotation_templates").select("id, name").eq("org_id", access.orgId).eq("is_active", true).order("name"),
    supabase.from("skills").select("id, name").eq("org_id", access.orgId).order("name"),
    supabase.from("crew_skills").select("id, skill_id, years_experience, competency_grade, skills(name)").eq("crew_id", id),
    supabase.from("crew_secondary_roles").select("id, job_role_id, job_roles(name)").eq("crew_id", id),
    canManage
      ? supabase.from("profiles").select("id, full_name").eq("org_id", access.orgId).order("full_name")
      : Promise.resolve({ data: [] }),
  ]);

  return (
    <AppShell active="crew-profiles" title={(crew as any).full_name}>
      <Link href="/crew/profiles" className="text-sm hover:underline" style={{ color: "var(--ch-navy)" }}>
        ‹ All crew profiles
      </Link>

      <CrewEditor
        crew={crew as any}
        canManage={canManage}
        canViewCost={canViewCost}
        canViewSensitive={canViewSensitive}
        jobRoles={jobRolesRes.data ?? []}
        rotationTemplates={rotationTemplatesRes.data ?? []}
        skills={skillsRes.data ?? []}
        crewSkills={crewSkillsRes.data ?? []}
        secondaryRoles={secondaryRolesRes.data ?? []}
        profiles={(profilesRes.data ?? []).map((p: any) => ({ id: p.id, name: p.full_name }))}
      />
    </AppShell>
  );
}
