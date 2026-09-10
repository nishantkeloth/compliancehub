import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AppShell from "@/app/app-shell";
import { getEffectiveAccess, can } from "@/lib/rbac";
import DocumentsMatrix from "./documents-matrix";

export default async function CrewDocumentsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "crew.documents.view")) redirect("/");
  const canManage = can(access, "crew.documents.manage");

  const [crewRes, assignmentsRes, documentTypesRes, crewDocumentsRes, offshoreSitesRes] = await Promise.all([
    supabase
      .from("crew_profiles")
      .select("id, full_name, employment_status, job_roles(name)")
      .eq("org_id", access.orgId)
      .order("full_name"),
    supabase
      .from("crew_assignments")
      .select("crew_id, offshore_site_id, offshore_sites(name)")
      .eq("org_id", access.orgId)
      .is("end_date", null),
    supabase
      .from("document_types")
      .select("id, name, category, tracks_number, warning_threshold_days, is_active")
      .eq("org_id", access.orgId)
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("crew_documents")
      .select(
        "id, crew_id, document_type_id, document_number, sponsor, issue_date, expiry_date, entry_date, extension_date, dose_number, reliever_crew_id, notes, custom_fields, created_at"
      )
      .eq("org_id", access.orgId)
      .order("created_at", { ascending: false }),
    supabase.from("offshore_sites").select("id, name").eq("org_id", access.orgId).eq("status", "active").order("name"),
  ]);

  // One cell per (crew_id, document_type_id) — keep only the most recent
  // row for each, matching the "status is always computed from the most
  // recent row" rule from the spec (a vaccination's later dose naturally
  // wins here since rows are already ordered newest-first).
  const cellMap: Record<string, Record<string, any>> = {};
  for (const doc of crewDocumentsRes.data ?? []) {
    const d = doc as any;
    cellMap[d.crew_id] ??= {};
    cellMap[d.crew_id][d.document_type_id] ??= d;
  }

  const siteByCrew: Record<string, { id: string; name: string }> = {};
  for (const a of assignmentsRes.data ?? []) {
    const row = a as any;
    const site = Array.isArray(row.offshore_sites) ? row.offshore_sites[0] : row.offshore_sites;
    if (site) siteByCrew[row.crew_id] = { id: row.offshore_site_id, name: site.name };
  }

  const crew = (crewRes.data ?? []).map((c: any) => {
    const role = Array.isArray(c.job_roles) ? c.job_roles[0] : c.job_roles;
    const site = siteByCrew[c.id];
    return {
      id: c.id,
      fullName: c.full_name,
      employmentStatus: c.employment_status,
      roleName: role?.name ?? null,
      siteId: site?.id ?? null,
      siteName: site?.name ?? null,
    };
  });

  return (
    <AppShell active="crew-documents" title="Crew Documents">
      <p className="text-sm mb-6" style={{ color: "var(--ch-sub)" }}>
        Visas, passports, seaman books, certificates and vaccinations across the whole crew — a
        digital replacement for the per-vessel Excel trackers. Click any cell to view or update
        that record.
      </p>

      <DocumentsMatrix
        crew={crew}
        documentTypes={documentTypesRes.data ?? []}
        cellMap={cellMap}
        offshoreSites={offshoreSitesRes.data ?? []}
        canManage={canManage}
      />
    </AppShell>
  );
}
