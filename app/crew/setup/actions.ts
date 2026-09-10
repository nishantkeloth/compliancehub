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
    throw new Error("You don't have permission to manage crew setup data.");
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

const revalidateSetup = () => revalidatePath("/crew/setup");

/* ---------------- Job roles ---------------- */

export async function createJobRole(formData: FormData) {
  const { supabase, access, userId } = await requireCrewManage();
  const name = str(formData, "name");
  if (!name) return { error: "Name is required." };

  const { error } = await supabase
    .from("job_roles")
    .insert({ org_id: access.orgId, name, category: optStr(formData, "category"), created_by: userId });
  if (error) return { error: error.message };
  revalidateSetup();
  return {};
}

export async function updateJobRole(id: string, formData: FormData) {
  const { supabase } = await requireCrewManage();
  const name = str(formData, "name");
  if (!name) return { error: "Name is required." };

  const { error } = await supabase
    .from("job_roles")
    .update({ name, category: optStr(formData, "category"), is_active: formData.get("isActive") === "on" })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidateSetup();
  return {};
}

export async function deleteJobRole(id: string) {
  const { supabase } = await requireCrewManage();
  const { error } = await supabase.from("job_roles").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidateSetup();
  return {};
}

/* ---------------- Skills ---------------- */

export async function createSkill(formData: FormData) {
  const { supabase, access } = await requireCrewManage();
  const name = str(formData, "name");
  if (!name) return { error: "Name is required." };

  const { error } = await supabase.from("skills").insert({ org_id: access.orgId, name });
  if (error) return { error: error.message };
  revalidateSetup();
  return {};
}

export async function deleteSkill(id: string) {
  const { supabase } = await requireCrewManage();
  const { error } = await supabase.from("skills").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidateSetup();
  return {};
}

/* ---------------- Rotation templates ---------------- */

export async function createRotationTemplate(formData: FormData) {
  const { supabase, access, userId } = await requireCrewManage();
  const name = str(formData, "name");
  if (!name) return { error: "Name is required." };
  const patternType = str(formData, "patternType") || "fixed_equal";
  const daysOnRaw = str(formData, "daysOn");
  const daysOffRaw = str(formData, "daysOff");

  const { error } = await supabase.from("rotation_templates").insert({
    org_id: access.orgId,
    name,
    pattern_type: patternType,
    days_on: daysOnRaw ? Number(daysOnRaw) : null,
    days_off: daysOffRaw ? Number(daysOffRaw) : null,
    notes: optStr(formData, "notes"),
    created_by: userId,
    updated_by: userId,
  });
  if (error) return { error: error.message };
  revalidateSetup();
  return {};
}

