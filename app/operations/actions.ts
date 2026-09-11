"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveAccess, can } from "@/lib/rbac";
import { COST_CATEGORIES, BILLING_MODELS, monthBounds } from "@/lib/ops";

async function requireAny(perms: string[], message: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const access = await getEffectiveAccess(supabase, user.id);
  if (!perms.some((p) => can(access, p))) throw new Error(message);
  if (!access.orgId) throw new Error("No company context.");
  return { supabase, access, userId: user.id, orgId: access.orgId };
}

function str(formData: FormData, key: string) {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}
function optStr(formData: FormData, key: string) {
  const v = str(formData, key);
  return v || null;
}
function int0(formData: FormData, key: string) {
  const n = Number(str(formData, key));
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}
function num0(formData: FormData, key: string) {
  const n = Number(str(formData, key));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
function optNum(formData: FormData, key: string) {
  const v = str(formData, key);
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function bool(formData: FormData, key: string) {
  return formData.get(key) === "on" || formData.get(key) === "true";
}
const revalidate = () => revalidatePath("/operations");

/* ================= Daily log ================= */

export async function saveDailyLog(projectId: string, siteId: string, entryDate: string, formData: FormData, submit: boolean) {
  const { supabase, access, userId, orgId } = await requireAny(["ops.enter"], "You don't have permission to enter daily operations.");
  if (!projectId || !siteId || !entryDate) return { error: "Project, vessel/site and date are required." };

  const { data: existing } = await supabase
    .from("ops_daily_logs")
    .select("id, status")
    .eq("project_id", projectId)
    .eq("offshore_site_id", siteId)
    .eq("entry_date", entryDate)
    .maybeSingle();
  if (existing?.status === "verified" && !can(access, "ops.verify")) {
    return { error: "This day is already verified — ask a verifier to reject it back before editing." };
  }
  const clientPob = int0(formData, "clientPob");
  const crewPob = int0(formData, "crewPob");
  const fields = {
    client_pob: clientPob,
    crew_pob: crewPob,
    breakfast_count: int0(formData, "breakfastCount"),
    lunch_count: int0(formData, "lunchCount"),
    dinner_count: int0(formData, "dinnerCount"),
    night_meal_count: int0(formData, "nightMealCount"),
    special_meals: int0(formData, "specialMeals"),
    packed_meals: int0(formData, "packedMeals"),
    att_onboard: int0(formData, "attOnboard"),
    att_on_duty: int0(formData, "attOnDuty"),
    att_off_duty: int0(formData, "attOffDuty"),
    att_sick: int0(formData, "attSick"),
    att_training: int0(formData, "attTraining"),
    att_travel: int0(formData, "attTravel"),
    att_overtime_hours: num0(formData, "attOvertimeHours"),
    att_emergency_duty: int0(formData, "attEmergencyDuty"),
    catering_delivered: bool(formData, "cateringDelivered"),
    housekeeping_completed: bool(formData, "housekeepingCompleted"),
    laundry_kg: optNum(formData, "laundryKg"),
    special_events: optStr(formData, "specialEvents"),
    service_interruptions: optStr(formData, "serviceInterruptions"),
    client_complaints: int0(formData, "clientComplaints"),
    client_complaint_notes: optStr(formData, "clientComplaintNotes"),
    food_waste_kg: optNum(formData, "foodWasteKg"),
    non_conformities: int0(formData, "nonConformities"),
    non_conformity_notes: optStr(formData, "nonConformityNotes"),
    remarks: optStr(formData, "remarks"),
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };
  const statusFields = submit
    ? { status: "submitted", submitted_by: userId, submitted_at: new Date().toISOString(), rejection_reason: null }
    : existing?.status === "rejected" || !existing
      ? { status: "draft" }
      : {};

  const { error } = existing
    ? await supabase.from("ops_daily_logs").update({ ...fields, ...statusFields }).eq("id", existing.id)
    : await supabase.from("ops_daily_logs").insert({ org_id: orgId, project_id: projectId, offshore_site_id: siteId, entry_date: entryDate, ...fields, ...statusFields, status: submit ? "submitted" : "draft", created_by: userId });
  if (error) return { error: error.message };
  revalidate();
  return {};
}

export async function verifyDailyLog(logId: string, approve: boolean, reason?: string) {
  const { supabase, userId } = await requireAny(["ops.verify"], "You don't have permission to verify daily operations.");
  const { data: log } = await supabase.from("ops_daily_logs").select("status").eq("id", logId).single();
  if (!log) return { error: "Could not find that daily log." };
  if (log.status !== "submitted") return { error: `Only a submitted day can be verified (this one is ${log.status}).` };
  if (!approve && !reason?.trim()) return { error: "A reason is required to reject a day." };
  const { error } = await supabase
    .from("ops_daily_logs")
    .update(approve ? { status: "verified", verified_by: userId, verified_at: new Date().toISOString() } : { status: "rejected", rejection_reason: reason?.trim(), verified_by: null, verified_at: null })
    .eq("id", logId);
  if (error) return { error: error.message };
  revalidate();
  return {};
}

export async function unverifyDailyLog(logId: string, reason: string) {
  const { supabase } = await requireAny(["ops.verify"], "You don't have permission to verify daily operations.");
  if (!reason.trim()) return { error: "A reason is required." };
  const { error } = await supabase.from("ops_daily_logs").update({ status: "rejected", rejection_reason: reason.trim(), verified_by: null, verified_at: null }).eq("id", logId).eq("status", "verified");
  if (error) return { error: error.message };
  revalidate();
  return {};
}

/* ================= Periods ================= */

export async function closePeriod(projectId: string, month: string) {
  const { supabase, userId, orgId } = await requireAny(["ops.close"], "You don't have permission to close a period.");
  const { start, end, key } = monthBounds(month);
  const { data: logs } = await supabase.from("ops_daily_logs").select("id, entry_date, status").eq("project_id", projectId).gte("entry_date", start).lte("entry_date", end);
  const unverified = (logs ?? []).filter((l) => l.status !== "verified");
  if (unverified.length) return { error: `${unverified.length} day(s) are not verified yet (${unverified.slice(0, 5).map((l) => l.entry_date).join(", ")}${unverified.length > 5 ? "…" : ""}). Verify or remove them before closing.` };
  if ((logs ?? []).length === 0) return { error: "There are no daily logs in this month — nothing to close." };

  const { data: period } = await supabase.from("ops_periods").select("id, status").eq("project_id", projectId).eq("period_month", key).maybeSingle();
  if (period && period.status !== "open") return { error: `This period is already ${period.status.replace(/_/g, " ")}.` };
  const stamp = { status: "closed", closed_by: userId, closed_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  const { error } = period
    ? await supabase.from("ops_periods").update(stamp).eq("id", period.id)
    : await supabase.from("ops_periods").insert({ org_id: orgId, project_id: projectId, period_month: key, ...stamp });
  if (error) return { error: error.message };
  revalidate();
  return {};
}

export async function approvePeriod(projectId: string, month: string) {
  const { supabase, userId } = await requireAny(["ops.commercial"], "You don't have permission to commercially approve a period.");
  const key = monthBounds(month).key;
  const { data: period } = await supabase.from("ops_periods").select("id, status").eq("project_id", projectId).eq("period_month", key).maybeSingle();
  if (!period || period.status !== "closed") return { error: "The period must be closed before commercial approval." };
  const { count } = await supabase.from("ops_billing_adjustments").select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("period_month", key).eq("status", "proposed");
  if (count) return { error: `${count} billing adjustment(s) are still proposed — approve or reject them first.` };
  const { error } = await supabase.from("ops_periods").update({ status: "commercially_approved", approved_by: userId, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", period.id);
  if (error) return { error: error.message };
  revalidate();
  return {};
}

export async function markBillingReady(projectId: string, month: string) {
  const { supabase, userId } = await requireAny(["ops.commercial"], "You don't have permission to mark a period billing-ready.");
  const key = monthBounds(month).key;
  const { data: period } = await supabase.from("ops_periods").select("id, status").eq("project_id", projectId).eq("period_month", key).maybeSingle();
  if (!period || period.status !== "commercially_approved") return { error: "The period must be commercially approved first." };
  const { error } = await supabase.from("ops_periods").update({ status: "billing_ready", billing_ready_by: userId, billing_ready_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", period.id);
  if (error) return { error: error.message };
  revalidate();
  return {};
}

// Controlled reopening: commercial permission + reason, counted and logged
// in ops_period_history by the status trigger.
export async function reopenPeriod(projectId: string, month: string, reason: string) {
  const { supabase } = await requireAny(["ops.commercial"], "You don't have permission to reopen a period.");
  if (!reason.trim()) return { error: "A reason is required to reopen a closed period." };
  const key = monthBounds(month).key;
  const { data: period } = await supabase.from("ops_periods").select("id, status, reopen_count").eq("project_id", projectId).eq("period_month", key).maybeSingle();
  if (!period || period.status === "open") return { error: "This period is not closed." };
  const { error } = await supabase
    .from("ops_periods")
    .update({ status: "open", last_reopen_reason: reason.trim(), reopen_count: (period.reopen_count ?? 0) + 1, closed_by: null, closed_at: null, approved_by: null, approved_at: null, billing_ready_by: null, billing_ready_at: null, updated_at: new Date().toISOString() })
    .eq("id", period.id);
  if (error) return { error: error.message };
  revalidate();
  return {};
}

/* ================= Cost entries ================= */

export async function addCostEntry(projectId: string, formData: FormData) {
  const { supabase, userId, orgId } = await requireAny(["ops.enter", "ops.commercial"], "You don't have permission to record costs.");
  const category = str(formData, "category");
  if (!COST_CATEGORIES.some((c) => c.value === category)) return { error: "Select a cost category." };
  const description = str(formData, "description");
  if (!description) return { error: "A description is required." };
  const amount = optNum(formData, "amount");
  if (amount == null || amount < 0) return { error: "Amount must be 0 or more." };
  const costDate = str(formData, "costDate");
  if (!costDate) return { error: "Cost date is required." };
  const { error } = await supabase.from("ops_cost_entries").insert({
    org_id: orgId,
    project_id: projectId,
    offshore_site_id: optStr(formData, "offshoreSiteId"),
    cost_date: costDate,
    category,
    description,
    amount,
    currency: str(formData, "currency") || "USD",
    reference: optStr(formData, "reference"),
    crew_id: optStr(formData, "crewId"),
    created_by: userId,
  });
  if (error) return { error: error.message };
  revalidate();
  return {};
}

export async function deleteCostEntry(id: string) {
  const { supabase } = await requireAny(["ops.enter", "ops.commercial"], "You don't have permission to record costs.");
  const { error } = await supabase.from("ops_cost_entries").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidate();
  return {};
}

/* ================= Billing terms ================= */

export async function saveBillingTerms(contractId: string, projectId: string | null, formData: FormData) {
  const { supabase, userId, orgId } = await requireAny(["ops.commercial"], "You don't have permission to edit billing terms.");
  const model = str(formData, "billingModel");
  if (!BILLING_MODELS.some((m) => m.value === model)) return { error: "Select a billing model." };
  const fields = {
    billing_model: model,
    currency: str(formData, "currency") || "USD",
    pob_basis: str(formData, "pobBasis") === "total_pob" ? "total_pob" : "client_pob",
    minimum_billable_pob: optNum(formData, "minimumBillablePob"),
    rate_per_person_day: optNum(formData, "ratePerPersonDay"),
    rate_breakfast: optNum(formData, "rateBreakfast"),
    rate_lunch: optNum(formData, "rateLunch"),
    rate_dinner: optNum(formData, "rateDinner"),
    rate_night_meal: optNum(formData, "rateNightMeal"),
    rate_special_meal: optNum(formData, "rateSpecialMeal"),
    rate_packed_meal: optNum(formData, "ratePackedMeal"),
    fixed_monthly_fee: optNum(formData, "fixedMonthlyFee"),
    lump_sum_amount: optNum(formData, "lumpSumAmount"),
    lump_sum_billing_month: optStr(formData, "lumpSumBillingMonth") ? monthBounds(str(formData, "lumpSumBillingMonth")).key : null,
    markup_pct: optNum(formData, "markupPct"),
    management_fee_monthly: optNum(formData, "managementFeeMonthly"),
    monthly_budget_cost: optNum(formData, "monthlyBudgetCost"),
    monthly_budget_revenue: optNum(formData, "monthlyBudgetRevenue"),
    notes: optStr(formData, "notes"),
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };
  const query = projectId
    ? supabase.from("billing_terms").select("id").eq("project_id", projectId).maybeSingle()
    : supabase.from("billing_terms").select("id").eq("contract_id", contractId).is("project_id", null).maybeSingle();
  const { data: existing } = await query;
  const { error } = existing
    ? await supabase.from("billing_terms").update(fields).eq("id", existing.id)
    : await supabase.from("billing_terms").insert({ org_id: orgId, contract_id: contractId, project_id: projectId, ...fields });
  if (error) return { error: error.message };
  revalidate();
  return {};
}

export async function deleteProjectBillingOverride(projectId: string) {
  const { supabase } = await requireAny(["ops.commercial"], "You don't have permission to edit billing terms.");
  const { error } = await supabase.from("billing_terms").delete().eq("project_id", projectId);
  if (error) return { error: error.message };
  revalidate();
  return {};
}

/* ================= Billing adjustments ================= */

export async function addAdjustment(projectId: string, month: string, formData: FormData) {
  const { supabase, userId, orgId } = await requireAny(["ops.close", "ops.commercial"], "You don't have permission to propose billing adjustments.");
  const kind = str(formData, "kind");
  if (!["additional_service", "deduction"].includes(kind)) return { error: "Select additional service or deduction." };
  const description = str(formData, "description");
  if (!description) return { error: "A description is required." };
  const amount = optNum(formData, "amount");
  if (amount == null || amount < 0) return { error: "Amount must be 0 or more." };
  const { error } = await supabase.from("ops_billing_adjustments").insert({
    org_id: orgId,
    project_id: projectId,
    period_month: monthBounds(month).key,
    kind,
    description,
    amount,
    currency: str(formData, "currency") || "USD",
    reference: optStr(formData, "reference"),
    created_by: userId,
  });
  if (error) return { error: error.message };
  revalidate();
  return {};
}

export async function decideAdjustment(id: string, approve: boolean) {
  const { supabase, userId } = await requireAny(["ops.commercial"], "You don't have permission to approve billing adjustments.");
  const { error } = await supabase
    .from("ops_billing_adjustments")
    .update({ status: approve ? "approved" : "rejected", decided_by: userId, decided_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidate();
  return {};
}

export async function deleteAdjustment(id: string) {
  const { supabase } = await requireAny(["ops.close", "ops.commercial"], "You don't have permission to edit billing adjustments.");
  const { error } = await supabase.from("ops_billing_adjustments").delete().eq("id", id).eq("status", "proposed");
  if (error) return { error: error.message };
  revalidate();
  return {};
}
