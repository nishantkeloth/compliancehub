import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getEffectiveAccess, can } from "@/lib/rbac";
import RotationsBoard, { type ActiveAssignment, type ChangeRequest, type JoiningRow, type TransitRow, type ExtensionRow, type CrewOption } from "./rotations-board";

const DEFAULT_LEAD_DAYS = 7;

function unwrap<T>(x: T | T[] | null | undefined): T | null {
  if (!x) return null;
  return Array.isArray(x) ? x[0] ?? null : x;
}
function addDays(d: string, n: number) {
  const x = new Date(d + "T00:00:00Z");
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string) {
  return Math.round((new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) / 86400000);
}

export default async function RotationsPage({ searchParams }: { searchParams: Promise<{ assignment?: string }> }) {
  const { assignment: focusAssignmentId } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getEffectiveAccess(supabase, user.id);
  if ((!can(access, "mobilization.view") && !can(access, "crew.view")) || !access.orgId) redirect("/");
  const orgId = access.orgId;
  const canManage = can(access, "mobilization.manage");
  const canApprove = can(access, "mobilization.approve");
  const canEmergency = can(access, "mobilization.emergency_override");
  const today = new Date().toISOString().slice(0, 10);
  const weekOut = addDays(today, 7);

  const [activeRes, ccrRes, extRes, positionsRes, crewRes, profilesRes] = await Promise.all([
    supabase
      .from("crew_assignments")
      .select(
        "id, crew_id, offshore_site_id, mobilization_request_id, mobilization_position_id, start_date, planned_start_date, planned_end_date, actual_start_date, assignment_status, shift, rotation_cycle_number, reliever_crew_id, crew:crew_profiles!crew_id(full_name, employee_code, deployment_status, job_roles(name)), reliever:crew_profiles!reliever_crew_id(full_name), offshore_sites(name), rotation_templates(name, days_on, days_off), mobilization_requests(mobilization_number)"
      )
      .eq("org_id", orgId)
      .is("end_date", null)
      .order("planned_end_date", { ascending: true, nullsFirst: false }),
    supabase
      .from("crew_change_requests")
      .select(
        "id, crew_assignment_id, current_crew_id, proposed_reliever_crew_id, offshore_site_id, reason, planned_change_date, is_emergency, status, reliever_readiness_outcome, mobilization_request_id, requested_by, decided_by, decided_at, decision_note, created_at, current:crew_profiles!current_crew_id(full_name), reliever:crew_profiles!proposed_reliever_crew_id(full_name), offshore_sites(name), mobilization_requests(mobilization_number)"
      )
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("rotation_extensions")
      .select("id, crew_assignment_id, previous_planned_end_date, new_planned_end_date, reason, created_by, created_at, crew_assignments(crew_id, crew_profiles!crew_id(full_name), offshore_sites(name))")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("mobilization_positions")
      .select(
        "id, mobilization_request_id, crew_matrix_line_id, required_onboard_date, selected_crew_id, reliever_for_crew_id, final_status, job_roles(name), crew_profiles!selected_crew_id(full_name, deployment_status), crew_matrix_lines(mobilization_lead_days), mobilization_requests(mobilization_number, status, required_onboard_date, offshore_sites(name))"
      )
      .eq("org_id", orgId)
      .eq("final_status", "pending"),
    supabase
      .from("crew_profiles")
      .select("id, full_name, employee_code, primary_job_role_id, deployment_status, availability_date, job_roles(name)")
      .eq("org_id", orgId)
      .eq("employment_status", "active")
      .order("full_name"),
    supabase.from("profiles").select("id, full_name").eq("org_id", orgId),
  ]);

  const profileName = (id: string | null) => (id ? (profilesRes.data ?? []).find((p) => p.id === id)?.full_name ?? "—" : "—");

  // Pending positions — used for joining-this-week, in-transit, stranded,
  // reliever mobilization dates, and per-line mobilization lead days.
  const pendingPositions = (positionsRes.data ?? []).map((p: any) => {
    const req = unwrap<{ mobilization_number?: string; status?: string; required_onboard_date?: string; offshore_sites?: any }>(p.mobilization_requests);
    const line = unwrap<{ mobilization_lead_days?: number | null }>(p.crew_matrix_lines);
    const crew = unwrap<{ full_name?: string; deployment_status?: string }>(p.crew_profiles);
    return {
      id: p.id as string,
      requestId: p.mobilization_request_id as string,
      requestStatus: req?.status ?? "",
      mobilizationNumber: req?.mobilization_number ?? null,
      onboardDate: (p.required_onboard_date ?? req?.required_onboard_date ?? null) as string | null,
      selectedCrewId: p.selected_crew_id as string | null,
      crewName: crew?.full_name ?? null,
      deploymentStatus: crew?.deployment_status ?? "onshore",
      relieverForCrewId: p.reliever_for_crew_id as string | null,
      leadDays: line?.mobilization_lead_days ?? null,
      jobRoleName: unwrap<{ name?: string }>(p.job_roles)?.name ?? "—",
      siteName: unwrap<{ name?: string }>(req?.offshore_sites)?.name ?? "—",
      lineId: p.crew_matrix_line_id as string | null,
    };
  });
  const leadDaysByPosition: Record<string, number> = {};
  for (const p of pendingPositions) if (p.leadDays != null) leadDaysByPosition[p.id] = p.leadDays;
  const relieverPositionByCrew: Record<string, (typeof pendingPositions)[number]> = {};
  for (const p of pendingPositions) if (p.relieverForCrewId && p.selectedCrewId) relieverPositionByCrew[p.relieverForCrewId] = p;

  const openChangeByAssignment = new Set((ccrRes.data ?? []).filter((c: any) => ["pending_approval", "approved"].includes(c.status)).map((c: any) => c.crew_assignment_id));

  const active: ActiveAssignment[] = (activeRes.data ?? []).map((a: any) => {
    const crew = unwrap<{ full_name?: string; employee_code?: string; deployment_status?: string; job_roles?: any }>(a.crew);
    const rot = unwrap<{ name?: string; days_on?: number; days_off?: number }>(a.rotation_templates);
    const leadDays = (a.mobilization_position_id && leadDaysByPosition[a.mobilization_position_id]) || DEFAULT_LEAD_DAYS;
    const plannedEnd: string | null = a.planned_end_date ?? null;
    const relieverPos = relieverPositionByCrew[a.crew_id];
    const relieverMobilizationDate = plannedEnd ? addDays(plannedEnd, -leadDays) : null;
    const handoverOverlapDays = plannedEnd && relieverPos?.onboardDate ? daysBetween(relieverPos.onboardDate, plannedEnd) : null;
    const daysToSignoff = plannedEnd ? daysBetween(today, plannedEnd) : null;
    const relieverName = unwrap<{ full_name?: string }>(a.reliever)?.full_name ?? relieverPos?.crewName ?? null;
    return {
      id: a.id,
      crewId: a.crew_id,
      crewName: crew?.full_name ?? "—",
      employeeCode: crew?.employee_code ?? null,
      roleName: unwrap<{ name?: string }>(crew?.job_roles)?.name ?? null,
      deploymentStatus: crew?.deployment_status ?? "onboard",
      siteName: unwrap<{ name?: string }>(a.offshore_sites)?.name ?? "—",
      mobilizationNumber: unwrap<{ mobilization_number?: string }>(a.mobilization_requests)?.mobilization_number ?? null,
      mobilizationRequestId: a.mobilization_request_id ?? null,
      startDate: a.actual_start_date ?? a.start_date,
      plannedStartDate: a.planned_start_date ?? null,
      plannedEndDate: plannedEnd,
      status: a.assignment_status,
      shift: a.shift ?? null,
      rotationCycleNumber: a.rotation_cycle_number ?? null,
      rotationName: rot?.name ?? null,
      daysOn: rot?.days_on ?? null,
      daysOff: rot?.days_off ?? null,
      relieverCrewId: a.reliever_crew_id ?? relieverPos?.selectedCrewId ?? null,
      relieverName,
      relieverOnboardDate: relieverPos?.onboardDate ?? null,
      relieverMobilizationDate,
      handoverOverlapDays,
      daysToSignoff,
      overdue: daysToSignoff != null && daysToSignoff < 0,
      signingOffThisWeek: plannedEnd != null && plannedEnd >= today && plannedEnd <= weekOut,
      missingReliever: plannedEnd != null && !relieverName && !openChangeByAssignment.has(a.id) && daysToSignoff != null && daysToSignoff <= leadDays + 7,
      hasOpenChangeRequest: openChangeByAssignment.has(a.id),
    };
  });

  const joining: JoiningRow[] = pendingPositions
    .filter((p) => p.selectedCrewId && ["ready_to_mobilize", "in_transit", "travel_arrangement"].includes(p.requestStatus) && p.onboardDate && p.onboardDate <= weekOut)
    .map((p) => ({
      positionId: p.id,
      requestId: p.requestId,
      mobilizationNumber: p.mobilizationNumber,
      crewName: p.crewName ?? "—",
      jobRoleName: p.jobRoleName,
      siteName: p.siteName,
      onboardDate: p.onboardDate as string,
      overdue: (p.onboardDate as string) < today,
      relieving: p.relieverForCrewId ? active.find((a) => a.crewId === p.relieverForCrewId)?.crewName ?? null : null,
    }));

  const transit: TransitRow[] = pendingPositions
    .filter((p) => p.selectedCrewId && p.deploymentStatus === "in_transit")
    .map((p) => ({
      positionId: p.id,
      requestId: p.requestId,
      mobilizationNumber: p.mobilizationNumber,
      crewName: p.crewName ?? "—",
      siteName: p.siteName,
      onboardDate: p.onboardDate,
      stranded: !!p.onboardDate && p.onboardDate < today,
    }));

  const changes: ChangeRequest[] = (ccrRes.data ?? []).map((c: any) => ({
    id: c.id,
    assignmentId: c.crew_assignment_id,
    currentCrewName: unwrap<{ full_name?: string }>(c.current)?.full_name ?? "—",
    relieverName: unwrap<{ full_name?: string }>(c.reliever)?.full_name ?? null,
    siteName: unwrap<{ name?: string }>(c.offshore_sites)?.name ?? "—",
    reason: c.reason,
    plannedChangeDate: c.planned_change_date,
    isEmergency: c.is_emergency,
    status: c.status,
    relieverReadiness: c.reliever_readiness_outcome ?? null,
    mobilizationRequestId: c.mobilization_request_id ?? null,
    mobilizationNumber: unwrap<{ mobilization_number?: string }>(c.mobilization_requests)?.mobilization_number ?? null,
    requestedByName: profileName(c.requested_by),
    decidedByName: c.decided_by ? profileName(c.decided_by) : null,
    decisionNote: c.decision_note ?? null,
    createdAt: c.created_at,
  }));

  const extensions: ExtensionRow[] = (extRes.data ?? []).map((e: any) => {
    const a = unwrap<{ crew_id?: string; crew_profiles?: any; offshore_sites?: any }>(e.crew_assignments);
    return {
      id: e.id,
      crewName: unwrap<{ full_name?: string }>(a?.crew_profiles)?.full_name ?? "—",
      siteName: unwrap<{ name?: string }>(a?.offshore_sites)?.name ?? "—",
      previousEnd: e.previous_planned_end_date,
      newEnd: e.new_planned_end_date,
      reason: e.reason,
      byName: profileName(e.created_by),
      createdAt: e.created_at,
    };
  });

  const crewOptions: CrewOption[] = (crewRes.data ?? []).map((c: any) => ({
    id: c.id,
    name: c.full_name,
    code: c.employee_code ?? null,
    roleId: c.primary_job_role_id ?? null,
    roleName: unwrap<{ name?: string }>(c.job_roles)?.name ?? null,
    deploymentStatus: c.deployment_status ?? "onshore",
    availabilityDate: c.availability_date ?? null,
  }));

  return (
    <>
      <p className="text-sm mb-6" style={{ color: "var(--ch-sub)" }}>
        Who is onboard, who is joining and signing off, and what needs a reliever. Boarding (on a
        mobilization) creates an active assignment; only a sign-off confirmation here ends it.
      </p>
      <RotationsBoard
        active={active}
        joining={joining}
        transit={transit}
        changes={changes}
        extensions={extensions}
        crewOptions={crewOptions}
        canManage={canManage}
        canApprove={canApprove}
        canEmergency={canEmergency}
        focusAssignmentId={focusAssignmentId ?? null}
        today={today}
      />
    </>
  );
}
