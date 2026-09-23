import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { can, getEffectiveAccess } from "@/lib/rbac";
import WorkflowsManager from "./workflows-manager";

// Scope today: Crew Matrix only (see lib/workflow.ts's header comment for
// why the engine underneath isn't limited to this). Adding a second
// document type later is just another entry here plus that document's
// own actions.ts calling into lib/workflow.ts the same way crew matrices
// do — no new admin screen needed.
const ENTITY_TYPES: { value: string; label: string }[] = [{ value: "crew_matrix", label: "Crew Matrix" }];

export default async function WorkflowsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "workflows.manage") || !access.orgId) redirect("/team");

  const { data: definitions } = await supabase
    .from("workflow_definitions")
    .select("id, entity_type, name")
    .eq("org_id", access.orgId)
    .eq("is_active", true)
    .order("entity_type");

  const definitionIds = (definitions ?? []).map((d) => d.id as string);
  const { data: stageRows } = definitionIds.length
    ? await supabase
        .from("workflow_stages")
        .select("id, workflow_definition_id, sequence, name, approver_type, required_permission, approver_user_id, skip_condition")
        .in("workflow_definition_id", definitionIds)
        .order("sequence", { ascending: true })
    : {
        data: [] as {
          id: string;
          workflow_definition_id: string;
          sequence: number;
          name: string;
          approver_type: string;
          required_permission: string | null;
          approver_user_id: string | null;
          skip_condition: string | null;
        }[],
      };

  // Restricted to crew.matrix.* since that's the only entity type wired
  // up today — widen this filter (or make it per-entity-type) once a
  // second document type is added.
  const { data: permissions } = await supabase.from("permissions").select("key, label").like("key", "crew.matrix.%").order("key");

  // For the "assign to a specific person" approver option.
  const { data: members } = await supabase.from("profiles").select("id, full_name").eq("org_id", access.orgId).eq("status", "active").order("full_name");

  return (
    <>
      <p className="text-sm mb-6" style={{ color: "var(--ch-sub)" }}>
        Configure the approval stages each document type goes through when it&apos;s submitted. Add, reorder, rename or
        remove stages — each one names the permission that unlocks it, so exactly who can approve it is still
        controlled from Roles &amp; Permissions. Changes here only apply to documents submitted after you save;
        anything already mid-approval keeps running on the stages it started with.
      </p>
      <WorkflowsManager
        entityTypes={ENTITY_TYPES}
        definitions={(definitions ?? []).map((d) => ({ id: d.id as string, entityType: d.entity_type as string, name: d.name as string }))}
        stages={(stageRows ?? []).map((s) => ({
          id: s.id as string,
          definitionId: s.workflow_definition_id as string,
          sequence: s.sequence as number,
          name: s.name as string,
          approverType: (s.approver_type as "permission" | "user") ?? "permission",
          requiredPermission: s.required_permission as string | null,
          approverUserId: s.approver_user_id as string | null,
          skipCondition: s.skip_condition as string | null,
        }))}
        permissions={permissions ?? []}
        members={(members ?? []).map((m) => ({ id: m.id as string, fullName: m.full_name as string }))}
      />
    </>
  );
}
