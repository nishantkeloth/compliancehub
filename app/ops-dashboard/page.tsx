import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getEffectiveAccess, can } from "@/lib/rbac";
import AppShell from "../app-shell";
import DocumentExpiryModule, { type ExpiryRow } from "./document-expiry-module";
import CrewMatrixModule, { type MobilizedRow } from "./crew-matrix-module";
import InspectionsActionsModule, { type ScheduleRow, type CorrectiveActionRow } from "./inspections-actions-module";
import { DASHBOARD_MODULE_KEYS, SEVERITY_RANK, type DashboardModuleKey, type DocumentNotificationSeverity } from "@/lib/document-notifications";

// Supabase's join inference sometimes returns an embedded relation as a
// single object and sometimes as a one-element array — normalize both.
function unwrap<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

export default async function OpsDashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getEffectiveAccess(supabase, user.id);
  if (!access.orgId) redirect("/");
  const orgId = access.orgId;

  const moduleRes = await supabase.from("dashboard_module_settings").select("module_key, enabled").eq("org_id", orgId);
  const moduleEnabled: Record<DashboardModuleKey, boolean> = { document_expiry: true, crew_matrix: true, inspections_actions: true };
  for (const row of moduleRes.data ?? []) {
    if (DASHBOARD_MODULE_KEYS.includes(row.module_key as DashboardModuleKey)) {
      moduleEnabled[row.module_key as DashboardModuleKey] = row.enabled;
    }
  }

  const showDocumentExpiry = moduleEnabled.document_expiry && can(access, "crew.documents.view");
  const showCrewMatrix = moduleEnabled.crew_matrix && can(access, "crew.view");
  const showInspectionsActions = moduleEnabled.inspections_actions;
  const canManageNotifications = can(access, "crew.documents.manage") || can(access, "notifications.manage");

  const [expiryData, crewMatrixData, inspectionsActionsData] = await Promise.all([
    showDocumentExpiry ? loadDocumentExpiry(supabase, orgId) : Promise.resolve(null),
    showCrewMatrix ? loadCrewMatrix(supabase, orgId) : Promise.resolve(null),
    showInspectionsActions ? loadInspectionsActions(supabase, orgId) : Promise.resolve(null),
  ]);

  const noModulesVisible = !showDocumentExpiry && !showCrewMatrix && !showInspectionsActions;

  return (
    <AppShell active="ops-dashboard" title="Operations Dashboard">
      <p className="text-sm mb-6" style={{ color: "var(--ch-sub)" }}>
        A live view across document expiry, crew matrix and inspections/corrective actions. Which
        modules appear here is configured under Administration → Notification Settings.
      </p>

      {noModulesVisible ? (
        <div className="bg-white border rounded-xl p-6 text-sm" style={{ borderColor: "var(--ch-line)", color: "var(--ch-sub)" }}>
          No dashboard modules are available to you yet — either none are enabled for this company,
          or you don't have permission to view the ones that are.
        </div>
      ) : (
        <div className="space-y-5">
          {showDocumentExpiry && expiryData && <DocumentExpiryModule rows={expiryData} canManage={canManageNotifications} />}
          {showCrewMatrix && crewMatrixData && <CrewMatrixModule {...crewMatrixData} />}
          {showInspectionsActions && inspectionsActionsData && (
            <InspectionsActionsModule schedules={inspectionsActionsData.schedules} actions={inspectionsActionsData.actions} />
          )}
        </div>
      )}
    </AppShell>
  );
}

/* ================= Document Expiry & Notifications ================= */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadDocumentExpiry(supabase: any, orgId: string): Promise<ExpiryRow[]> {
  const { data: notifs } = await supabase
    .from("document_notifications")
    .select(
      "id, crew_id, severity, days_remaining, status, escalated_at, crew_profiles(full_name), document_types(name)"
    )
    .eq("org_id", orgId)
    .in("status", ["open", "acknowledged"]);

  const rows = notifs ?? [];
  const crewIds = Array.from(new Set(rows.map((r: any) => r.crew_id)));
  const activeSiteByCrew = new Map<string, string | null>();
  if (crewIds.length > 0) {
    const { data: activeAssignments } = await supabase
      .from("crew_assignments")
      .select("crew_id, offshore_sites(name)")
      .in("crew_id", crewIds)
      .is("end_date", null);
    for (const a of activeAssignments ?? []) {
      activeSiteByCrew.set(a.crew_id, unwrap<{ name?: string }>(a.offshore_sites)?.name ?? null);
    }
  }

  const out: ExpiryRow[] = rows.map((r: any) => ({
    id: r.id,
    crewName: unwrap<{ full_name?: string }>(r.crew_profiles)?.full_name ?? "—",
    documentTypeName: unwrap<{ name?: string }>(r.document_types)?.name ?? "—",
    severity: r.severity as DocumentNotificationSeverity,
    daysRemaining: r.days_remaining,
    status: r.status,
    escalated: !!r.escalated_at,
    businessCriticalSite: activeSiteByCrew.get(r.crew_id) ?? null,
  }));

  out.sort((a, b) => {
    // Business-critical (currently mobilized) first, then by severity, then by days remaining.
    const critA = a.businessCriticalSite ? 0 : 1;
    const critB = b.businessCriticalSite ? 0 : 1;
    if (critA !== critB) return critA - critB;
    const rankDiff = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (rankDiff !== 0) return rankDiff;
    return (a.daysRemaining ?? 0) - (b.daysRemaining ?? 0);
  });

  return out;
}

