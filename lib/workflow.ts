// Generic, entity-agnostic approval workflow engine.
//
// Scope today: only app/crew/matrices/actions.ts calls this (entity_type
// 'crew_matrix'). Every function here is written against entity_type +
// entity_id, not against crew_matrices specifically, so wiring up a second
// document type later is a matter of (a) an org creating a workflow_
// definitions row for that entity_type via the Approval Workflows admin
// screen and (b) that document's own actions.ts calling startWorkflow
// Instance/getCurrentStage/actOnCurrentStage/cancelCurrentInstance the
// same way crew matrices do below — no changes needed here.
//
// See supabase/migrations/0022_phase19_workflow_engine.sql for the schema
// and the full design rationale (one active template per org+entity_type,
// snapshotted into workflow_instance_stages at submit time, permission-
// based stage gating, RLS mirrored via workflow_can_act()).

import { can, type EffectiveAccess } from "./rbac";

type Supa = {
  from: (table: string) => any;
};

// A stage's approver is either "whoever holds this permission" (the
// original design) or one specific named person — see
// supabase/migrations/0023_phase20_workflow_named_approver.sql.
export type ApproverType = "permission" | "user";

export type CurrentStageInfo = {
  instanceId: string;
  stageId: string;
  sequence: number;
  totalStages: number;
  name: string;
  approverType: ApproverType;
  requiredPermission: string | null;
  approverUserId: string | null;
};

// Does `userId` (with `access`'s permissions) get to act on this stage?
// Shared by app/crew/matrices/actions.ts (permission-checking a stage
// action) and its [id]/page.tsx (deciding whether to show the buttons).
export function canActOnStage(
  stage: { approverType: ApproverType; requiredPermission: string | null; approverUserId: string | null },
  userId: string,
  access: EffectiveAccess
): boolean {
  if (stage.approverType === "user") return stage.approverUserId === userId;
  return stage.requiredPermission ? can(access, stage.requiredPermission) : false;
}

// Skip-condition evaluators, keyed by entity_type. v1 recognizes exactly
// one literal condition, for crew_matrix: 'no_lines_require_client_
// approval', which reproduces the check that used to be hardcoded inside
// approveInternal() (skip the client stage when nothing on the matrix
// needs it). An unrecognized or blank condition is simply never skipped.
async function evaluateSkipCondition(
  supabase: Supa,
  entityType: string,
  entityId: string,
  condition: string | null
): Promise<boolean> {
  if (!condition) return false;
  if (entityType === "crew_matrix" && condition === "no_lines_require_client_approval") {
    const { count } = await supabase
      .from("crew_matrix_lines")
      .select("id", { count: "exact", head: true })
      .eq("crew_matrix_id", entityId)
      .eq("client_approval_required", true);
    return (count ?? 0) === 0;
  }
  return false;
}

