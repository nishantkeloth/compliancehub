import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import { getEffectiveAccess, can } from "@/lib/rbac";
import MobilizationDetail from "./mobilization-detail";

export default async function MobilizationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "mobilization.view") || !access.orgId) redirect("/");

  const { data: request } = await supabase
    .from("mobilization_requests")
    .select("*, projects(project_name), offshore_sites(name), crew_matrices(matrix_number, title)")
    .eq("id", id)
    .eq("org_id", access.orgId)
    .single();
  if (!request) notFound();

  // Phase 12: which client this mobilization's matrix ultimately belongs
  // to (project -> contract -> client), used to scope which
  // Mobilization Tracks are offered for its positions — plus the
  // contract's own mobilization_notice_days, which the Crew Change
  // Manifest step will read as its default lead-time warning.
  const { data: projectRow } = await supabase
    .from("projects")
    .select("contract_id, contracts(client_id, mobilization_notice_days)")
    .eq("id", request.project_id)
    .maybeSingle();
  const contractRow = (Array.isArray(projectRow?.contracts) ? projectRow?.contracts[0] : projectRow?.contracts) as
    | { client_id?: string; mobilization_notice_days?: number }
    | null
    | undefined;
  const clientId = contractRow?.client_id ?? null;

  const [{ data: positions }, { data: statusHistory }, { data: positionHistory }, { data: comments }, { data: jobRoles }, { data: profiles }, { data: tracks }] = await Promise.all([
    supabase
      .from("mobilization_positions")
      .select(
        "id, crew_matrix_line_id, job_role_id, position_sequence, required_onboard_date, selected_crew_id, reliever_for_crew_id, readiness_status, client_approval_status, final_status, is_additional, additional_reason, remarks, mobilization_track_id, job_roles(name), selected_crew:crew_profiles!selected_crew_id(id, full_name, employee_code), reliever_crew:crew_profiles!reliever_for_crew_id(id, full_name)"
      )
      .eq("mobilization_request_id", id)
      .order("job_role_id", { ascending: true })
      .order("position_sequence", { ascending: true }),
    supabase
      .from("mobilization_status_history")
      .select("id, old_status, new_status, changed_by, changed_at")
      .eq("mobilization_request_id", id)
      .order("changed_at", { ascending: false }),
    supabase
      .from("mobilization_position_history")
      .select(
        "id, mobilization_position_id, previous_crew_id, new_crew_id, reason, changed_by, changed_at, previous_crew:crew_profiles!previous_crew_id(full_name), new_crew:crew_profiles!new_crew_id(full_name)"
      )
      .in(
        "mobilization_position_id",
        (
          await supabase.from("mobilization_positions").select("id").eq("mobilization_request_id", id)
        ).data?.map((p) => p.id) ?? []
      )
      .order("changed_at", { ascending: false }),
    supabase.from("mobilization_comments").select("id, user_id, body, is_system, created_at").eq("mobilization_request_id", id).order("created_at", { ascending: true }),
    supabase.from("job_roles").select("id, name").eq("org_id", access.orgId).eq("is_active", true).order("name"),
    supabase.from("profiles").select("id, full_name").eq("org_id", access.orgId).order("full_name"),
    // Tracks offered for this mobilization's positions: this client's own
    // configured tracks, plus any org-wide default track (client_id null)
    // for a client without a configured process yet.
    supabase
      .from("mobilization_tracks")
      .select("id, client_id, name")
      .eq("org_id", access.orgId)
      .eq("is_active", true)
      .or(clientId ? `client_id.eq.${clientId},client_id.is.null` : "client_id.is.null")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
  ]);

  const positionIds = (positions ?? []).map((p) => p.id as string);
  const { data: checklistItems } = positionIds.length
    ? await supabase
        .from("mobilization_position_checklist_items")
        .select("id, mobilization_position_id, sequence, title, description, is_parallel, due_date, status, completed_at, completed_by")
        .in("mobilization_position_id", positionIds)
        .order("sequence", { ascending: true })
    : { data: [] };

  const project = (Array.isArray(request.projects) ? request.projects[0] : request.projects) as { project_name?: string } | null;
  const site = (Array.isArray(request.offshore_sites) ? request.offshore_sites[0] : request.offshore_sites) as { name?: string } | null;
  const matrix = (Array.isArray(request.crew_matrices) ? request.crew_matrices[0] : request.crew_matrices) as { matrix_number?: string; title?: string } | null;

  const positionRows = (positions ?? []).map((p) => {
    const role = (Array.isArray(p.job_roles) ? p.job_roles[0] : p.job_roles) as { name?: string } | null;
    const selected = (Array.isArray(p.selected_crew) ? p.selected_crew[0] : p.selected_crew) as { id?: string; full_name?: string; employee_code?: string } | null;
    const reliever = (Array.isArray(p.reliever_crew) ? p.reliever_crew[0] : p.reliever_crew) as { id?: string; full_name?: string } | null;
    return {
      id: p.id as string,
      crew_matrix_line_id: p.crew_matrix_line_id as string | null,
      job_role_id: p.job_role_id as string,
      job_role_name: role?.name ?? "—",
      position_sequence: p.position_sequence as number,
      required_onboard_date: p.required_onboard_date as string | null,
      selected_crew_id: p.selected_crew_id as string | null,
      selected_crew_name: selected?.full_name ?? null,
      selected_crew_code: selected?.employee_code ?? null,
      reliever_for_crew_id: p.reliever_for_crew_id as string | null,
      reliever_for_crew_name: reliever?.full_name ?? null,
      readiness_status: p.readiness_status as string,
      client_approval_status: p.client_approval_status as string,
      final_status: p.final_status as string,
      is_additional: p.is_additional as boolean,
      additional_reason: p.additional_reason as string | null,
      remarks: p.remarks as string | null,
      mobilization_track_id: p.mobilization_track_id as string | null,
    };
  });

  const profileName = (userId: string | null) => (userId ? (profiles ?? []).find((pr) => pr.id === userId)?.full_name ?? "—" : "—");

  return (
    <MobilizationDetail
      request={{
        id: request.id,
        mobilization_number: request.mobilization_number,
        mobilization_type: request.mobilization_type,
        status: request.status,
        priority: request.priority,
        request_date: request.request_date,
        required_onboard_date: request.required_onboard_date,
        crew_change_location: request.crew_change_location,
        travel_origin: request.travel_origin,
        special_instructions: request.special_instructions,
        client_approval_required: request.client_approval_required,
        project_name: project?.project_name ?? "—",
        site_name: site?.name ?? "—",
        matrix_label: matrix ? `${matrix.matrix_number ?? "—"} — ${matrix.title ?? ""}` : "—",
        requested_by_name: profileName(request.requested_by),
        coordinator_name: profileName(request.coordinator_user_id),
        approved_by_name: request.approved_by ? profileName(request.approved_by) : null,
        approved_at: request.approved_at,
      }}
      positions={positionRows}
      statusHistory={(statusHistory ?? []).map((h) => ({
        id: h.id as string,
        old_status: h.old_status as string | null,
        new_status: h.new_status as string,
        changed_by_name: profileName(h.changed_by as string | null),
        changed_at: h.changed_at as string,
      }))}
      positionHistory={(positionHistory ?? []).map((h) => ({
        id: h.id as string,
        mobilization_position_id: h.mobilization_position_id as string,
        previous_crew_name: ((Array.isArray(h.previous_crew) ? h.previous_crew[0] : h.previous_crew) as { full_name?: string } | null)?.full_name ?? null,
        new_crew_name: ((Array.isArray(h.new_crew) ? h.new_crew[0] : h.new_crew) as { full_name?: string } | null)?.full_name ?? null,
        reason: h.reason as string | null,
        changed_by_name: profileName(h.changed_by as string | null),
        changed_at: h.changed_at as string,
      }))}
      comments={(comments ?? []).map((c) => ({
        id: c.id as string,
        author_name: c.is_system ? "System" : profileName(c.user_id as string | null),
        body: c.body as string,
        is_system: c.is_system as boolean,
        created_at: c.created_at as string,
      }))}
      jobRoles={jobRoles ?? []}
      tracks={(tracks ?? []).map((t) => ({ id: t.id as string, client_id: t.client_id as string | null, name: t.name as string }))}
      checklistItems={(checklistItems ?? []).map((c) => ({
        id: c.id as string,
        mobilization_position_id: c.mobilization_position_id as string,
        sequence: c.sequence as number,
        title: c.title as string,
        description: c.description as string | null,
        is_parallel: c.is_parallel as boolean,
        due_date: c.due_date as string | null,
        status: c.status as string,
        completed_at: c.completed_at as string | null,
      }))}
      canManage={can(access, "mobilization.manage")}
      canComplianceReview={can(access, "mobilization.compliance_review")}
      canApprove={can(access, "mobilization.approve")}
      canCancel={can(access, "mobilization.cancel")}
      canEmergencyOverride={can(access, "mobilization.emergency_override")}
    />
  );
}
