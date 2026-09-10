"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveAccess, can } from "@/lib/rbac";

async function requireProjectsManage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "projects.manage")) {
    throw new Error("You don't have permission to manage projects.");
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
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const revalidateProjects = (id?: string) => {
  revalidatePath("/projects");
  if (id) revalidatePath(`/projects/${id}`);
  // Offshore Sites (Crew Setup) picks a project from a dropdown.
  revalidatePath("/crew/setup");
};

const PROJECT_STATUSES = ["planned", "mobilizing", "active", "demobilizing", "completed", "cancelled"] as const;
function projectStatus(formData: FormData): (typeof PROJECT_STATUSES)[number] {
  const v = str(formData, "status");
  return (PROJECT_STATUSES as readonly string[]).includes(v) ? (v as (typeof PROJECT_STATUSES)[number]) : "planned";
}
const CONTRACT_BLOCKING_STATUSES = new Set(["completed", "cancelled"]);
const CONTRACT_ACTIVATABLE_STATUSES = new Set(["awarded", "active"]);

function datesOutsideContract(
  projectStart: string | null,
  projectEnd: string | null,
  contractStart: string | null,
  contractEnd: string | null
): boolean {
  if (projectStart && contractStart && projectStart < contractStart) return true;
  if (projectStart && contractEnd && projectStart > contractEnd) return true;
  if (projectEnd && contractEnd && projectEnd > contractEnd) return true;
  if (projectEnd && contractStart && projectEnd < contractStart) return true;
  return false;
}

export async function createProject(formData: FormData) {
  const { supabase, access, userId } = await requireProjectsManage();
  const contractId = str(formData, "contractId");
  if (!contractId) return { error: "Contract is required." };
  const contractorId = str(formData, "contractorId");
  if (!contractorId) return { error: "EPC Contractor is required." };
  const name = str(formData, "projectName");
  if (!name) return { error: "Project name is required." };

  const [{ data: contract, error: contractError }, { data: contractor, error: contractorError }] = await Promise.all([
    supabase.from("contracts").select("status, planned_start_date, planned_end_date").eq("id", contractId).single(),
    supabase.from("contractors").select("is_active").eq("id", contractorId).single(),
  ]);
  if (contractError || !contract) return { error: "Could not find that contract." };
  if (contractorError || !contractor) return { error: "Could not find that EPC contractor." };
  if (CONTRACT_BLOCKING_STATUSES.has(contract.status)) {
    return { error: `This contract is ${contract.status} and can't receive new projects.` };
  }
  if (!contractor.is_active) {
    return { error: "This EPC contractor is inactive and can't be assigned to a new project." };
  }

  const status = projectStatus(formData);
  if (status === "active" && !CONTRACT_ACTIVATABLE_STATUSES.has(contract.status)) {
    return { error: `A project can't be activated while its contract is ${contract.status} — the contract must be Awarded or Active first.` };
  }

  const plannedStart = optStr(formData, "plannedStartDate");
  const plannedEnd = optStr(formData, "plannedEndDate");
  const warning = datesOutsideContract(plannedStart, plannedEnd, contract.planned_start_date, contract.planned_end_date)
    ? "This project's planned dates fall outside the contract's planned dates — saved anyway, but worth double-checking."
    : undefined;

  const { data: code, error: codeError } = await supabase.rpc("next_number_range_code", {
    p_org_id: access.orgId,
    p_entity_type: "project",
  });
  if (codeError) return { error: `Could not assign a project code: ${codeError.message}` };

  const { data: project, error } = await supabase
    .from("projects")
    .insert({
      org_id: access.orgId,
      contract_id: contractId,
      contractor_id: contractorId,
      project_code: code,
      project_name: name,
      client_reference: optStr(formData, "clientReference"),
      purchase_order_number: optStr(formData, "purchaseOrderNumber"),
      country: optStr(formData, "country"),
      operating_region: optStr(formData, "operatingRegion"),
      base_port: optStr(formData, "basePort"),
      mobilization_location: optStr(formData, "mobilizationLocation"),
      demobilization_location: optStr(formData, "demobilizationLocation"),
      planned_start_date: plannedStart,
      planned_end_date: plannedEnd,
      actual_start_date: optStr(formData, "actualStartDate"),
      actual_end_date: optStr(formData, "actualEndDate"),
      expected_pob: optNum(formData, "expectedPob"),
      project_manager_user_id: optStr(formData, "projectManagerUserId"),
      operations_coordinator_user_id: optStr(formData, "operationsCoordinatorUserId"),
      status,
      notes: optStr(formData, "notes"),
      created_by: userId,
      updated_by: userId,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  revalidateProjects();
  return { id: project?.id, warning };
}

export async function updateProject(id: string, formData: FormData) {
  const { supabase, userId } = await requireProjectsManage();
  const contractId = str(formData, "contractId");
  if (!contractId) return { error: "Contract is required." };
  const contractorId = str(formData, "contractorId");
  if (!contractorId) return { error: "EPC Contractor is required." };
  const name = str(formData, "projectName");
  if (!name) return { error: "Project name is required." };

  const [{ data: contract, error: contractError }, { data: contractor, error: contractorError }] = await Promise.all([
    supabase.from("contracts").select("status, planned_start_date, planned_end_date").eq("id", contractId).single(),
    supabase.from("contractors").select("is_active").eq("id", contractorId).single(),
  ]);
  if (contractError || !contract) return { error: "Could not find that contract." };
  if (contractorError || !contractor) return { error: "Could not find that EPC contractor." };

  const status = projectStatus(formData);
  if (status === "active" && !CONTRACT_ACTIVATABLE_STATUSES.has(contract.status)) {
    return { error: `A project can't be activated while its contract is ${contract.status} — the contract must be Awarded or Active first.` };
  }
  if (!contractor.is_active) {
    return { error: "This EPC contractor is inactive and can't be assigned to a project." };
  }

  const plannedStart = optStr(formData, "plannedStartDate");
  const plannedEnd = optStr(formData, "plannedEndDate");
  const warning = datesOutsideContract(plannedStart, plannedEnd, contract.planned_start_date, contract.planned_end_date)
    ? "This project's planned dates fall outside the contract's planned dates — saved anyway, but worth double-checking."
    : undefined;

  const { error } = await supabase
    .from("projects")
    .update({
      contract_id: contractId,
      contractor_id: contractorId,
      project_name: name,
      client_reference: optStr(formData, "clientReference"),
      purchase_order_number: optStr(formData, "purchaseOrderNumber"),
      country: optStr(formData, "country"),
      operating_region: optStr(formData, "operatingRegion"),
      base_port: optStr(formData, "basePort"),
      mobilization_location: optStr(formData, "mobilizationLocation"),
      demobilization_location: optStr(formData, "demobilizationLocation"),
      planned_start_date: plannedStart,
      planned_end_date: plannedEnd,
      actual_start_date: optStr(formData, "actualStartDate"),
      actual_end_date: optStr(formData, "actualEndDate"),
      expected_pob: optNum(formData, "expectedPob"),
      project_manager_user_id: optStr(formData, "projectManagerUserId"),
      operations_coordinator_user_id: optStr(formData, "operationsCoordinatorUserId"),
      status,
      notes: optStr(formData, "notes"),
      updated_by: userId,
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidateProjects(id);
  return { warning };
}

export async function deleteProject(id: string) {
  const { supabase } = await requireProjectsManage();
  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) {
    if (error.code === "23503") {
      return { error: "This project still has offshore sites attached — reassign those first." };
    }
    return { error: error.message };
  }
  revalidateProjects();
  return {};
}
