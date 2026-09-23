import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getEffectiveAccess, can } from "@/lib/rbac";
import { canActOnStage, type ApproverType } from "@/lib/workflow";
import { StatusPill } from "@/app/contracts/contracts-manager";

const cardCls = "bg-white border rounded-xl";
const cardStyle = { borderColor: "var(--ch-line)" };

export default async function ApprovalQueuePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "crew.matrix.view") || !access.orgId) redirect("/");

  // Every matrix currently sitting in ANY pending-approval status — the
  // new generic-engine one (pending_approval) plus the two legacy ones
  // (pending_internal_approval/pending_client_approval) a matrix can
  // still be in if it was submitted before the workflow engine shipped.
  // Filtered down below to just the ones THIS user can actually act on.
  const { data: matrices } = await supabase
    .from("crew_matrices")
    .select("id, matrix_number, version_number, title, status, expected_pob, total_required_headcount, projects(project_name), offshore_sites(name)")
    .eq("org_id", access.orgId)
    .in("status", ["pending_approval", "pending_internal_approval", "pending_client_approval"])
    .order("matrix_number", { ascending: true });

  const allRows = (matrices ?? []).map((m) => {
    const project = Array.isArray(m.projects) ? m.projects[0] : m.projects;
    const site = Array.isArray(m.offshore_sites) ? m.offshore_sites[0] : m.offshore_sites;
    return {
      id: m.id as string,
      matrix_number: m.matrix_number as string | null,
      version_number: m.version_number as number,
      title: m.title as string,
      status: m.status as string,
      expected_pob: m.expected_pob as number | null,
      total_required_headcount: m.total_required_headcount as number,
      project_name: (project as { project_name?: string } | null)?.project_name ?? "—",
      site_name: (site as { name?: string } | null)?.name ?? "—",
    };
  });

  // For the new-engine matrices only: pull each one's current in-progress
  // stage (name + who can act on it) so we can filter to "assigned to me"
  // and show the stage name on the card.
  const pendingApprovalIds = allRows.filter((r) => r.status === "pending_approval").map((r) => r.id);
  const stageByMatrixId = new Map<
    string,
    { name: string; sequence: number; totalStages: number; approverType: ApproverType; requiredPermission: string | null; approverUserId: string | null }
  >();
  if (pendingApprovalIds.length) {
    const { data: instances } = await supabase
      .from("workflow_instances")
      .select("id, entity_id, current_stage_id")
      .eq("entity_type", "crew_matrix")
      .eq("status", "in_progress")
      .in("entity_id", pendingApprovalIds);

    const instanceIds = (instances ?? []).map((i) => i.id as string);
    const { data: allStages } = instanceIds.length
      ? await supabase
          .from("workflow_instance_stages")
          .select("id, workflow_instance_id, sequence, name, approver_type, required_permission, approver_user_id")
          .in("workflow_instance_id", instanceIds)
      : { data: [] as { id: string; workflow_instance_id: string; sequence: number; name: string; approver_type: string; required_permission: string | null; approver_user_id: string | null }[] };

    for (const inst of instances ?? []) {
      const stagesForInstance = (allStages ?? []).filter((s) => s.workflow_instance_id === inst.id);
      const current = stagesForInstance.find((s) => s.id === inst.current_stage_id);
      if (!current) continue;
      stageByMatrixId.set(inst.entity_id as string, {
        name: current.name as string,
        sequence: current.sequence as number,
        totalStages: stagesForInstance.length,
        approverType: (current.approver_type as ApproverType) ?? "permission",
        requiredPermission: current.required_permission as string | null,
        approverUserId: current.approver_user_id as string | null,
      });
    }
  }

  const myRows = allRows
    .filter((r) => {
      if (r.status === "pending_internal_approval") return can(access, "crew.matrix.approve_internal");
      if (r.status === "pending_client_approval") return can(access, "crew.matrix.approve_client");
      if (r.status === "pending_approval") {
        const stage = stageByMatrixId.get(r.id);
        return stage ? canActOnStage(stage, user.id, access) : false;
      }
      return false;
    })
    .map((r) => {
      const stage = stageByMatrixId.get(r.id);
      const stageLabel = r.status === "pending_internal_approval" ? "Internal Approval" : r.status === "pending_client_approval" ? "Client Approval" : stage?.name ?? "Approval";
      const stageProgress = stage ? `Stage ${stage.sequence} of ${stage.totalStages}` : null;
      return { ...r, stageLabel, stageProgress };
    });

  return (
    <>
      <p className="text-sm mb-6" style={{ color: "var(--ch-sub)" }}>
        Crew matrices currently waiting on your approval — internal or client sign-off, or a named stage assigned
        directly to you. Open one to review it in full and approve, reject, or return it for correction.
      </p>

      {myRows.length === 0 ? (
        <div className={`${cardCls} p-6 text-sm`} style={{ ...cardStyle, color: "var(--ch-sub)" }}>
          Nothing is waiting on you right now.
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {myRows.map((m) => (
            <Link key={m.id} href={`/crew/matrices/${m.id}`} className={`${cardCls} p-4 flex flex-col gap-3 block hover:shadow-md transition-shadow`} style={cardStyle}>
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-semibold leading-snug" style={{ color: "var(--ch-ink)" }}>
                  {m.title}
                </span>
                <StatusPill status={m.status} />
              </div>

              <div className="text-xs" style={{ color: "var(--ch-sub)" }}>
                {m.site_name} · {m.project_name}
              </div>

              <div className="text-xs font-semibold rounded-lg px-2.5 py-1.5" style={{ background: "var(--ch-navy-soft)", color: "var(--ch-navy)" }}>
                {m.stageLabel}
                {m.stageProgress && ` · ${m.stageProgress}`}
              </div>

              <div className="flex items-center justify-between gap-2 flex-wrap">
                {m.matrix_number ? (
                  <span className="text-[10px] font-mono font-bold rounded px-1.5 py-0.5" style={{ background: "var(--ch-paper)", color: "var(--ch-sub)" }}>
                    {m.matrix_number} · v{m.version_number}
                  </span>
                ) : (
                  <span />
                )}
                <span className="text-[11px]" style={{ color: "var(--ch-sub)" }}>
                  POB {m.expected_pob ?? "—"} · Headcount {m.total_required_headcount ?? "—"}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
