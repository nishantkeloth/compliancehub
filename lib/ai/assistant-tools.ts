import "server-only";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { computeDocumentStatus } from "@/lib/document-status";

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
function relName(rel: NameRel): string | null {
  const row = Array.isArray(rel) ? rel[0] : rel;
  return row?.name ?? null;
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

export function buildAssistantTools(supabase: Supa, orgId: string): ToolSet {
  return {
    count_crew: tool({
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
    }),

    list_crew: tool({
      description:
        `List individual crew members matching filters (job role/rank, employment status, employment type, deployment status, offshore site). Returns at most ${LIST_CAP} — if more match, say so and suggest narrowing the question rather than assuming you've seen everyone.`,
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
        const crew = (rows as CrewListRow[]).slice(0, LIST_CAP).map((r) => ({
          name: r.full_name,
          employee_code: r.employee_code,
          role: relName(r.job_roles),
          employment_status: r.employment_status,
          employment_type: r.employment_type,
          deployment_status: r.deployment_status,
          nationality: r.nationality,
        }));
        return { crew, matched_total: matched, truncated: matched > crew.length };
      },
    }),

    document_compliance_status: tool({
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
    }),

    matrix_status: tool({
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
    }),

    mobilization_status: tool({
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
    }),
  };
}
