"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveAccess, can } from "@/lib/rbac";

async function requireCrewManage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "crew.manage")) {
    throw new Error("You don't have permission to manage crew profiles.");
  }
  if (!access.orgId) throw new Error("No company context.");
  return { supabase, access, userId: user.id };
}

function str(formData: FormData, key: string) {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}
function optStr(formData: FormData, key: string) {
  const v = str(formData, key);
  return v || null;
}
function optNum(formData: FormData, key: string) {
  const v = str(formData, key);
  return v ? Number(v) : null;
}

const revalidateList = () => revalidatePath("/crew/profiles");
const revalidateDetail = (id: string) => revalidatePath(`/crew/profiles/${id}`);

/* ---------------- Crew profile ---------------- */

export async function createCrewProfile(formData: FormData) {
  const { supabase, access, userId } = await requireCrewManage();
  const fullName = str(formData, "fullName");
  if (!fullName) return { error: "Full name is required." };

  const { data, error } = await supabase
    .from("crew_profiles")
    .insert({
      org_id: access.orgId,
      full_name: fullName,
      employee_code: optStr(formData, "employeeCode"),
      primary_job_role_id: optStr(formData, "primaryJobRoleId"),
      nationality: optStr(formData, "nationality"),
      employment_status: str(formData, "employmentStatus") || "candidate",
      created_by: userId,
      updated_by: userId,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  revalidateList();
  return { id: data.id };
}

export async function updateCrewProfile(id: string, formData: FormData) {
  const { supabase, userId } = await requireCrewManage();
  const fullName = str(formData, "fullName");
  if (!fullName) return { error: "Full name is required." };

  const { error } = await supabase
    .from("crew_profiles")
    .update({
      full_name: fullName,
      employee_code: optStr(formData, "employeeCode"),
      photo_url: optStr(formData, "photoUrl"),
      employment_status: str(formData, "employmentStatus") || "candidate",
      nationality: optStr(formData, "nationality"),
      date_of_birth: optStr(formData, "dateOfBirth"),
      gender: optStr(formData, "gender"),
      phone: optStr(formData, "phone"),
      email: optStr(formData, "email"),
      home_country: optStr(formData, "homeCountry"),
      current_location: optStr(formData, "currentLocation"),
      nearest_airport: optStr(formData, "nearestAirport"),
      primary_job_role_id: optStr(formData, "primaryJobRoleId"),
      employment_type: optStr(formData, "employmentType"),
      joining_date: optStr(formData, "joiningDate"),
      notice_period_days: optNum(formData, "noticePeriodDays"),
      availability_date: optStr(formData, "availabilityDate"),
      default_rotation_template_id: optStr(formData, "defaultRotationTemplateId"),
      emergency_contact_name: optStr(formData, "emergencyContactName"),
      emergency_contact_phone: optStr(formData, "emergencyContactPhone"),
      notes: optStr(formData, "notes"),
      updated_by: userId,
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidateDetail(id);
  revalidateList();
  return {};
}

// Cost fields are separated into their own action so the UI can gate the
// form that calls it behind crew.view_cost, independent of the general
// crew.manage-gated edit form above.
export async function updateCrewCost(id: string, formData: FormData) {
  const { supabase, userId } = await requireCrewManage();
  const { error } = await supabase
    .from("crew_profiles")
    .update({
      day_rate: optNum(formData, "dayRate"),
      currency: optStr(formData, "currency") ?? "USD",
      updated_by: userId,
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidateDetail(id);
  return {};
}

// Sensitive medical/dietary notes, same reasoning — separated so the UI can
// gate this specific form behind crew.view_sensitive.
export async function updateCrewSensitive(id: string, formData: FormData) {
  const { supabase, userId } = await requireCrewManage();
  const { error } = await supabase
    .from("crew_profiles")
    .update({
      dietary_medical_notes: optStr(formData, "dietaryMedicalNotes"),
      updated_by: userId,
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidateDetail(id);
  return {};
}

export async function linkCrewToUser(id: string, formData: FormData) {
  const { supabase, userId } = await requireCrewManage();
  const { error } = await supabase
    .from("crew_profiles")
    .update({ linked_profile_id: optStr(formData, "linkedProfileId"), updated_by: userId })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidateDetail(id);
  return {};
}

export async function deleteCrewProfile(id: string) {
  const { supabase } = await requireCrewManage();
  const { error } = await supabase.from("crew_profiles").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidateList();
  return {};
}

/* ---------------- Crew skills ---------------- */

export async function addCrewSkill(crewId: string, formData: FormData) {
  const { supabase } = await requireCrewManage();
  const skillId = str(formData, "skillId");
  if (!skillId) return { error: "Select a skill." };

  const { error } = await supabase.from("crew_skills").upsert(
    {
      crew_id: crewId,
      skill_id: skillId,
      years_experience: optNum(formData, "yearsExperience"),
      competency_grade: optStr(formData, "competencyGrade"),
    },
    { onConflict: "crew_id,skill_id" }
  );
  if (error) return { error: error.message };
  revalidateDetail(crewId);
  return {};
}

export async function removeCrewSkill(id: string, crewId: string) {
  const { supabase } = await requireCrewManage();
  const { error } = await supabase.from("crew_skills").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidateDetail(crewId);
  return {};
}

/* ---------------- Crew secondary roles ---------------- */

export async function addCrewSecondaryRole(crewId: string, jobRoleId: string) {
  const { supabase } = await requireCrewManage();
  if (!jobRoleId) return { error: "Select a role." };
  const { error } = await supabase
    .from("crew_secondary_roles")
    .upsert({ crew_id: crewId, job_role_id: jobRoleId }, { onConflict: "crew_id,job_role_id" });
  if (error) return { error: error.message };
  revalidateDetail(crewId);
  return {};
}

export async function removeCrewSecondaryRole(id: string, crewId: string) {
  const { supabase } = await requireCrewManage();
  const { error } = await supabase.from("crew_secondary_roles").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidateDetail(crewId);
  return {};
}
