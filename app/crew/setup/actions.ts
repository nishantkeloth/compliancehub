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

/* ---------------- Clients ---------------- */

export async function createClient_(formData: FormData) {
  const { supabase, access, userId } = await requireCrewManage();
  const name = str(formData, "name");
  if (!name) return { error: "Name is required." };

  const { error } = await supabase.from("clients").insert({
    org_id: access.orgId,
    name,
    contract_number: optStr(formData, "contractNumber"),
    contract_start_date: optStr(formData, "contractStartDate"),
    contract_end_date: optStr(formData, "contractEndDate"),
    billing_model: optStr(formData, "billingModel"),
    notes: optStr(formData, "notes"),
    created_by: userId,
    updated_by: userId,
  });
  if (error) return { error: error.message };
  revalidateSetup();
  return {};
}

export async function updateClient(id: string, formData: FormData) {
  const { supabase, userId } = await requireCrewManage();
  const name = str(formData, "name");
  if (!name) return { error: "Name is required." };

  const { error } = await supabase
    .from("clients")
    .update({
      name,
      contract_number: optStr(formData, "contractNumber"),
      contract_start_date: optStr(formData, "contractStartDate"),
      contract_end_date: optStr(formData, "contractEndDate"),
      billing_model: optStr(formData, "billingModel"),
      notes: optStr(formData, "notes"),
      is_active: formData.get("isActive") === "on",
      updated_by: userId,
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidateSetup();
  return {};
}

export async function deleteClient(id: string) {
  const { supabase } = await requireCrewManage();
  const { error } = await supabase.from("clients").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidateSetup();
  return {};
}

/* ---------------- Contractors (EPC contractors, under a client) ---------------- */

export async function createContractor(formData: FormData) {
  const { supabase, access, userId } = await requireCrewManage();
  const name = str(formData, "name");
  if (!name) return { error: "Name is required." };
  const clientId = str(formData, "clientId");
  if (!clientId) return { error: "Client is required." };

  const { error } = await supabase.from("contractors").insert({
    org_id: access.orgId,
    client_id: clientId,
    name,
    notes: optStr(formData, "notes"),
    created_by: userId,
    updated_by: userId,
  });
  if (error) return { error: error.message };
  revalidateSetup();
  return {};
}

export async function updateContractor(id: string, formData: FormData) {
  const { supabase, userId } = await requireCrewManage();
  const name = str(formData, "name");
  if (!name) return { error: "Name is required." };
  const clientId = str(formData, "clientId");
  if (!clientId) return { error: "Client is required." };

  const { error } = await supabase
    .from("contractors")
    .update({
      name,
      client_id: clientId,
      notes: optStr(formData, "notes"),
      is_active: formData.get("isActive") === "on",
      updated_by: userId,
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidateSetup();
  return {};
}

export async function deleteContractor(id: string) {
  const { supabase } = await requireCrewManage();
  const { error } = await supabase.from("contractors").delete().eq("id", id);
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
