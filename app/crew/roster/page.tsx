import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AppShell from "@/app/app-shell";
import { getEffectiveAccess, can } from "@/lib/rbac";
import { computeDocumentStatus, type DocumentStatus } from "@/lib/document-status";
import RosterBoard from "./roster-board";

// Worse-status wins when a crew member has several tracked documents —
// e.g. someone with one expired certificate should show as "expired" on
// the board even if their other documents are fine.
const STATUS_RANK: Record<DocumentStatus, number> = { none: 0, ok: 1, warning: 2, critical: 3, expired: 4 };

export default async function VesselRosterPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "crew.view")) redirect("/");
  const canManage = can(access, "crew.manage");

  const [crewRes, assignmentsRes, sitesRes, manningRes, contractorsRes, documentTypesRes, crewDocumentsRes] = await Promise.all([
    supabase
      .from("crew_profiles")
      .select("id, full_name, employment_status, job_roles(name)")
      .eq("org_id", access.orgId)
      .neq("employment_status", "terminated")
      .order("full_name"),
    // Full assignment history (not just open rows) — the board needs the
    // current (end_date is null) row per crew member, and the timeline tab
    // draws every row as a bar so a reassignment shows up as history.
    supabase
      .from("crew_assignments")
      .select("id, crew_id, offshore_site_id, start_date, end_date")
      .eq("org_id", access.orgId)
      .order("start_date"),
    supabase
      .from("offshore_sites")
      .select("id, name, code, site_type, status, contractor_id")
      .eq("org_id", access.orgId)
      .eq("status", "active")
      .order("name"),
    supabase
      .from("site_manning_requirements")
      .select("offshore_site_id, minimum_headcount")
      .eq("org_id", access.orgId),
    supabase.from("contractors").select("id, name").eq("org_id", access.orgId),
    supabase
      .from("document_types")
      .select("id, category, warning_threshold_days")
      .eq("org_id", access.orgId)
      .eq("is_active", true),
    // Same "most recent row per (crew, document type)" rule as the
    // documents matrix — newest-first so the first row seen per pair wins.
    supabase
      .from("crew_documents")
      .select("crew_id, document_type_id, expiry_date")
      .eq("org_id", access.orgId)
      .order("created_at", { ascending: false }),
  ]);

  const contractorNameById: Record<string, string> = {};
  for (const c of contractorsRes.data ?? []) contractorNameById[(c as any).id] = (c as any).name;

  const capacityBySite: Record<string, number> = {};
  for (const m of manningRes.data ?? []) {
    const row = m as any;
    capacityBySite[row.offshore_site_id] = (capacityBySite[row.offshore_site_id] ?? 0) + (row.minimum_headcount ?? 0);
  }

  const openSiteByCrew: Record<string, string> = {};
  for (const a of assignmentsRes.data ?? []) {
    const row = a as any;
    if (row.end_date === null) openSiteByCrew[row.crew_id] = row.offshore_site_id;
  }

  const docTypeById: Record<string, { category: string | null; warningThresholdDays: number | null }> = {};
  for (const t of documentTypesRes.data ?? []) {
    const row = t as any;
    docTypeById[row.id] = { category: row.category, warningThresholdDays: row.warning_threshold_days };
  }
  // most-recent-row-per-(crew, document type), then the worst status among
  // a crew member's document types becomes their roster-card badge.
  const latestCellByCrew: Record<string, Record<string, string | null>> = {};
  for (const d of crewDocumentsRes.data ?? []) {
    const row = d as any;
    latestCellByCrew[row.crew_id] ??= {};
    if (!(row.document_type_id in latestCellByCrew[row.crew_id])) {
      latestCellByCrew[row.crew_id][row.document_type_id] = row.expiry_date;
    }
  }
  const docStatusByCrew: Record<string, DocumentStatus> = {};
  for (const [crewId, cells] of Object.entries(latestCellByCrew)) {
    let worst: DocumentStatus = "none";
    for (const [docTypeId, expiryDate] of Object.entries(cells)) {
      const type = docTypeById[docTypeId];
      const { status } = computeDocumentStatus(expiryDate, type?.warningThresholdDays ?? null, type?.category ?? null);
      if (STATUS_RANK[status] > STATUS_RANK[worst]) worst = status;
    }
    docStatusByCrew[crewId] = worst;
  }

  const sites = (sitesRes.data ?? []).map((s: any) => ({
    id: s.id,
    name: s.name,
    code: s.code as string | null,
    siteType: s.site_type as string,
    contractorName: s.contractor_id ? contractorNameById[s.contractor_id] ?? null : null,
    capacity: capacityBySite[s.id] ?? 0,
  }));

  const crew = (crewRes.data ?? []).map((c: any) => {
    const role = Array.isArray(c.job_roles) ? c.job_roles[0] : c.job_roles;
    return {
      id: c.id,
      fullName: c.full_name,
      roleName: role?.name ?? null,
      employmentStatus: c.employment_status,
      siteId: openSiteByCrew[c.id] ?? null,
      docStatus: docStatusByCrew[c.id] ?? "none",
    };
  });

  const history = (assignmentsRes.data ?? []).map((a: any) => ({
    id: a.id,
    crewId: a.crew_id,
    siteId: a.offshore_site_id,
    startDate: a.start_date,
    endDate: a.end_date,
  }));

  return (
    <AppShell active="crew-roster" title="Vessel Roster">
      <p className="text-sm mb-6" style={{ color: "var(--ch-sub)" }}>
        Plan and reassign crew by vessel. This sits alongside the per-person Vessel Assignment
        card on each crew profile — use whichever is quicker for the change you're making.
      </p>

      <RosterBoard crew={crew} sites={sites} history={history} canManage={canManage} />
    </AppShell>
  );
}