export async function updateRotationTemplate(id: string, formData: FormData) {
  const { supabase, userId } = await requireCrewManage();
  const name = str(formData, "name");
  if (!name) return { error: "Name is required." };
  const daysOnRaw = str(formData, "daysOn");
  const daysOffRaw = str(formData, "daysOff");

  const { error } = await supabase
    .from("rotation_templates")
    .update({
      name,
      pattern_type: str(formData, "patternType") || "fixed_equal",
      days_on: daysOnRaw ? Number(daysOnRaw) : null,
      days_off: daysOffRaw ? Number(daysOffRaw) : null,
      notes: optStr(formData, "notes"),
      is_active: formData.get("isActive") === "on",
      updated_by: userId,
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidateSetup();
  return {};
}

export async function deleteRotationTemplate(id: string) {
  const { supabase } = await requireCrewManage();
  const { error } = await supabase.from("rotation_templates").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidateSetup();
  return {};
}

/* ---------------- Offshore sites ---------------- */

export async function createOffshoreSite(formData: FormData) {
  const { supabase, access, userId } = await requireCrewManage();
  const name = str(formData, "name");
  if (!name) return { error: "Name is required." };

  const { error } = await supabase.from("offshore_sites").insert({
    org_id: access.orgId,
    contractor_id: optStr(formData, "contractorId"),
    project_id: optStr(formData, "projectId"),
    name,
    code: optStr(formData, "code"),
    site_type: str(formData, "siteType") || "other",
    country: optStr(formData, "country"),
    operating_region: optStr(formData, "operatingRegion"),
    port_or_heliport: optStr(formData, "portOrHeliport"),
    crew_change_location: optStr(formData, "crewChangeLocation"),
    standard_rotation_template_id: optStr(formData, "standardRotationTemplateId"),
    notes: optStr(formData, "notes"),
    created_by: userId,
    updated_by: userId,
  });
  if (error) return { error: error.message };
  revalidateSetup();
  return {};
}

export async function updateOffshoreSite(id: string, formData: FormData) {
  const { supabase, userId } = await requireCrewManage();
  const name = str(formData, "name");
  if (!name) return { error: "Name is required." };

  const { error } = await supabase
    .from("offshore_sites")
    .update({
      contractor_id: optStr(formData, "contractorId"),
      project_id: optStr(formData, "projectId"),
      name,
      code: optStr(formData, "code"),
      site_type: str(formData, "siteType") || "other",
      country: optStr(formData, "country"),
      operating_region: optStr(formData, "operatingRegion"),
      port_or_heliport: optStr(formData, "portOrHeliport"),
      crew_change_location: optStr(formData, "crewChangeLocation"),
      standard_rotation_template_id: optStr(formData, "standardRotationTemplateId"),
      notes: optStr(formData, "notes"),
      status: str(formData, "status") || "active",
      updated_by: userId,
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidateSetup();
  return {};
}

export async function deleteOffshoreSite(id: string) {
  const { supabase } = await requireCrewManage();
  const { error } = await supabase.from("offshore_sites").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidateSetup();
  return {};
}

/* ---------------- Site manning requirements ---------------- */

export async function setManningRequirement(offshoreSiteId: string, formData: FormData) {
  const { supabase, access } = await requireCrewManage();
  const jobRoleId = str(formData, "jobRoleId");
  const minHeadcountRaw = str(formData, "minimumHeadcount");
  if (!jobRoleId) return { error: "Job role is required." };
  const minimumHeadcount = minHeadcountRaw ? Number(minHeadcountRaw) : 1;
  if (!Number.isFinite(minimumHeadcount) || minimumHeadcount < 1) {
    return { error: "Minimum headcount must be at least 1." };
  }

  const { error } = await supabase
    .from("site_manning_requirements")
    .upsert(
      { org_id: access.orgId, offshore_site_id: offshoreSiteId, job_role_id: jobRoleId, minimum_headcount: minimumHeadcount },
      { onConflict: "offshore_site_id,job_role_id" }
    );
  if (error) return { error: error.message };
  revalidateSetup();
  return {};
}

export async function deleteManningRequirement(id: string) {
  const { supabase } = await requireCrewManage();
  const { error } = await supabase.from("site_manning_requirements").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidateSetup();
  return {};
}

/* ---------------- Document types ---------------- */

export async function createDocumentType(formData: FormData) {
  const { supabase, access, userId } = await requireCrewManage();
  const name = str(formData, "name");
  if (!name) return { error: "Name is required." };
  const validityRaw = str(formData, "defaultValidityMonths");
  const warningRaw = str(formData, "warningThresholdDays");

  const { error } = await supabase.from("document_types").insert({
    org_id: access.orgId,
    name,
    category: optStr(formData, "category"),
    default_validity_months: validityRaw ? Number(validityRaw) : null,
    warning_threshold_days: warningRaw ? Number(warningRaw) : null,
    tracks_number: formData.get("tracksNumber") === "on",
    created_by: userId,
  });
  if (error) return { error: error.message };
  revalidateSetup();
  return {};
}

export async function updateDocumentType(id: string, formData: FormData) {
  const { supabase } = await requireCrewManage();
  const name = str(formData, "name");
  if (!name) return { error: "Name is required." };
  const validityRaw = str(formData, "defaultValidityMonths");
  const warningRaw = str(formData, "warningThresholdDays");

  const { error } = await supabase
    .from("document_types")
    .update({
      name,
      category: optStr(formData, "category"),
      default_validity_months: validityRaw ? Number(validityRaw) : null,
      warning_threshold_days: warningRaw ? Number(warningRaw) : null,
      tracks_number: formData.get("tracksNumber") === "on",
      is_active: formData.get("isActive") === "on",
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidateSetup();
  return {};
}

export async function deleteDocumentType(id: string) {
  const { supabase } = await requireCrewManage();
  const { error } = await supabase.from("document_types").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidateSetup();
  return {};
}

/* ---------------- Document custom field definitions ---------------- */

function slugify(label: string) {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export async function createCustomFieldDefinition(formData: FormData) {
  const { supabase, access, userId } = await requireCrewManage();
  const label = str(formData, "label");
  if (!label) return { error: "Label is required." };
  const fieldType = str(formData, "fieldType") || "text";
  const fieldKey = slugify(label);
  if (!fieldKey) return { error: "Label must contain at least one letter or number." };

  const { error } = await supabase.from("document_custom_field_definitions").insert({
    org_id: access.orgId,
    label,
    field_key: fieldKey,
    field_type: fieldType,
    applies_to_document_type_id: optStr(formData, "appliesToDocumentTypeId"),
    created_by: userId,
  });
  if (error) {
    if (error.code === "23505") return { error: "A custom field with a similar name already exists." };
    return { error: error.message };
  }
  revalidateSetup();
  return {};
}

export async function updateCustomFieldDefinition(id: string, formData: FormData) {
  const { supabase } = await requireCrewManage();
  const label = str(formData, "label");
  if (!label) return { error: "Label is required." };
  const fieldType = str(formData, "fieldType") || "text";

  const { error } = await supabase
    .from("document_custom_field_definitions")
    .update({
      label,
      field_type: fieldType,
      applies_to_document_type_id: optStr(formData, "appliesToDocumentTypeId"),
      is_active: formData.get("isActive") === "on",
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidateSetup();
  return {};
}

export async function deleteCustomFieldDefinition(id: string) {
  const { supabase } = await requireCrewManage();
  const { error } = await supabase.from("document_custom_field_definitions").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidateSetup();
  return {};
}
