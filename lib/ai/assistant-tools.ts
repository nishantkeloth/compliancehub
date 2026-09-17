import "server-only";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { computeDocumentStatus } from "@/lib/document-status";
import { can, type EffectiveAccess } from "@/lib/rbac";

// Phase 11 — tool set for the conversational crew/compliance assistant
// (side panel). Every tool is scoped to the caller's own org_id (never
// takes org_id as a model-supplied argument) and caps how many rows it
// hands back to the model, so a broad question can't blow up token usage
// or leak another company's data. Read-only: nothing here writes.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supa = any;

const LIST_CAP = 25;

// Minimal row shapes for the query results this file reads — just enough
// to type the .map()/.filter() callbacks below without pulling in the
// generated Supabase schema types (this app doesn't generate/use one; see
// the loosely-typed Supa client type above).
type NameRel = { name: string } | { name: string }[] | null;
function unwrap<T>(rel: T | T[] | null | undefined): T | null {
  if (rel == null) return null;
  return Array.isArray(rel) ? (rel[0] ?? null) : rel;
}
function relName(rel: NameRel): string | null {
  return unwrap(rel)?.name ?? null;
}
type CrewListRow = {
  id: string;
  full_name: string;
  employee_code: string | null;
  employment_status: string;
  employment_type: string | null;
  deployment_status: string;
  nationality: string | null;
  job_roles: NameRel;
};
type DocTypeRow = { id: string; name: string; category: string | null; warning_threshold_days: number | null };
type CrewForDocsRow = { id: string; full_name: string; primary_job_role_id: string; job_roles: NameRel };
type MatrixRow = {
  matrix_number: string | null;
  title: string;
  status: string;
  total_required_headcount: number;
  expected_pob: number | null;
  offshore_sites: ({ id: string; name: string } | { id: string; name: string }[]) | null;
};
type MobilizationRow = {
  mobilization_number: string | null;
  status: string;
  priority: string;
  required_onboard_date: string;
  offshore_sites: NameRel;
};
type ProjectNameRel = { project_name: string } | { project_name: string }[] | null;
type SiteWithProjectRel = ({ name: string; projects: ProjectNameRel } | { name: string; projects: ProjectNameRel }[]) | null;
type CrewAssignmentSiteRow = { crew_id: string; offshore_sites: SiteWithProjectRel };
type OffshoreSiteRow = { id: string; name: string; code: string | null; site_type: string | null; country: string | null; status: string | null; projects: ProjectNameRel };
type ProjectRow = {
  project_name: string;
  project_code: string | null;
  status: string;
  planned_start_date: string | null;
  planned_end_date: string | null;
  expected_pob: number | null;
  contracts: ({ contract_title: string; clients: NameRel } | { contract_title: string; clients: NameRel }[]) | null;
};
type ContractRow = {
  contract_code: string | null;
  contract_title: string;
  status: string;
  planned_start_date: string | null;
  planned_end_date: string | null;
  estimated_contract_value: number | null;
  currency: string | null;
  clients: NameRel;
};
type CorrectiveActionRow = {
  title: string;
  owner_name: string | null;
  due_date: string | null;
  status: string;
  closed_at: string | null;
  sites: NameRel;
};

// Who's currently assigned to which site (and that site's project), for the
// crew ids given — used to enrich list_crew answers so "which project are
// they on" doesn't need a separate question.
async function crewSiteProjectMap(supabase: Supa, orgId: string, crewIds: string[]): Promise<Map<string, { site: string | null; project: string | null }>> {
  const map = new Map<string, { site: string | null; project: string | null }>();
  if (!crewIds.length) return map;
  const { data } = await supabase
    .from("crew_assignments")
    .select("crew_id, offshore_sites(name, projects(project_name))")
    .eq("org_id", orgId)
    .is("end_date", null)
    .in("crew_id", crewIds);
  for (const row of (data ?? []) as CrewAssignmentSiteRow[]) {
    const site = unwrap(row.offshore_sites);
    const project = site ? unwrap(site.projects) : null;
    map.set(row.crew_id, { site: site?.name ?? null, project: project?.project_name ?? null });
  }
  return map;
}

