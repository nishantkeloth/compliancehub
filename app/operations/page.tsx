import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getEffectiveAccess, can } from "@/lib/rbac";
import {
  monthBounds,
  crewCostForMonth,
  containerCostForMonth,
  costBreakdown,
  billingSummary,
  profitability,
  totalsFromLogs,
  billingExportCsv,
  type BillingTerms,
  type DailyLogInput,
} from "@/lib/ops";
import OperationsBoard, { type DailyLog, type CostEntry, type Adjustment, type PeriodInfo } from "./operations-board";

function unwrap<T>(x: T | T[] | null | undefined): T | null {
  if (!x) return null;
  return Array.isArray(x) ? x[0] ?? null : x;
}

export default async function OperationsPage({ searchParams }: { searchParams: Promise<{ project?: string; site?: string; month?: string; tab?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "ops.view") || !access.orgId) redirect("/");
  const orgId = access.orgId;
  const perms = {
    enter: can(access, "ops.enter"),
    verify: can(access, "ops.verify"),
    close: can(access, "ops.close"),
    commercial: can(access, "ops.commercial"),
  };
  const today = new Date().toISOString().slice(0, 10);
  const month = /^\d{4}-\d{2}/.test(sp.month ?? "") ? (sp.month as string).slice(0, 7) : today.slice(0, 7);
  const { start, end, key: monthKey, days: daysInMonth } = monthBounds(month);

  const { data: projects } = await supabase
    .from("projects")
    .select("id, project_code, project_name, status, contract_id, contracts(id, contract_title, contract_code, currency)")
    .eq("org_id", orgId)
    .order("project_name");
  const projectOptions = (projects ?? []).map((p: any) => {
    const c = unwrap<{ id?: string; contract_title?: string; contract_code?: string; currency?: string }>(p.contracts);
    return { id: p.id as string, label: `${p.project_code ?? ""} ${p.project_name}`.trim(), status: p.status as string, contractId: p.contract_id as string, contractLabel: `${c?.contract_code ?? ""} ${c?.contract_title ?? ""}`.trim(), currency: c?.currency ?? null };
  });
  const projectId = projectOptions.some((p) => p.id === sp.project) ? (sp.project as string) : projectOptions.find((p) => p.status === "active")?.id ?? projectOptions[0]?.id ?? null;
  const project = projectOptions.find((p) => p.id === projectId) ?? null;

  if (!project) {
    return (
      <p className="text-sm" style={{ color: "var(--ch-sub)" }}>
        No projects yet — create one under Contracts &amp; Projects first.
      </p>
    );
  }

  const [sitesRes, logsRes, periodRes, costRes, adjRes, termsProjectRes, termsContractRes, profilesRes] = await Promise.all([
    supabase.from("offshore_sites").select("id, name").eq("org_id", orgId).eq("project_id", project.id).order("name"),
    supabase.from("ops_daily_logs").select("*").eq("project_id", project.id).gte("entry_date", start).lte("entry_date", end).order("entry_date"),
    supabase.from("ops_periods").select("*, ops_period_history(old_status, new_status, reason, changed_by, changed_at)").eq("project_id", project.id).eq("period_month", monthKey).maybeSingle(),
    perms.commercial ? supabase.from("ops_cost_entries").select("*").eq("project_id", project.id).gte("cost_date", start).lte("cost_date", end).order("cost_date") : Promise.resolve({ data: [] }),
    perms.commercial ? supabase.from("ops_billing_adjustments").select("*").eq("project_id", project.id).eq("period_month", monthKey).order("created_at") : Promise.resolve({ data: [] }),
    perms.commercial ? supabase.from("billing_terms").select("*").eq("project_id", project.id).maybeSingle() : Promise.resolve({ data: null }),
    perms.commercial ? supabase.from("billing_terms").select("*").eq("contract_id", project.contractId).is("project_id", null).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("profiles").select("id, full_name").eq("org_id", orgId),
  ]);
  const profileName = (id: string | null) => (id ? (profilesRes.data ?? []).find((p) => p.id === id)?.full_name ?? "—" : "—");

  const sites = (sitesRes.data ?? []).map((s: any) => ({ id: s.id as string, name: s.name as string }));
  const siteLabels: Record<string, string> = Object.fromEntries(sites.map((s) => [s.id, s.name]));
  const siteId = sites.some((s) => s.id === sp.site) ? (sp.site as string) : sites[0]?.id ?? null;
  const siteIds = sites.map((s) => s.id);

  const logs: DailyLog[] = (logsRes.data ?? []).map((l: any) => ({
    ...l,
    submitted_by_name: profileName(l.submitted_by),
    verified_by_name: profileName(l.verified_by),
  }));

  // Crew cost: assignments linked to this project, or to one of its vessels.
  let assignmentRows: any[] = [];
  if (perms.commercial) {
    const orFilter = siteIds.length ? `project_id.eq.${project.id},offshore_site_id.in.(${siteIds.join(",")})` : `project_id.eq.${project.id}`;
    const { data } = await supabase
      .from("crew_assignments")
      .select("id, crew_id, start_date, end_date, actual_start_date, actual_end_date, offshore_sites(name), crew_profiles!crew_id(full_name, day_rate, currency, job_roles(name))")
      .eq("org_id", orgId)
      .or(orFilter)
      .lte("start_date", end)
      .or(`end_date.is.null,end_date.gte.${start}`);
    assignmentRows = data ?? [];
  }
  const crewCost = crewCostForMonth(
    assignmentRows.map((a: any) => {
      const crew = unwrap<{ full_name?: string; day_rate?: number | null; currency?: string | null; job_roles?: any }>(a.crew_profiles);
      return {
        id: a.id,
        crew_id: a.crew_id,
        crew_name: crew?.full_name ?? "—",
        role_name: unwrap<{ name?: string }>(crew?.job_roles)?.name ?? null,
        site_name: unwrap<{ name?: string }>(a.offshore_sites)?.name ?? null,
        start_date: a.start_date,
        end_date: a.end_date,
        actual_start_date: a.actual_start_date,
        actual_end_date: a.actual_end_date,
        day_rate: crew?.day_rate ?? null,
        currency: crew?.currency ?? null,
      };
    }),
    month,
    today
  );

  let containerCost = { rows: [] as ReturnType<typeof containerCostForMonth>["rows"], total: 0 };
  if (perms.commercial) {
    const { data: movements } = await supabase
      .from("container_movements")
      .select("id, container_id, status, dispatch_date, return_date, created_at, shipping_cost, customs_port_cost, handling_cost")
      .eq("org_id", orgId)
      .eq("project_id", project.id);
    const containerIds = Array.from(new Set((movements ?? []).map((m: any) => m.container_id)));
    const { data: containers } = containerIds.length ? await supabase.from("containers").select("id, container_code, ownership, rental_rate, rate_basis").in("id", containerIds) : { data: [] };
    containerCost = containerCostForMonth((containers ?? []) as any, (movements ?? []) as any, month, today);
  }

  const costEntries: CostEntry[] = (costRes.data ?? []).map((c: any) => ({
    id: c.id,
    costDate: c.cost_date,
    category: c.category,
    description: c.description,
    amount: Number(c.amount),
    currency: c.currency,
    reference: c.reference,
    siteName: c.offshore_site_id ? siteLabels[c.offshore_site_id] ?? null : null,
    byName: profileName(c.created_by),
  }));
  const costs = costBreakdown(crewCost.total, containerCost.total, costEntries);

  const termsRow = (termsProjectRes.data ?? termsContractRes.data) as (BillingTerms & { id: string; project_id: string | null }) | null;
  const terms: BillingTerms | null = termsRow;
  const adjustments: Adjustment[] = (adjRes.data ?? []).map((a: any) => ({
    id: a.id,
    kind: a.kind,
    description: a.description,
    amount: Number(a.amount),
    currency: a.currency,
    reference: a.reference,
    status: a.status,
    byName: profileName(a.created_by),
    decidedByName: a.decided_by ? profileName(a.decided_by) : null,
  }));

  const logInputs: DailyLogInput[] = logs as unknown as DailyLogInput[];
  const totals = totalsFromLogs(logInputs);
  const billing = billingSummary(terms, logInputs, costs, adjustments, month);
  const profit = profitability(billing, costs, terms, totals);

  const periodRow = periodRes.data as any;
  const period: PeriodInfo = {
    status: periodRow?.status ?? "open",
    closedByName: periodRow?.closed_by ? profileName(periodRow.closed_by) : null,
    closedAt: periodRow?.closed_at ?? null,
    approvedByName: periodRow?.approved_by ? profileName(periodRow.approved_by) : null,
    approvedAt: periodRow?.approved_at ?? null,
    billingReadyAt: periodRow?.billing_ready_at ?? null,
    reopenCount: periodRow?.reopen_count ?? 0,
    history: ((periodRow?.ops_period_history ?? []) as any[])
      .sort((a, b) => String(a.changed_at).localeCompare(String(b.changed_at)))
      .map((h) => ({ from: h.old_status, to: h.new_status, reason: h.reason, byName: profileName(h.changed_by), at: h.changed_at })),
  };

  const exportCsv = perms.commercial
    ? billingExportCsv({ projectLabel: project.label, contractLabel: project.contractLabel, siteLabels, month, periodStatus: period.status, billing, costs, logs: logInputs, adjustments })
    : "";
  const exportJson = perms.commercial
    ? JSON.stringify(
        {
          source: "ComplianceHub",
          project: { id: project.id, label: project.label, contract: project.contractLabel },
          period: { month, status: period.status },
          billing,
          costs,
          totals,
          profitability: profit,
          adjustments,
          dailyLogs: logInputs.map((l) => ({ date: l.entry_date, site: siteLabels[l.offshore_site_id] ?? l.offshore_site_id, status: l.status, clientPob: l.client_pob, crewPob: l.crew_pob, breakfast: l.breakfast_count, lunch: l.lunch_count, dinner: l.dinner_count, night: l.night_meal_count, special: l.special_meals, packed: l.packed_meals })),
        },
        null,
        2
      )
    : "";

  return (
    <OperationsBoard
      projects={projectOptions}
      project={project}
      sites={sites}
      siteId={siteId}
      month={month}
      daysInMonth={daysInMonth}
      today={today}
      logs={logs}
      period={period}
      perms={perms}
      initialTab={sp.tab ?? null}
      totals={totals}
      crewCost={crewCost}
      containerCost={containerCost}
      costEntries={costEntries}
      costs={costs}
      terms={termsRow ? { ...termsRow, isProjectOverride: !!termsRow.project_id } : null}
      billing={billing}
      adjustments={adjustments}
      profit={profit}
      exportCsv={exportCsv}
      exportJson={exportJson}
    />
  );
}
