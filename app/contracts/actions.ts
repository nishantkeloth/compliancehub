"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveAccess, can } from "@/lib/rbac";
import { CONTRACT_SERVICE_KEYS } from "@/lib/contract-services";

async function requireContractsManage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "contracts.manage")) {
    throw new Error("You don't have permission to manage contracts.");
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

const revalidateContracts = (id?: string) => {
  revalidatePath("/contracts");
  if (id) revalidatePath(`/contracts/${id}`);
  // Projects show their parent contract's title/status inline.
  revalidatePath("/projects");
};

const CONTRACT_STATUSES = ["draft", "awarded", "mobilizing", "active", "suspended", "completed", "cancelled"] as const;
// Returns null for a blank/invalid status instead of silently coercing to
// "draft" — status is one of a contract's mandatory fields (doc: the
// person creating a contract must pick a real one, never inherit "draft"
// by omission), so both callers below turn a null here into a real error.
function contractStatus(formData: FormData): (typeof CONTRACT_STATUSES)[number] | null {
  const v = str(formData, "status");
  return (CONTRACT_STATUSES as readonly string[]).includes(v) ? (v as (typeof CONTRACT_STATUSES)[number]) : null;
}

export async function createContract(formData: FormData) {
  const { supabase, access, userId } = await requireContractsManage();
  const clientId = str(formData, "clientId");
  if (!clientId) return { error: "Client is required." };
  const title = str(formData, "contractTitle");
  if (!title) return { error: "Contract title is required." };
  const status = contractStatus(formData);
  if (!status) return { error: "Status is required." };
  const plannedStartDate = optStr(formData, "plannedStartDate");
  if (!plannedStartDate) return { error: "Planned start date is required." };
  const plannedEndDate = optStr(formData, "plannedEndDate");
  if (!plannedEndDate) return { error: "Planned end date is required." };
  const currency = optStr(formData, "currency");
  if (!currency) return { error: "Currency is required." };
  const selectedServices = formData.getAll("services").filter((v): v is string => typeof v === "string" && CONTRACT_SERVICE_KEYS.has(v));
  if (selectedServices.length === 0) return { error: "Select at least one service in the contract's scope." };

  const { data: code, error: codeError } = await supabase.rpc("next_number_range_code", {
    p_org_id: access.orgId,
    p_entity_type: "contract",
  });
  if (codeError) return { error: `Could not assign a contract code: ${codeError.message}` };

  const { data: contract, error } = await supabase
    .from("contracts")
    .insert({
      org_id: access.orgId,
      client_id: clientId,
      contract_code: code,
      contract_number: optStr(formData, "contractNumber"),
      contract_title: title,
      description: optStr(formData, "description"),
      award_date: optStr(formData, "awardDate"),
      planned_start_date: plannedStartDate,
      planned_end_date: plannedEndDate,
      actual_start_date: optStr(formData, "actualStartDate"),
      actual_end_date: optStr(formData, "actualEndDate"),
      currency,
      estimated_contract_value: optNum(formData, "estimatedContractValue"),
      billing_model: optStr(formData, "billingModel"),
      payment_terms: optStr(formData, "paymentTerms"),
      mobilization_notice_days: optNum(formData, "mobilizationNoticeDays"),
      contract_manager_user_id: optStr(formData, "contractManagerUserId"),
      operations_manager_user_id: optStr(formData, "operationsManagerUserId"),
      status,
      notes: optStr(formData, "notes"),
      created_by: userId,
      updated_by: userId,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  // Service Scope selected on the create form itself (app/contracts/
  // contracts-manager.tsx) — already validated non-empty above, applied
  // here in the same action so it doesn't need a separate trip through the
  // Service Scope tab afterward. Best effort past this point: the contract
  // itself has already saved successfully, so a hiccup inserting the scope
  // rows doesn't fail the whole creation — scope can always be fixed up
  // from that tab.
  if (contract?.id) {
    await supabase.from("contract_services").insert(
      selectedServices.map((service) => ({ org_id: access.orgId, contract_id: contract.id, service }))
    );
  }

  revalidateContracts();
  return { id: contract?.id };
}

export async function updateContract(id: string, formData: FormData) {
  const { supabase, userId } = await requireContractsManage();
  const clientId = str(formData, "clientId");
  if (!clientId) return { error: "Client is required." };
  const title = str(formData, "contractTitle");
  if (!title) return { error: "Contract title is required." };
  const status = contractStatus(formData);
  if (!status) return { error: "Status is required." };

  const { error } = await supabase
    .from("contracts")
    .update({
      client_id: clientId,
      contract_number: optStr(formData, "contractNumber"),
      contract_title: title,
      description: optStr(formData, "description"),
      award_date: optStr(formData, "awardDate"),
      planned_start_date: optStr(formData, "plannedStartDate"),
      planned_end_date: optStr(formData, "plannedEndDate"),
      actual_start_date: optStr(formData, "actualStartDate"),
      actual_end_date: optStr(formData, "actualEndDate"),
      currency: optStr(formData, "currency"),
      estimated_contract_value: optNum(formData, "estimatedContractValue"),
      billing_model: optStr(formData, "billingModel"),
      payment_terms: optStr(formData, "paymentTerms"),
      mobilization_notice_days: optNum(formData, "mobilizationNoticeDays"),
      contract_manager_user_id: optStr(formData, "contractManagerUserId"),
      operations_manager_user_id: optStr(formData, "operationsManagerUserId"),
      status,
      notes: optStr(formData, "notes"),
      updated_by: userId,
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidateContracts(id);
  return {};
}

export async function deleteContract(id: string) {
  const { supabase } = await requireContractsManage();
  const { error } = await supabase.from("contracts").delete().eq("id", id);
  if (error) {
    if (error.code === "23503") {
      return { error: "This contract still has projects under it — remove or reassign those first." };
    }
    return { error: error.message };
  }
  revalidateContracts();
  return {};
}

/* ---------------- Service scope ---------------- */

export async function addContractService(contractId: string, service: string) {
  const { supabase, access } = await requireContractsManage();
  const { error } = await supabase
    .from("contract_services")
    .insert({ org_id: access.orgId, contract_id: contractId, service });
  if (error && !error.message.includes("duplicate")) return { error: error.message };
  revalidateContracts(contractId);
  return {};
}

export async function removeContractService(contractId: string, service: string) {
  const { supabase } = await requireContractsManage();
  const { error } = await supabase
    .from("contract_services")
    .delete()
    .eq("contract_id", contractId)
    .eq("service", service);
  if (error) return { error: error.message };
  revalidateContracts(contractId);
  return {};
}

/* ---------------- Documents ---------------- */

export async function addContractDocument(contractId: string, formData: FormData) {
  const { supabase, access, userId } = await requireContractsManage();
  const title = str(formData, "title");
  if (!title) return { error: "Title is required." };
  const url = optStr(formData, "documentUrl");
  if (!url) return { error: "A link/URL is required." };

  const { error } = await supabase.from("contract_documents").insert({
    org_id: access.orgId,
    contract_id: contractId,
    title,
    document_url: url,
    notes: optStr(formData, "notes"),
    created_by: userId,
  });
  if (error) return { error: error.message };
  revalidateContracts(contractId);
  return {};
}

export async function deleteContractDocument(id: string, contractId: string) {
  const { supabase } = await requireContractsManage();
  const { error } = await supabase.from("contract_documents").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidateContracts(contractId);
  return {};
}