// Starts a new workflow instance for an entity, snapshotting whatever the
// org's currently-active template for this entity_type looks like right
// now — a later edit to the template never reaches back into an in-flight
// approval. If the org has no active template yet for this entity type
// (a brand-new org, or one whose data predates this feature and somehow
// missed the migration's backfill), one is lazily created here as a
// single-stage gate behind `managePermission`, so submitting never
// silently does nothing.
export async function startWorkflowInstance(
  supabase: Supa,
  opts: { orgId: string; entityType: string; entityId: string; userId: string; managePermission: string }
): Promise<{ error: string } | { instanceId: string; status: "in_progress" | "approved"; autoApproved: boolean }> {
  const { orgId, entityType, entityId, userId, managePermission } = opts;

  let definition: { id: string } | null = null;
  {
    const { data } = await supabase
      .from("workflow_definitions")
      .select("id")
      .eq("org_id", orgId)
      .eq("entity_type", entityType)
      .eq("is_active", true)
      .maybeSingle();
    definition = data;
  }

  if (!definition) {
    const { data: created, error: createError } = await supabase
      .from("workflow_definitions")
      .insert({ org_id: orgId, entity_type: entityType, name: "Default Approval", is_active: true, created_by: userId })
      .select("id")
      .single();
    if (createError || !created) return { error: "Could not set up an approval workflow for this document type." };
    definition = created;
    await supabase.from("workflow_stages").insert({
      workflow_definition_id: created.id,
      org_id: orgId,
      sequence: 1,
      name: "Approval",
      required_permission: managePermission,
    });
  }
  // Non-null: either the lookup above found one, or the block just above
  // created one and returned early on failure.
  const definitionId: string = definition!.id;

  const { data: stages } = await supabase
    .from("workflow_stages")
    .select("sequence, name, approver_type, required_permission, approver_user_id, skip_condition")
    .eq("workflow_definition_id", definitionId)
    .order("sequence", { ascending: true });

  const { data: instance, error: instanceError } = await supabase
    .from("workflow_instances")
    .insert({
      org_id: orgId,
      entity_type: entityType,
      entity_id: entityId,
      workflow_definition_id: definitionId,
      status: "in_progress",
      started_by: userId,
    })
    .select("id")
    .single();
  if (instanceError || !instance) return { error: instanceError?.message ?? "Could not start the approval workflow." };

  let firstPendingStageId: string | null = null;
  for (const s of stages ?? []) {
    const skip = await evaluateSkipCondition(supabase, entityType, entityId, (s.skip_condition as string | null) ?? null);
    const { data: stageRow } = await supabase
      .from("workflow_instance_stages")
      .insert({
        workflow_instance_id: instance.id,
        org_id: orgId,
        entity_type: entityType,
        entity_id: entityId,
        sequence: s.sequence,
        name: s.name,
        approver_type: s.approver_type,
        required_permission: s.required_permission,
        approver_user_id: s.approver_user_id,
        skip_condition: s.skip_condition,
        status: skip ? "skipped" : "pending",
      })
      .select("id")
      .single();
    if (!skip && !firstPendingStageId && stageRow) firstPendingStageId = stageRow.id as string;
  }

  if (!firstPendingStageId) {
    // Every stage skipped (or the template has none at all) — auto-approve.
    const nowIso = new Date().toISOString();
    await supabase.from("workflow_instances").update({ status: "approved", completed_at: nowIso }).eq("id", instance.id);
    await supabase.from("workflow_instance_events").insert({
      workflow_instance_id: instance.id,
      org_id: orgId,
      entity_type: entityType,
      entity_id: entityId,
      event_type: "completed",
      actor_id: userId,
      comment: "Auto-approved — no applicable approval stages.",
    });
    return { instanceId: instance.id as string, status: "approved", autoApproved: true };
  }

  await supabase.from("workflow_instances").update({ current_stage_id: firstPendingStageId }).eq("id", instance.id);
  await supabase.from("workflow_instance_events").insert({
    workflow_instance_id: instance.id,
    org_id: orgId,
    entity_type: entityType,
    entity_id: entityId,
    event_type: "started",
    actor_id: userId,
  });

  return { instanceId: instance.id as string, status: "in_progress", autoApproved: false };
}

// Fetches the entity's current in-progress instance + its current stage —
// used both for rendering (which stage is next, and how many total) and,
// by the caller, to permission-check an action before calling actOnCurrentStage.
export async function getCurrentStage(supabase: Supa, entityType: string, entityId: string): Promise<CurrentStageInfo | null> {
  const { data: instance } = await supabase
    .from("workflow_instances")
    .select("id, current_stage_id")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .eq("status", "in_progress")
    .maybeSingle();
  if (!instance?.current_stage_id) return null;

  const [{ data: stage }, { count: totalStages }] = await Promise.all([
    supabase
      .from("workflow_instance_stages")
      .select("id, sequence, name, approver_type, required_permission, approver_user_id")
      .eq("id", instance.current_stage_id)
      .single(),
    supabase.from("workflow_instance_stages").select("id", { count: "exact", head: true }).eq("workflow_instance_id", instance.id),
  ]);
  if (!stage) return null;

  return {
    instanceId: instance.id as string,
    stageId: stage.id as string,
    sequence: stage.sequence as number,
    totalStages: (totalStages as number | null) ?? (stage.sequence as number),
    name: stage.name as string,
    approverType: (stage.approver_type as ApproverType) ?? "permission",
    requiredPermission: (stage.required_permission as string | null) ?? null,
    approverUserId: (stage.approver_user_id as string | null) ?? null,
  };
}

