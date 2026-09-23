"use server";

import { createClient } from "@/lib/supabase/server";
import { can, getEffectiveAccess } from "@/lib/rbac";
import { revalidatePath } from "next/cache";

async function requireManageWorkflows() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "workflows.manage")) throw new Error("You don't have permission to manage approval workflows.");
  if (!access.orgId) throw new Error("No company context.");
  return { supabase, access, userId: user.id };
}

export async function ensureWorkflowDefinition(entityType: string, name: string) {
  const { supabase, access, userId } = await requireManageWorkflows();

  const { data: existing } = await supabase
    .from("workflow_definitions")
    .select("id")
    .eq("org_id", access.orgId)
    .eq("entity_type", entityType)
    .eq("is_active", true)
    .maybeSingle();
  if (existing) return { error: null };

  const { error } = await supabase
    .from("workflow_definitions")
    .insert({ org_id: access.orgId, entity_type: entityType, name, is_active: true, created_by: userId });
  if (error) return { error: error.message };

  revalidatePath("/team/workflows");
  return { error: null };
}

async function validateApproverUser(supabase: Awaited<ReturnType<typeof requireManageWorkflows>>["supabase"], orgId: string, userId: string) {
  const { data: profile } = await supabase.from("profiles").select("org_id").eq("id", userId).maybeSingle();
  if (!profile || profile.org_id !== orgId) return "Choose someone from your company.";
  return null;
}

export async function addStage(
  definitionId: string,
  name: string,
  approverType: "permission" | "user",
  approverValue: string, // a permission key when approverType is "permission", a profile id when "user"
  skipCondition: string | null
) {
  name = name.trim();
  if (!name) return { error: "Stage name is required." };
  if (!approverValue) return { error: approverType === "permission" ? "Choose which permission unlocks this stage." : "Choose who approves this stage." };

  const { supabase, access } = await requireManageWorkflows();

  const { data: def } = await supabase.from("workflow_definitions").select("id").eq("id", definitionId).eq("org_id", access.orgId).maybeSingle();
  if (!def) return { error: "Could not find that workflow." };

  if (approverType === "user") {
    const validationError = await validateApproverUser(supabase, access.orgId!, approverValue);
    if (validationError) return { error: validationError };
  }

  const { count } = await supabase.from("workflow_stages").select("id", { count: "exact", head: true }).eq("workflow_definition_id", definitionId);

  const { error } = await supabase.from("workflow_stages").insert({
    workflow_definition_id: definitionId,
    org_id: access.orgId,
    sequence: (count ?? 0) + 1,
    name,
    approver_type: approverType,
    required_permission: approverType === "permission" ? approverValue : null,
    approver_user_id: approverType === "user" ? approverValue : null,
    skip_condition: skipCondition || null,
  });
  if (error) return { error: error.message };

  revalidatePath("/team/workflows");
  return { error: null };
}

export async function updateStage(
  stageId: string,
  fields: { name?: string; approverType?: "permission" | "user"; requiredPermission?: string | null; approverUserId?: string | null; skipCondition?: string | null }
) {
  const { supabase, access } = await requireManageWorkflows();

  const update: Record<string, unknown> = {};
  if (fields.name !== undefined) {
    const name = fields.name.trim();
    if (!name) return { error: "Stage name is required." };
    update.name = name;
  }

  if (fields.approverType !== undefined) {
    // Switching approver type — both required_permission and
    // approver_user_id must be set together to satisfy workflow_stages_
    // approver_shape (see 0023's check constraint).
    if (fields.approverType === "permission") {
      if (!fields.requiredPermission) return { error: "Choose which permission unlocks this stage." };
      update.approver_type = "permission";
      update.required_permission = fields.requiredPermission;
      update.approver_user_id = null;
    } else {
      if (!fields.approverUserId) return { error: "Choose who approves this stage." };
      const validationError = await validateApproverUser(supabase, access.orgId!, fields.approverUserId);
      if (validationError) return { error: validationError };
      update.approver_type = "user";
      update.approver_user_id = fields.approverUserId;
      update.required_permission = null;
    }
  } else {
    // Staying on the same approver type — just changing which permission
    // or which person, without touching the other column.
    if (fields.requiredPermission !== undefined) {
      if (!fields.requiredPermission) return { error: "Choose which permission unlocks this stage." };
      update.required_permission = fields.requiredPermission;
    }
    if (fields.approverUserId !== undefined) {
      if (!fields.approverUserId) return { error: "Choose who approves this stage." };
      const validationError = await validateApproverUser(supabase, access.orgId!, fields.approverUserId);
      if (validationError) return { error: validationError };
      update.approver_user_id = fields.approverUserId;
    }
  }

  if (fields.skipCondition !== undefined) update.skip_condition = fields.skipCondition || null;
  if (Object.keys(update).length === 0) return { error: null };

  const { error } = await supabase.from("workflow_stages").update(update).eq("id", stageId).eq("org_id", access.orgId);
  if (error) return { error: error.message };

  revalidatePath("/team/workflows");
  return { error: null };
}

export async function deleteStage(stageId: string) {
  const { supabase, access } = await requireManageWorkflows();

  const { data: stage } = await supabase
    .from("workflow_stages")
    .select("workflow_definition_id, sequence")
    .eq("id", stageId)
    .eq("org_id", access.orgId)
    .maybeSingle();
  if (!stage) return { error: "Could not find that stage." };

  const { error } = await supabase.from("workflow_stages").delete().eq("id", stageId).eq("org_id", access.orgId);
  if (error) return { error: error.message };

  // Close the sequence gap so stage numbers stay contiguous (1..N) —
  // the engine's "next pending stage after mine" lookup only needs
  // increasing order, not literal contiguity, but contiguous numbers
  // are much less confusing to read back in the admin screen.
  const { data: remaining } = await supabase
    .from("workflow_stages")
    .select("id, sequence")
    .eq("workflow_definition_id", stage.workflow_definition_id)
    .gt("sequence", stage.sequence)
    .order("sequence", { ascending: true });
  for (const r of remaining ?? []) {
    await supabase.from("workflow_stages").update({ sequence: (r.sequence as number) - 1 }).eq("id", r.id);
  }

  revalidatePath("/team/workflows");
  return { error: null };
}

export async function moveStage(stageId: string, direction: "up" | "down") {
  const { supabase, access } = await requireManageWorkflows();

  const { data: stage } = await supabase
    .from("workflow_stages")
    .select("workflow_definition_id, sequence")
    .eq("id", stageId)
    .eq("org_id", access.orgId)
    .maybeSingle();
  if (!stage) return { error: "Could not find that stage." };

  const targetSeq = direction === "up" ? (stage.sequence as number) - 1 : (stage.sequence as number) + 1;
  const { data: neighbor } = await supabase
    .from("workflow_stages")
    .select("id")
    .eq("workflow_definition_id", stage.workflow_definition_id)
    .eq("sequence", targetSeq)
    .maybeSingle();
  if (!neighbor) return { error: null }; // already at the top/bottom — no-op

  // Swap via a temporary sequence value to dodge the unique(definition_id,
  // sequence) index while both rows are mid-update.
  await supabase.from("workflow_stages").update({ sequence: -1 }).eq("id", stageId);
  await supabase.from("workflow_stages").update({ sequence: stage.sequence }).eq("id", neighbor.id);
  await supabase.from("workflow_stages").update({ sequence: targetSeq }).eq("id", stageId);

  revalidatePath("/team/workflows");
  return { error: null };
}