function ilikeTerm(name: string) {
  return `%${name.trim()}%`;
}

async function resolveJobRoleIds(supabase: Supa, orgId: string, jobRoleName?: string | null): Promise<string[] | null> {
  if (!jobRoleName) return null;
  const { data } = await supabase.from("job_roles").select("id, name").eq("org_id", orgId).ilike("name", ilikeTerm(jobRoleName));
  return (data ?? []).map((r: { id: string }) => r.id);
}

async function resolveSiteIds(supabase: Supa, orgId: string, siteName?: string | null): Promise<string[] | null> {
  if (!siteName) return null;
  const { data } = await supabase.from("offshore_sites").select("id, name").eq("org_id", orgId).ilike("name", ilikeTerm(siteName));
  return (data ?? []).map((r: { id: string }) => r.id);
}

async function assignedCrewIdSet(supabase: Supa, orgId: string, siteIds: string[] | null): Promise<Set<string>> {
  let q = supabase.from("crew_assignments").select("crew_id").eq("org_id", orgId).is("end_date", null);
  if (siteIds) q = q.in("offshore_site_id", siteIds);
  const { data } = await q;
  return new Set((data ?? []).map((r: { crew_id: string }) => r.crew_id));
}

// Every tool is gated behind the same permission the equivalent nav item /
// page already requires (see app/app-shell.tsx) — the assistant only ever
// surfaces data this particular user could already reach by clicking
// around the app, never more. Corrective actions has no gate below because
// its own nav entry (Corrective Actions) is likewise ungated — visible to
// every company member.
export function buildAssistantTools(supabase: Supa, access: EffectiveAccess): ToolSet {
  const orgId = access.orgId as string;
  const tools: ToolSet = {};

  if (can(access, "crew.view")) {
    tools.count_crew = tool({
      description:
        "Count crew profiles, optionally filtered by job role/rank, employment status, employment type, deployment status, and/or offshore site (only counts crew currently assigned there). Use for questions like 'how many Stewards do I have' or 'how many crew are onboard at QATAR Test'. Returns a total plus a breakdown by employment status.",
      inputSchema: z.object({
        job_role_name: z.string().optional().describe("Rank/role name, e.g. 'Steward', 'Cook', 'Camp Boss'. Partial, case-insensitive match."),
        employment_status: z.enum(["active", "candidate", "inactive", "suspended", "terminated"]).optional(),
        employment_type: z.enum(["permanent", "temporary", "subcontractor", "freelancer"]).optional(),
        deployment_status: z.enum(["onshore", "in_transit", "onboard"]).optional(),
        site_name: z.string().optional().describe("Offshore site name — only counts crew currently assigned to a matching site."),
      }),
      execute: async (input) => {
        const jobRoleIds = await resolveJobRoleIds(supabase, orgId, input.job_role_name);
        if (input.job_role_name && jobRoleIds && jobRoleIds.length === 0) {
          return { total: 0, note: `No job role matching "${input.job_role_name}" was found.` };
        }
        const siteIds = await resolveSiteIds(supabase, orgId, input.site_name);
        if (input.site_name && siteIds && siteIds.length === 0) {
          return { total: 0, note: `No offshore site matching "${input.site_name}" was found.` };
        }

        let q = supabase.from("crew_profiles").select("id, employment_status", { count: "exact" }).eq("org_id", orgId);
        if (jobRoleIds) q = q.in("primary_job_role_id", jobRoleIds);
        if (input.employment_status) q = q.eq("employment_status", input.employment_status);
        if (input.employment_type) q = q.eq("employment_type", input.employment_type);
        if (input.deployment_status) q = q.eq("deployment_status", input.deployment_status);
        const { data, count } = await q;

        let rows = data ?? [];
        if (siteIds) {
          const assigned = await assignedCrewIdSet(supabase, orgId, siteIds);
          rows = rows.filter((r: { id: string }) => assigned.has(r.id));
        }
        const total = siteIds ? rows.length : (count ?? rows.length);
        const byStatus: Record<string, number> = {};
        for (const r of rows as { employment_status: string }[]) byStatus[r.employment_status] = (byStatus[r.employment_status] ?? 0) + 1;
        return { total, by_employment_status: byStatus };
      },
    });

    tools.list_crew = tool({
      description:
        `List individual crew members matching filters (job role/rank, employment status, employment type, deployment status, offshore site), including which site and project each is currently assigned to (null if not currently assigned anywhere). Use this — not count_crew — whenever the question needs names, or to answer a follow-up like "which project/site are they on". Returns at most ${LIST_CAP} — if more match, say so and suggest narrowing the question rather than assuming you've seen everyone.`,
      inputSchema: z.object({
        job_role_name: z.string().optional(),
        employment_status: z.enum(["active", "candidate", "inactive", "suspended", "terminated"]).optional(),
        employment_type: z.enum(["permanent", "temporary", "subcontractor", "freelancer"]).optional(),
        deployment_status: z.enum(["onshore", "in_transit", "onboard"]).optional(),
        site_name: z.string().optional(),
      }),
      execute: async (input) => {
        const jobRoleIds = await resolveJobRoleIds(supabase, orgId, input.job_role_name);
        if (input.job_role_name && jobRoleIds && jobRoleIds.length === 0) return { crew: [], note: `No job role matching "${input.job_role_name}" was found.` };
        const siteIds = await resolveSiteIds(supabase, orgId, input.site_name);
        if (input.site_name && siteIds && siteIds.length === 0) return { crew: [], note: `No offshore site matching "${input.site_name}" was found.` };

        let q = supabase
          .from("crew_profiles")
          .select("id, full_name, employee_code, employment_status, employment_type, deployment_status, nationality, job_roles(name)", { count: "exact" })
          .eq("org_id", orgId)
          .order("full_name");
        if (jobRoleIds) q = q.in("primary_job_role_id", jobRoleIds);
        if (input.employment_status) q = q.eq("employment_status", input.employment_status);
        if (input.employment_type) q = q.eq("employment_type", input.employment_type);
        if (input.deployment_status) q = q.eq("deployment_status", input.deployment_status);
        const { data, count } = await q;

        let rows = data ?? [];
        if (siteIds) {
          const assigned = await assignedCrewIdSet(supabase, orgId, siteIds);
          rows = rows.filter((r: { id: string }) => assigned.has(r.id));
        }
        const matched = siteIds ? rows.length : (count ?? rows.length);
        const page = (rows as CrewListRow[]).slice(0, LIST_CAP);
        const siteProject = await crewSiteProjectMap(supabase, orgId, page.map((r) => r.id));
        const crew = page.map((r) => ({
          name: r.full_name,
          employee_code: r.employee_code,
          role: relName(r.job_roles),
          employment_status: r.employment_status,
          employment_type: r.employment_type,
          deployment_status: r.deployment_status,
          nationality: r.nationality,
          site: siteProject.get(r.id)?.site ?? null,
          project: siteProject.get(r.id)?.project ?? null,
        }));
        return { crew, matched_total: matched, truncated: matched > crew.length };
      },
    });
  }

  if (can(access, "crew.documents.view")) {
    tools.document_compliance_status = tool({
      description:
        "Look up crew document/certificate compliance — expired, expiring soon (critical/warning), or missing mandatory documents. Optionally filter by job role/rank and/or document type name (e.g. 'STCW', 'Passport', 'Medical'). Use for questions like 'which crew have expired medical certificates' or 'who is missing mandatory documents'.",
      inputSchema: z.object({
        job_role_name: z.string().optional(),
        document_type_name: z.string().optional().describe("Partial, case-insensitive match against the document type name."),
        status: z.enum(["expired", "critical", "warning", "ok", "none"]).optional().describe("Filter to one status band. Omit to get counts across all bands."),
      }),
      execute: async (input) => {
        const jobRoleIds = await resolveJobRoleIds(supabase, orgId, input.job_role_name);
        if (input.job_role_name && jobRoleIds && jobRoleIds.length === 0) return { note: `No job role matching "${input.job_role_name}" was found.` };

        let docTypeQ = supabase.from("document_types").select("id, name, category, warning_threshold_days").eq("org_id", orgId).eq("is_active", true);
        if (input.document_type_name) docTypeQ = docTypeQ.ilike("name", ilikeTerm(input.document_type_name));
        const { data: docTypes } = await docTypeQ;
        if (input.document_type_name && (!docTypes || docTypes.length === 0)) {
          return { note: `No document type matching "${input.document_type_name}" was found.` };
        }
        const docTypeRows = (docTypes ?? []) as DocTypeRow[];
        const docTypeIds = new Set<string>(docTypeRows.map((d) => d.id));
        const docTypeById = new Map<string, DocTypeRow>(docTypeRows.map((d) => [d.id, d]));

        let crewQ = supabase.from("crew_profiles").select("id, full_name, primary_job_role_id, job_roles(name)").eq("org_id", orgId).eq("employment_status", "active");
        if (jobRoleIds) crewQ = crewQ.in("primary_job_role_id", jobRoleIds);
        const { data: crew } = await crewQ;
        const crewRows = (crew ?? []) as CrewForDocsRow[];
        const crewIds = crewRows.map((c) => c.id);
        const crewById = new Map<string, CrewForDocsRow>(crewRows.map((c) => [c.id, c]));
        if (crewIds.length === 0) return { note: "No matching crew found.", counts: {}, examples: [] };

        const { data: docs } = await supabase
          .from("crew_documents")
          .select("crew_id, document_type_id, expiry_date, created_at")
          .eq("org_id", orgId)
          .in("crew_id", crewIds)
          .order("created_at", { ascending: false });

        // Keep only the most recent record per (crew, document type).
        const latest = new Map<string, { expiry_date: string | null }>();
        for (const d of docs ?? []) {
          const key = `${d.crew_id}:${d.document_type_id}`;
          if (!latest.has(key)) latest.set(key, { expiry_date: d.expiry_date });
        }

        const counts: Record<string, number> = { expired: 0, critical: 0, warning: 0, ok: 0, none: 0, missing: 0 };
        const examples: { name: string; role: string; document_type: string; status: string; expiry_date: string | null }[] = [];
        const relevantDocTypeIds: string[] = input.document_type_name ? Array.from(docTypeIds) : Array.from(docTypeById.keys());

        for (const crewId of crewIds) {
          const c = crewById.get(crewId)!;
          const role = relName(c.job_roles);
          for (const docTypeId of relevantDocTypeIds) {
            const docType = docTypeById.get(docTypeId);
            if (!docType) continue;
            const key = `${crewId}:${docTypeId}`;
            const entry = latest.get(key);
            if (!entry) {
              // No record at all for this doc type. Only surface as "missing"
              // when the caller asked about a specific document type — with
              // no filter, absence of a record is too noisy (most orgs don't
              // track every document type for every rank) to count reliably.
              if (input.document_type_name) {
                counts.missing += 1;
                if ((!input.status || input.status === "expired") && examples.length < LIST_CAP)
                  examples.push({ name: c.full_name, role: role ?? "—", document_type: docType.name, status: "missing", expiry_date: null });
              }
              continue;
            }
            const { status } = computeDocumentStatus(entry.expiry_date, docType.warning_threshold_days, docType.category);
            counts[status] = (counts[status] ?? 0) + 1;
            if ((!input.status || input.status === status) && examples.length < LIST_CAP) {
              examples.push({ name: c.full_name, role: role ?? "—", document_type: docType.name, status, expiry_date: entry.expiry_date });
            }
          }
        }
        return { counts, examples, truncated_examples: examples.length >= LIST_CAP };
      },
    });
  }

  if (can(access, "crew.matrix.view")) {
    tools.matrix_status = tool({
      description:
        "List Crew Matrices (staffing plans per contract/site) with their approval status and staffing (required vs. currently assigned headcount at that site). Use for questions like 'which matrices are still draft' or 'what's the staffing gap on QATAR Test'.",
      inputSchema: z.object({
        status: z.enum(["draft", "pending_internal_approval", "pending_client_approval", "approved", "active", "superseded", "rejected", "cancelled"]).optional(),
        title_contains: z.string().optional().describe("Partial, case-insensitive match against the matrix title or site name."),
      }),
      execute: async (input) => {
        let q = supabase
          .from("crew_matrices")
          .select("id, matrix_number, title, status, total_required_headcount, expected_pob, offshore_sites(id, name)")
          .eq("org_id", orgId)
          .order("created_at", { ascending: false })
          .limit(50);
        if (input.status) q = q.eq("status", input.status);
        const { data } = await q;
        let rows = (data ?? []) as MatrixRow[];
        if (input.title_contains) {
          const term = input.title_contains.toLowerCase();
          rows = rows.filter((r) => r.title?.toLowerCase().includes(term) || relName(r.offshore_sites)?.toLowerCase().includes(term));
        }

        const siteOf = (r: MatrixRow) => (Array.isArray(r.offshore_sites) ? r.offshore_sites[0] : r.offshore_sites);
        const siteIds = Array.from(new Set(rows.map((r) => siteOf(r)?.id).filter((id): id is string => !!id)));
        const assignedCountBySite = new Map<string, number>();
        if (siteIds.length) {
          const { data: assignments } = await supabase.from("crew_assignments").select("offshore_site_id").eq("org_id", orgId).is("end_date", null).in("offshore_site_id", siteIds);
          for (const a of (assignments ?? []) as { offshore_site_id: string }[])
            assignedCountBySite.set(a.offshore_site_id, (assignedCountBySite.get(a.offshore_site_id) ?? 0) + 1);
        }

        const matrices = rows.slice(0, LIST_CAP).map((r) => ({
          matrix_number: r.matrix_number,
          title: r.title,
          status: r.status,
          site: siteOf(r)?.name ?? "—",
          required_headcount: r.total_required_headcount,
          expected_pob: r.expected_pob,
          currently_assigned_at_site: assignedCountBySite.get(siteOf(r)?.id ?? "") ?? 0,
        }));
        return { matrices, matched_total: rows.length, truncated: rows.length > matrices.length };
      },
    });
  }

  if (can(access, "mobilization.view")) {
    tools.mobilization_status = tool({
      description:
        "List Mobilization Requests (crew change / boarding cycles) with their status, priority and required onboard date, plus a breakdown of their positions' readiness (open/selected/ready/boarded etc). Use for questions like 'which mobilizations are pending boarding' or 'what's still open on the next mobilization'.",
      inputSchema: z.object({
        status: z
          .enum([
            "draft", "planning", "compliance_review", "internal_approval", "client_approval",
            "travel_arrangement", "ready_to_mobilize", "in_transit", "completed", "partially_completed", "cancelled",
          ])
          .optional(),
        priority: z.enum(["normal", "urgent", "emergency"]).optional(),
      }),
      execute: async (input) => {
        let q = supabase
          .from("mobilization_requests")
          .select("id, mobilization_number, status, priority, required_onboard_date, offshore_sites(name)")
          .eq("org_id", orgId)
          .order("required_onboard_date", { ascending: true })
          .limit(50);
        if (input.status) q = q.eq("status", input.status);
        if (input.priority) q = q.eq("priority", input.priority);
        const { data: requests } = await q;
        const rows = (requests ?? []) as (MobilizationRow & { id: string })[];
        const requestIds = rows.map((r) => r.id);

        const positionsByRequest = new Map<string, Record<string, number>>();
        if (requestIds.length) {
          const { data: positions } = await supabase.from("mobilization_positions").select("mobilization_request_id, readiness_status").eq("org_id", orgId).in("mobilization_request_id", requestIds);
          for (const p of (positions ?? []) as { mobilization_request_id: string; readiness_status: string }[]) {
            const bucket = positionsByRequest.get(p.mobilization_request_id) ?? {};
            bucket[p.readiness_status] = (bucket[p.readiness_status] ?? 0) + 1;
            positionsByRequest.set(p.mobilization_request_id, bucket);
          }
        }

        const mobilizations = rows.slice(0, LIST_CAP).map((r) => ({
          mobilization_number: r.mobilization_number,
          status: r.status,
          priority: r.priority,
          required_onboard_date: r.required_onboard_date,
          site: relName(r.offshore_sites) ?? "—",
          positions_by_readiness: positionsByRequest.get(r.id) ?? {},
        }));
        return { mobilizations, matched_total: rows.length, truncated: rows.length > mobilizations.length };
      },
    });
  }

  if (can(access, "crew.manage")) {
    tools.list_offshore_sites = tool({
      description:
        "List offshore sites (vessels, rigs, platforms, camps) with their project, status and how many crew are currently assigned there. Use for questions like 'list our sites', 'what sites are on this project', or as a first step before asking about crew/matrices/mobilizations at a specific site.",
      inputSchema: z.object({
        status: z.string().optional().describe("Site status filter, e.g. 'active'. Omit to list all statuses."),
        project_name: z.string().optional().describe("Partial, case-insensitive match against the project name."),
      }),
      execute: async (input) => {
        let q = supabase
          .from("offshore_sites")
          .select("id, name, code, site_type, country, status, projects(project_name)")
          .eq("org_id", orgId)
          .order("name")
          .limit(50);
        if (input.status) q = q.eq("status", input.status);
        const { data } = await q;
        let rows = (data ?? []) as OffshoreSiteRow[];
        if (input.project_name) {
          const term = input.project_name.toLowerCase();
          rows = rows.filter((r) => unwrap(r.projects)?.project_name?.toLowerCase().includes(term));
        }

        const siteIds = rows.map((r) => r.id);
        const assignedCountBySite = new Map<string, number>();
        if (siteIds.length) {
          const { data: assignments } = await supabase.from("crew_assignments").select("offshore_site_id").eq("org_id", orgId).is("end_date", null).in("offshore_site_id", siteIds);
          for (const a of (assignments ?? []) as { offshore_site_id: string }[])
            assignedCountBySite.set(a.offshore_site_id, (assignedCountBySite.get(a.offshore_site_id) ?? 0) + 1);
        }

        const sites = rows.slice(0, LIST_CAP).map((r) => ({
          name: r.name,
          code: r.code,
          site_type: r.site_type,
          country: r.country,
          status: r.status,
          project: unwrap(r.projects)?.project_name ?? "—",
          currently_assigned_crew: assignedCountBySite.get(r.id) ?? 0,
        }));
        return { sites, matched_total: rows.length, truncated: rows.length > sites.length };
      },
    });
  }

  if (can(access, "projects.view")) {
    tools.list_projects = tool({
      description:
        "List projects with their contract, client, status, planned dates and expected POB (persons on board). Use for questions like 'which projects are active' or 'what's the expected POB on this project'.",
      inputSchema: z.object({
        status: z.enum(["planned", "mobilizing", "active", "demobilizing", "completed", "cancelled"]).optional(),
        name_contains: z.string().optional().describe("Partial, case-insensitive match against the project name."),
      }),
      execute: async (input) => {
        let q = supabase
          .from("projects")
          .select("project_name, project_code, status, planned_start_date, planned_end_date, expected_pob, contracts(contract_title, clients(name))")
          .eq("org_id", orgId)
          .order("created_at", { ascending: false })
          .limit(50);
        if (input.status) q = q.eq("status", input.status);
        const { data } = await q;
        let rows = (data ?? []) as ProjectRow[];
        if (input.name_contains) {
          const term = input.name_contains.toLowerCase();
          rows = rows.filter((r) => r.project_name?.toLowerCase().includes(term));
        }

        const projects = rows.slice(0, LIST_CAP).map((r) => {
          const contract = unwrap(r.contracts);
          return {
            project_name: r.project_name,
            project_code: r.project_code,
            status: r.status,
            planned_start_date: r.planned_start_date,
            planned_end_date: r.planned_end_date,
            expected_pob: r.expected_pob,
            contract_title: contract?.contract_title ?? "—",
            client: contract ? (unwrap(contract.clients)?.name ?? "—") : "—",
          };
        });
        return { projects, matched_total: rows.length, truncated: rows.length > projects.length };
      },
    });
  }

  if (can(access, "contracts.view")) {
    tools.list_contracts = tool({
      description:
        "List contracts with their client, status, planned dates and estimated value. Use for questions like 'which contracts are active' or 'what contracts do we have with <client>'.",
      inputSchema: z.object({
        status: z.enum(["draft", "awarded", "mobilizing", "active", "suspended", "completed", "cancelled"]).optional(),
        client_name: z.string().optional().describe("Partial, case-insensitive match against the client name."),
      }),
      execute: async (input) => {
        let q = supabase
          .from("contracts")
          .select("contract_code, contract_title, status, planned_start_date, planned_end_date, estimated_contract_value, currency, clients(name)")
          .eq("org_id", orgId)
          .order("created_at", { ascending: false })
          .limit(50);
        if (input.status) q = q.eq("status", input.status);
        const { data } = await q;
        let rows = (data ?? []) as ContractRow[];
        if (input.client_name) {
          const term = input.client_name.toLowerCase();
          rows = rows.filter((r) => unwrap(r.clients)?.name?.toLowerCase().includes(term));
        }

        const contracts = rows.slice(0, LIST_CAP).map((r) => ({
          contract_code: r.contract_code,
          contract_title: r.contract_title,
          status: r.status,
          client: unwrap(r.clients)?.name ?? "—",
          planned_start_date: r.planned_start_date,
          planned_end_date: r.planned_end_date,
          estimated_value: r.estimated_contract_value,
          currency: r.currency,
        }));
        return { contracts, matched_total: rows.length, truncated: rows.length > contracts.length };
      },
    });
  }

  // Corrective Actions has no permission gate — its nav entry is visible to
  // every company member (see complianceItems in app/app-shell.tsx), so
  // there's no narrower view permission to check here.
  tools.corrective_actions_status = tool({
    description:
      "List HSE corrective actions (tracked failures from inspection checklists) with status, due date, owner and site. Use for questions like 'how many open corrective actions do we have' or 'which actions are overdue'.",
    inputSchema: z.object({
      status: z.enum(["open", "in_progress", "closed"]).optional(),
      overdue_only: z.boolean().optional().describe("Only actions past their due date that are not yet closed."),
      site_name: z.string().optional().describe("Partial, case-insensitive match against the site name."),
    }),
    execute: async (input) => {
      let q = supabase
        .from("corrective_actions")
        .select("title, owner_name, due_date, status, closed_at, sites(name)")
        .eq("org_id", orgId)
        .order("due_date", { ascending: true })
        .limit(50);
      if (input.status) q = q.eq("status", input.status);
      const { data } = await q;
      let rows = (data ?? []) as CorrectiveActionRow[];
      if (input.site_name) {
        const term = input.site_name.toLowerCase();
        rows = rows.filter((r) => relName(r.sites)?.toLowerCase().includes(term));
      }
      const today = new Date().toISOString().slice(0, 10);
      const isOverdue = (r: CorrectiveActionRow) => r.status !== "closed" && !!r.due_date && r.due_date < today;
      if (input.overdue_only) rows = rows.filter(isOverdue);

      const counts = { open: 0, in_progress: 0, closed: 0, overdue: 0 };
      for (const r of rows) {
        if (r.status in counts) counts[r.status as "open" | "in_progress" | "closed"] += 1;
        if (isOverdue(r)) counts.overdue += 1;
      }
      const actions = rows.slice(0, LIST_CAP).map((r) => ({
        title: r.title,
        owner: r.owner_name,
        status: r.status,
        due_date: r.due_date,
        site: relName(r.sites) ?? "—",
        overdue: isOverdue(r),
      }));
      return { counts, actions, matched_total: rows.length, truncated: rows.length > actions.length };
    },
  });

  return tools;
}
