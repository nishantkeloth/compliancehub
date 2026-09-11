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

// Documents/certifications are gated behind their own crew.documents.manage
// permission (mirrors crew.view_cost / crew.view_sensitive) rather than the
// general crew.manage, since sponsor/document-number fields are sensitive
// enough to warrant a separate grant — matches the RLS policies on
// crew_documents, which check the same permission key.
async function requireDocumentsManage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "crew.documents.manage")) {
    throw new Error("You don't have permission to manage crew documents.");
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
// The documents matrix (/crew/documents) shows the same crew_documents rows
// as the per-crew detail page, so any write from either screen needs to
// invalidate both.
const revalidateMatrix = () => revalidatePath("/crew/documents");
// Same reasoning for the vessel-first roster board (/crew/roster) — it
// reads the same crew_assignments rows as this per-crew detail page.
const revalidateRoster = () => revalidatePath("/crew/roster");

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

/* ---------------- Crew vessel assignments ---------------- */

// Phase 4: normal assignments now originate from an approved
// mobilization's boarding confirmation (see confirmBoarding in
// app/mobilizations/actions.ts, the only other writer of
// crew_assignments). This function is the restricted emergency path —
// it requires mobilization.emergency_override on top of crew.manage, a
// reason, and logs every use to manual_assignment_overrides.
export async function assignCrewToSite(crewId: string, formData: FormData) {
  const { supabase, access, userId } = await requireCrewManage();
  if (!can(access, "mobilization.emergency_override")) {
    return { error: "Direct assignment is a restricted emergency override — you need that permission to use it. Assign crew through an approved mobilization instead." };
  }
  const offshoreSiteId = str(formData, "offshoreSiteId");
  if (!offshoreSiteId) return { error: "Select a vessel." };
  const reason = str(formData, "reason");
  if (!reason) return { error: "A reason is required for a direct (non-mobilization) assignment." };
  const startDate = str(formData, "startDate") || new Date().toISOString().slice(0, 10);

  // Close out any currently-open assignment for this crew member first — only
  // one open (end_date is null) assignment per crew_id is allowed (DB constraint).
  const { error: closeError } = await supabase
    .from("crew_assignments")
    .update({ end_date: startDate, updated_by: userId })
    .eq("crew_id", crewId)
    .is("end_date", null);
  if (closeError) return { error: closeError.message };

  const { data: assignment, error } = await supabase
    .from("crew_assignments")
    .insert({
      org_id: access.orgId,
      crew_id: crewId,
      offshore_site_id: offshoreSiteId,
      start_date: startDate,
      notes: optStr(formData, "notes"),
      created_by: userId,
      updated_by: userId,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  await supabase.from("manual_assignment_overrides").insert({
    org_id: access.orgId,
    crew_id: crewId,
    offshore_site_id: offshoreSiteId,
    crew_assignment_id: assignment?.id,
    reason,
    created_by: userId,
  });

  revalidateDetail(crewId);
  revalidateRoster();
  return {};
}

export async function endCrewAssignment(id: string, crewId: string, formData: FormData) {
  const { supabase, userId } = await requireCrewManage();
  const endDate = str(formData, "endDate") || new Date().toISOString().slice(0, 10);
  const { error } = await supabase
    .from("crew_assignments")
    .update({ end_date: endDate, updated_by: userId })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidateDetail(crewId);
  revalidateRoster();
  return {};
}

export async function deleteCrewAssignment(id: string, crewId: string) {
  const { supabase } = await requireCrewManage();
  const { error } = await supabase.from("crew_assignments").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidateDetail(crewId);
  revalidateRoster();
  return {};
}

/* ---------------- Crew documents & certifications ---------------- */

// Custom-field values are submitted as a single JSON-encoded object (the
// client only includes keys for definitions that apply to the selected
// document type), so this just needs to parse it defensively.
function parseCustomFields(formData: FormData): Record<string, unknown> {
  const raw = str(formData, "customFields");
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export async function createCrewDocument(crewId: string, formData: FormData) {
  const { supabase, access, userId } = await requireDocumentsManage();
  const documentTypeId = str(formData, "documentTypeId");
  if (!documentTypeId) return { error: "Select a document type." };

  const { error } = await supabase.from("crew_documents").insert({
    org_id: access.orgId,
    crew_id: crewId,
    document_type_id: documentTypeId,
    document_number: optStr(formData, "documentNumber"),
    sponsor: optStr(formData, "sponsor"),
    issue_date: optStr(formData, "issueDate"),
    expiry_date: optStr(formData, "expiryDate"),
    entry_date: optStr(formData, "entryDate"),
    extension_date: optStr(formData, "extensionDate"),
    dose_number: optStr(formData, "doseNumber"),
    reliever_crew_id: optStr(formData, "relieverCrewId"),
    notes: optStr(formData, "notes"),
    custom_fields: parseCustomFields(formData),
    created_by: userId,
    updated_by: userId,
  });
  if (error) return { error: error.message };
  revalidateDetail(crewId);
  revalidateMatrix();
  return {};
}

export async function updateCrewDocument(id: string, crewId: string, formData: FormData) {
  const { supabase, userId } = await requireDocumentsManage();
  const documentTypeId = str(formData, "documentTypeId");
  if (!documentTypeId) return { error: "Select a document type." };

  const { error } = await supabase
    .from("crew_documents")
    .update({
      document_type_id: documentTypeId,
      document_number: optStr(formData, "documentNumber"),
      sponsor: optStr(formData, "sponsor"),
      issue_date: optStr(formData, "issueDate"),
      expiry_date: optStr(formData, "expiryDate"),
      entry_date: optStr(formData, "entryDate"),
      extension_date: optStr(formData, "extensionDate"),
      dose_number: optStr(formData, "doseNumber"),
      reliever_crew_id: optStr(formData, "relieverCrewId"),
      notes: optStr(formData, "notes"),
      custom_fields: parseCustomFields(formData),
      updated_by: userId,
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidateDetail(crewId);
  revalidateMatrix();
  return {};
}

export async function deleteCrewDocument(id: string, crewId: string) {
  const { supabase } = await requireDocumentsManage();
  const { error } = await supabase.from("crew_documents").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidateDetail(crewId);
  revalidateMatrix();
  return {};
}