// Approves or rejects the entity's CURRENT stage (caller must already have
// fetched it via getCurrentStage and permission-checked requiredPermission
// against the acting user — this function doesn't re-check). On approve,
// advances to the next pending stage or, if none remain, completes the
// instance. On reject, ends the instance outright.
export async function actOnCurrentStage(
  supabase: Supa,
  opts: {
    orgId: string;
    entityType: string;
    entityId: string;
    instanceId: string;
    stageId: string;
    stageSequence: number;
    stageName: string;
    userId: string;
    decision: "approve" | "reject";
    comment: string | null;
  }
): Promise<{ outcome: "advanced"; nextStageName: string } | { outcome: "completed" } | { outcome: "rejected" }> {
  const { orgId, entityType, entityId, instanceId, stageId, stageSequence, stageName, userId, decision, comment } = opts;
  const nowIso = new Date().toISOString();

  await supabase
    .from("workflow_instance_stages")
    .update({ status: decision === "approve" ? "approved" : "rejected", acted_by: userId, acted_at: nowIso, comment })
    .eq("id", stageId);

  await supabase.from("workflow_instance_events").insert({
    workflow_instance_id: instanceId,
    org_id: orgId,
    entity_type: entityType,
    entity_id: entityId,
    event_type: decision === "approve" ? "stage_approved" : "stage_rejected",
    stage_name: stageName,
    actor_id: userId,
    comment,
  });

  if (decision === "reject") {
    await supabase.from("workflow_instances").update({ status: "rejected", completed_at: nowIso }).eq("id", instanceId);
    return { outcome: "rejected" };
  }

  const { data: nextStage } = await supabase
    .from("workflow_instance_stages")
    .select("id, name")
    .eq("workflow_instance_id", instanceId)
    .eq("status", "pending")
    .gt("sequence", stageSequence)
    .order("sequence", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (nextStage) {
    await supabase.from("workflow_instances").update({ current_stage_id: nextStage.id }).eq("id", instanceId);
    return { outcome: "advanced", nextStageName: nextStage.name as string };
  }

  await supabase.from("workflow_instances").update({ status: "approved", completed_at: nowIso }).eq("id", instanceId);
  await supabase.from("workflow_instance_events").insert({
    workflow_instance_id: instanceId,
    org_id: orgId,
    entity_type: entityType,
    entity_id: entityId,
    event_type: "completed",
    actor_id: userId,
  });
  return { outcome: "completed" };
}

// Cancels whatever's in-progress for an entity — used both by an explicit
// "return for correction" (back to draft) and by cancelling the entity
// outright. Best-effort / no-op if there's nothing in progress.
export async function cancelCurrentInstance(
  supabase: Supa,
  opts: {
    orgId: string;
    entityType: string;
    entityId: string;
    userId: string;
    comment?: string | null;
    eventType?: "returned" | "cancelled";
  }
) {
  const { orgId, entityType, entityId, userId, comment, eventType = "cancelled" } = opts;
  const { data: instance } = await supabase
    .from("workflow_instances")
    .select("id")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .eq("status", "in_progress")
    .maybeSingle();
  if (!instance) return;

  await supabase.from("workflow_instances").update({ status: "cancelled", completed_at: new Date().toISOString() }).eq("id", instance.id);
  await supabase.from("workflow_instance_events").insert({
    workflow_instance_id: instance.id,
    org_id: orgId,
    entity_type: entityType,
    entity_id: entityId,
    event_type: eventType,
    actor_id: userId,
    comment: comment ?? null,
  });
}
