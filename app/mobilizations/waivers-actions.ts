"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveAccess, can } from "@/lib/rbac";
import { CHECK_CODES, type CheckCode } from "@/lib/readiness";

async function requirePermission(permission: string, message: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, permission)) throw new Error(message);
  if (!access.orgId) throw new Error("No company context.");
  return { supabase, access, userId: user.id };
}

// Either manage or compliance_review can raise a waiver request — both
// roles are the ones actually looking at a position's readiness results
// and spotting the gap; mobilization.approve is reserved for the
// decision (see decideWaiver below).
async function requireRequest() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "mobilization.manage") && !can(access, "mobilization.compliance_review")) {
    throw new Error("You don't have permission to request a compliance waiver.");
  }
  if (!access.orgId) throw new Error("No company context.");
  return { supabase, access, userId: user.id };
}

const revalidateMobilization = (id?: string) => {
  revalidatePath("/mobilizations");
  if (id) revalidatePath(`/mobilizations/${id}`);
  revalidatePath("/readiness");
};

function str(formData: FormData, key: string) {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}
function optStr(formData: FormData, key: string) {
  const v = str(formData, key);
  return v || null;
}

export async function requestWaiver(positionId: string, crewId: string, requestId: string, formData: FormData) {
  const { supabase, access, userId } = await requireRequest();

  const checkCode = str(formData, "checkCode") as CheckCode;
  if (!CHECK_CODES.includes(checkCode)) return { error: "Select which failed requirement this waiver covers." };
  const justification = str(formData, "justification");
  if (!justification) return { error: "A justification is required." };

  const { data: position, error: positionError } = await supabase
    .from("mobilization_positions")
    .select("id, selected_crew_id, mobilization_request_id")
    .eq("id", positionId)
    .single();
  if (positionError || !position) return { error: "Could not find that position." };
  if (position.selected_crew_id !== crewId) return { error: "That crew member is no longer selected for this position." };

  const { data: existing } = await supabase
    .from("compliance_waivers")
    .select("id")
    .eq("mobilization_position_id", positionId)
    .eq("crew_id", crewId)
    .eq("check_code", checkCode)
    .in("status", ["pending", "approved"])
    .maybeSingle();
  if (existing) return { error: "A pending or approved waiver already exists for this requirement on this position." };

  const { error } = await supabase.from("compliance_waivers").insert({
    org_id: access.orgId,
    mobilization_position_id: positionId,
    crew_id: crewId,
    check_code: checkCode,
    requirement_description: optStr(formData, "requirementDescription"),
    justification,
    attachment_url: optStr(formData, "attachmentUrl"),
    expires_at: optStr(formData, "expiresAt"),
    status: "pending",
    requested_by: userId,
  });
  if (error) return { error: error.message };
  revalidateMobilization(requestId);
  return {};
}

export async function decideWaiver(waiverId: string, requestId: string, approve: boolean, formData: FormData) {
  const { supabase, userId } = await requirePermission("mobilization.approve", "You don't have permission to decide a compliance waiver.");

  const { data: waiver, error: fetchError } = await supabase.from("compliance_waivers").select("id, status").eq("id", waiverId).single();
  if (fetchError || !waiver) return { error: "Could not find that waiver." };
  if (waiver.status !== "pending") return { error: `This waiver is already ${waiver.status}.` };

  const decisionNote = optStr(formData, "decisionNote");
  if (!approve && !decisionNote) return { error: "A note is required when rejecting a waiver." };

  const update: Record<string, unknown> = {
    status: approve ? "approved" : "rejected",
    decided_by: userId,
    decided_at: new Date().toISOString(),
    decision_note: decisionNote,
    updated_at: new Date().toISOString(),
  };
  const expiresAt = optStr(formData, "expiresAt");
  if (approve && expiresAt) update.expires_at = expiresAt;

  const { error } = await supabase.from("compliance_waivers").update(update).eq("id", waiverId);
  if (error) return { error: error.message };
  revalidateMobilization(requestId);
  return {};
}

export async function cancelWaiver(waiverId: string, requestId: string) {
  const { supabase } = await requireRequest();
  const { data: waiver, error: fetchError } = await supabase.from("compliance_waivers").select("status").eq("id", waiverId).single();
  if (fetchError || !waiver) return { error: "Could not find that waiver." };
  if (waiver.status !== "pending") return { error: "Only a pending waiver request can be withdrawn." };

  const { error } = await supabase.from("compliance_waivers").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", waiverId);
  if (error) return { error: error.message };
  revalidateMobilization(requestId);
  return {};
}