/* ================= Crew Matrix Overview ================= */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadCrewMatrix(supabase: any, orgId: string) {
  const { data: crewRows } = await supabase
    .from("crew_profiles")
    .select("id, employment_status, deployment_status, full_name, primary_job_role_id")
    .eq("org_id", orgId);

  const rows = crewRows ?? [];
  const totalActive = rows.filter((c: any) => c.employment_status === "active").length;
  const totalCandidate = rows.filter((c: any) => c.employment_status === "candidate").length;
  const totalInactive = rows.filter((c: any) => c.employment_status === "inactive").length;
  const onshore = rows.filter((c: any) => (c.deployment_status ?? "onshore") === "onshore").length;
  const inTransit = rows.filter((c: any) => c.deployment_status === "in_transit").length;
  const onboard = rows.filter((c: any) => c.deployment_status === "onboard").length;

  const { data: assignments } = await supabase
    .from("crew_assignments")
    .select("crew_id, offshore_sites(name)")
    .eq("org_id", orgId)
    .is("end_date", null);

  const crewById = new Map(rows.map((c: any) => [c.id, c]));
  const { data: jobRoles } = await supabase.from("job_roles").select("id, name").eq("org_id", orgId);
  const roleNameById = new Map((jobRoles ?? []).map((r: any) => [r.id, r.name]));

  const mobilized: MobilizedRow[] = (assignments ?? []).map((a: any) => {
    const crew = crewById.get(a.crew_id) as any;
    return {
      crewName: crew?.full_name ?? "—",
      roleName: crew?.primary_job_role_id ? roleNameById.get(crew.primary_job_role_id) ?? null : null,
      siteName: unwrap<{ name?: string }>(a.offshore_sites)?.name ?? null,
    };
  });

  return { totalActive, totalCandidate, totalInactive, onshore, inTransit, onboard, mobilized };
}

/* ================= Inspections, Audits & Corrective Actions ================= */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadInspectionsActions(supabase: any, orgId: string) {
  const today = new Date().toISOString().slice(0, 10);
  const soonCutoff = new Date();
  soonCutoff.setUTCDate(soonCutoff.getUTCDate() + 7);
  const soonCutoffStr = soonCutoff.toISOString().slice(0, 10);

  const [schedulesRes, actionsRes] = await Promise.all([
    supabase
      .from("inspection_schedules")
      .select("id, next_due_date, templates(name), sites(name)")
      .eq("org_id", orgId)
      .eq("active", true)
      .lte("next_due_date", soonCutoffStr)
      .order("next_due_date"),
    supabase
      .from("corrective_actions")
      .select("id, title, due_date, priority, sites(name)")
      .eq("org_id", orgId)
      .in("status", ["open", "in_progress"])
      .order("due_date"),
  ]);

  const schedules: ScheduleRow[] = (schedulesRes.data ?? []).map((s: any) => ({
    id: s.id,
    templateName: unwrap<{ name?: string }>(s.templates)?.name ?? "Inspection",
    siteName: unwrap<{ name?: string }>(s.sites)?.name ?? null,
    dueDate: s.next_due_date,
    overdue: s.next_due_date < today,
  }));

  const actions: CorrectiveActionRow[] = (actionsRes.data ?? []).map((a: any) => ({
    id: a.id,
    title: a.title,
    siteName: unwrap<{ name?: string }>(a.sites)?.name ?? null,
    dueDate: a.due_date,
    overdue: !!a.due_date && a.due_date < today,
    priority: a.priority,
  }));

  return { schedules, actions };
}
