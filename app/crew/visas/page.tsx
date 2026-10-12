import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getEffectiveAccess, can } from "@/lib/rbac";
import { assessVisa, VISA_STATUS_LABEL } from "@/lib/visa";
import VisaTracker, { type VisaRow, type NoVisaRow } from "./visa-tracker";

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped supabase rows, same pattern as the other crew pages */

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default async function VisaTrackerPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "crew.documents.view") || !access.orgId) redirect("/");
  const orgId = access.orgId;
  const today = todayISO();

  const { data: visaDocTypes } = await supabase.from("document_types").select("id, name").eq("org_id", orgId).eq("category", "visa");
  const docTypeName = new Map((visaDocTypes ?? []).map((t: any) => [t.id as string, t.name as string]));
  const visaDocTypeIds = Array.from(docTypeName.keys());

  // PostgREST caps one query at 1000 rows; page through so none are dropped.
  async function fetchVisaDocuments() {
    if (!visaDocTypeIds.length) return [] as any[];
    const rows: any[] = [];
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from("crew_documents")
        .select("id, crew_id, document_type_id, document_number, issue_date, expiry_date, entry_date, visa_country, visa_type_id, visa_status, created_at")
        .eq("org_id", orgId)
        .eq("is_active", true)
        .in("document_type_id", visaDocTypeIds)
        .order("created_at", { ascending: false })
        .range(from, from + 999);
      if (error || !data) break;
      rows.push(...data);
      if (data.length < 1000) break;
      from += 1000;
    }
    return rows;
  }

  const [docs, crewRes, visaTypesRes, assignmentsRes] = await Promise.all([
    fetchVisaDocuments(),
    supabase.from("crew_profiles").select("id, full_name, employment_status, job_roles(name)").eq("org_id", orgId).order("full_name"),
    supabase
      .from("visa_types")
      .select("id, country, name, entry_valid_days, stay_basis, stay_days, entry_type, expiry_reminder_days, entry_reminder_days")
      .eq("org_id", orgId),
    supabase.from("crew_assignments").select("crew_id, offshore_sites(name)").eq("org_id", orgId).is("end_date", null),
  ]);

  const crewById = new Map<string, any>((crewRes.data ?? []).map((c: any) => [c.id as string, c]));
  const typeById = new Map<string, any>((visaTypesRes.data ?? []).map((t: any) => [t.id as string, t]));
  const siteByCrew = new Map<string, string>();
  for (const a of assignmentsRes.data ?? []) {
    const site = Array.isArray((a as any).offshore_sites) ? (a as any).offshore_sites[0] : (a as any).offshore_sites;
    if (site?.name) siteByCrew.set((a as any).crew_id, site.name);
  }

  const rows: VisaRow[] = [];
  const crewWithVisa = new Set<string>();
  for (const d of docs) {
    const crew = crewById.get(d.crew_id);
    if (!crew) continue;
    crewWithVisa.add(d.crew_id);
    const t = d.visa_type_id ? typeById.get(d.visa_type_id) : null;
    const rule = t
      ? { entry_valid_days: t.entry_valid_days ?? null, stay_basis: t.stay_basis, stay_days: t.stay_days ?? null, entry_type: t.entry_type ?? null }
      : null;
    const a = assessVisa(
      {
        status: d.visa_status ?? null,
        issueDate: d.issue_date ?? null,
        expiryDate: d.expiry_date ?? null,
        entryDate: d.entry_date ?? null,
        rule,
        expiryReminderDays: (t?.expiry_reminder_days as number[] | undefined) ?? [],
        entryReminderDays: (t?.entry_reminder_days as number[] | undefined) ?? [],
      },
      today
    );
    // The one date that matters most right now, and what it is.
    let keyLabel = "Expires";
    let keyDate: string | null = d.expiry_date ?? null;
    let keyDays: number | null = a.daysToExpiry;
    if (a.state === "awaiting_entry" || a.state === "enter_soon" || a.state === "entry_missed") {
      keyLabel = "Enter by";
      keyDate = a.entryDeadline;
      keyDays = a.daysToEntryDeadline;
    } else if (rule?.stay_basis === "days_from_entry" && d.entry_date) {
      keyLabel = "Stay until";
      keyDate = a.stayUntil;
      keyDays = a.daysToStayEnd;
    }
    const role = Array.isArray(crew.job_roles) ? crew.job_roles[0] : crew.job_roles;
    rows.push({
      docId: d.id,
      crewId: d.crew_id,
      crewName: crew.full_name,
      roleName: role?.name ?? null,
      siteName: siteByCrew.get(d.crew_id) ?? null,
      employmentStatus: crew.employment_status,
      country: d.visa_country ?? t?.country ?? null,
      visaTypeName: t?.name ?? null,
      documentTypeName: docTypeName.get(d.document_type_id) ?? "Visa",
      documentNumber: d.document_number ?? null,
      recordedStatus: d.visa_status ? VISA_STATUS_LABEL[d.visa_status] ?? d.visa_status : null,
      issueDate: d.issue_date ?? null,
      expiryDate: d.expiry_date ?? null,
      entryDate: d.entry_date ?? null,
      state: a.state,
      severity: a.severity,
      label: a.label,
      detail: a.detail,
      keyLabel,
      keyDate,
      keyDays,
    });
  }

  const noVisa: NoVisaRow[] = (crewRes.data ?? [])
    .filter((c: any) => !crewWithVisa.has(c.id) && c.employment_status !== "inactive" && c.employment_status !== "terminated")
    .map((c: any) => {
      const role = Array.isArray(c.job_roles) ? c.job_roles[0] : c.job_roles;
      return { crewId: c.id, crewName: c.full_name, roleName: role?.name ?? null, siteName: siteByCrew.get(c.id) ?? null };
    });

  return (
    <>
      <p className="text-sm mb-6" style={{ color: "var(--ch-sub)" }}>
        Every visa on record in one place — who has one, what state it is in, and what is due next. Visas are recorded on each person&apos;s
        profile under Documents; visa types and their rules are set in Crew Setup → Visa Types.
      </p>
      <VisaTracker rows={rows} noVisa={noVisa} today={today} noVisaDocType={visaDocTypeIds.length === 0} />
    </>
  );
}
