import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getEffectiveAccess, can } from "@/lib/rbac";
import { loadPositionContext, evaluateCandidateReadiness, evaluateCandidatesReadiness, CHECK_DESCRIPTIONS, type OverallOutcome } from "@/lib/readiness";

const TERMINAL_STATUSES = ["completed", "partially_completed", "cancelled"];

const OUTCOME_LABELS: Record<OverallOutcome, string> = {
  ready: "Ready",
  ready_with_warning: "Ready (warnings)",
  overridden: "Ready (waived)",
  not_ready: "Blocked",
};
const OUTCOME_COLORS: Record<OverallOutcome, { bg: string; fg: string }> = {
  ready: { bg: "var(--ch-pass-bg)", fg: "var(--ch-pass)" },
  ready_with_warning: { bg: "#fef3e2", fg: "#b45309" },
  overridden: { bg: "var(--ch-navy-soft)", fg: "var(--ch-navy)" },
  not_ready: { bg: "var(--ch-fail-bg)", fg: "var(--ch-fail)" },
};

function unwrap<T>(x: T | T[] | null | undefined): T | null {
  if (!x) return null;
  return Array.isArray(x) ? x[0] ?? null : x;
}

export default async function ReadinessDashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "mobilization.view") || !access.orgId) redirect("/");
  const orgId = access.orgId;

  const { data: allRequests } = await supabase.from("mobilization_requests").select("id, mobilization_number, status").eq("org_id", orgId);
  const requests = (allRequests ?? []).filter((r) => !TERMINAL_STATUSES.includes(r.status));
  const requestById = new Map(requests.map((r) => [r.id, r]));
  const requestIds = requests.map((r) => r.id);

  const { data: positions } = requestIds.length
    ? await supabase
        .from("mobilization_positions")
        .select(
          "id, mobilization_request_id, job_role_id, crew_matrix_line_id, selected_crew_id, final_status, job_roles(name), selected_crew:crew_profiles!selected_crew_id(full_name, employee_code)"
        )
        .in("mobilization_request_id", requestIds)
    : { data: [] };

  const selectedPositions = (positions ?? []).filter((p) => p.selected_crew_id);
  const openPositions = (positions ?? []).filter((p) => !p.selected_crew_id && p.final_status === "pending");

  type Bucket = { positionId: string; mobilizationNumber: string | null; jobRoleName: string; crewName: string; failing: string[] };
  const buckets: Record<OverallOutcome, Bucket[]> = { ready: [], ready_with_warning: [], overridden: [], not_ready: [] };
  const missingDocuments: Bucket[] = [];
  const expiringBeforeRotation: Bucket[] = [];

  for (const p of selectedPositions) {
    const ctx = await loadPositionContext(supabase, orgId, p.id);
    if ("error" in ctx) continue;
    const evaluation = await evaluateCandidateReadiness(supabase, ctx, p.selected_crew_id as string);
    if ("error" in evaluation) continue;

    const jobRole = unwrap<{ name?: string }>(p.job_roles);
    const crew = unwrap<{ full_name?: string; employee_code?: string }>(p.selected_crew);
    const req = requestById.get(p.mobilization_request_id);
    const failing = evaluation.checks.filter((c) => c.result === "fail" || c.result === "warning").map((c) => c.description);
    const entry: Bucket = {
      positionId: p.id,
      mobilizationNumber: req?.mobilization_number ?? null,
      jobRoleName: jobRole?.name ?? "—",
      crewName: crew?.full_name ?? "—",
      failing,
    };
    buckets[evaluation.overallOutcome].push(entry);

    const docsCheck = evaluation.checks.find((c) => c.code === "REQUIRED_DOCUMENTS");
    if (docsCheck && (docsCheck.result === "fail" || docsCheck.result === "warning")) missingDocuments.push(entry);
    const rotationCheck = evaluation.checks.find((c) => c.code === "DOC_EXPIRY_VS_ROTATION");
    if (rotationCheck && (rotationCheck.result === "fail" || rotationCheck.result === "warning")) expiringBeforeRotation.push(entry);
  }

  // Positions without eligible candidates — same primary+secondary role
  // pool construction as listCandidates (app/mobilizations/actions.ts),
  // evaluated in bulk per position.
  const noCandidates: { positionId: string; mobilizationNumber: string | null; jobRoleName: string }[] = [];
  for (const p of openPositions) {
    const ctx = await loadPositionContext(supabase, orgId, p.id);
    if ("error" in ctx) continue;
    const [primaryRes, secondaryLinkRes] = await Promise.all([
      supabase.from("crew_profiles").select("id").eq("org_id", orgId).eq("employment_status", "active").eq("primary_job_role_id", ctx.jobRoleId),
      supabase.from("crew_secondary_roles").select("crew_id").eq("job_role_id", ctx.jobRoleId),
    ]);
    const primaryIds = (primaryRes.data ?? []).map((c) => c.id as string);
    const secondaryIds = (secondaryLinkRes.data ?? []).map((r) => r.crew_id as string).filter((id) => !primaryIds.includes(id));
    const poolIds = [...primaryIds, ...secondaryIds];
    const jobRole = unwrap<{ name?: string }>(p.job_roles);
    if (poolIds.length === 0) {
      noCandidates.push({ positionId: p.id, mobilizationNumber: requestById.get(p.mobilization_request_id)?.mobilization_number ?? null, jobRoleName: jobRole?.name ?? "—" });
      continue;
    }
    const evaluations = await evaluateCandidatesReadiness(supabase, ctx, poolIds);
    const anyViable = Object.values(evaluations).some((e) => e.overallOutcome !== "not_ready");
    if (!anyViable) {
      noCandidates.push({ positionId: p.id, mobilizationNumber: requestById.get(p.mobilization_request_id)?.mobilization_number ?? null, jobRoleName: jobRole?.name ?? "—" });
    }
  }

  const { data: pendingWaiversRaw } = await supabase
    .from("compliance_waivers")
    .select(
      "id, check_code, justification, requested_at, mobilization_position_id, crew_id, mobilization_positions(mobilization_request_id, job_roles(name)), crew_profiles(full_name)"
    )
    .eq("org_id", orgId)
    .eq("status", "pending")
    .order("requested_at", { ascending: false });
  const pendingWaivers = (pendingWaiversRaw ?? []).map((w: any) => {
    const position = unwrap<{ mobilization_request_id?: string; job_roles?: any }>(w.mobilization_positions);
    const jobRole = unwrap<{ name?: string }>(position?.job_roles);
    const crew = unwrap<{ full_name?: string }>(w.crew_profiles);
    return {
      id: w.id,
      checkCode: w.check_code,
      justification: w.justification,
      requestedAt: w.requested_at,
      requestId: position?.mobilization_request_id ?? null,
      mobilizationNumber: position?.mobilization_request_id ? requestById.get(position.mobilization_request_id)?.mobilization_number ?? null : null,
      jobRoleName: jobRole?.name ?? "—",
      crewName: crew?.full_name ?? "—",
      positionId: w.mobilization_position_id,
    };
  });

  return (
    <div className="space-y-6">
      <p className="text-sm" style={{ color: "var(--ch-sub)" }}>
        Live readiness across every selected candidate on an active mobilization — recomputed on
        each visit from current documents, skills, and assignments (not the historical snapshots
        recorded at each workflow trigger point, which never change).
      </p>

      <div className="grid gap-3 sm:grid-cols-4">
        {(Object.keys(OUTCOME_LABELS) as OverallOutcome[]).map((k) => (
          <div key={k} className="bg-white border rounded-xl p-4" style={{ borderColor: "var(--ch-line)" }}>
            <div className="text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: OUTCOME_COLORS[k].fg }}>{OUTCOME_LABELS[k]}</div>
            <div className="text-2xl font-bold" style={{ color: "var(--ch-ink)" }}>{buckets[k].length}</div>
          </div>
        ))}
      </div>

      <Section title="Blocked crew" rows={buckets.not_ready} emptyText="Nothing is blocked right now." />
      <Section title="Crew with warnings" rows={buckets.ready_with_warning} emptyText="No warnings." />
      <Section title="Ready crew (waived)" rows={buckets.overridden} emptyText="No positions ready via waiver." />
      <Section title="Missing / expired documents (as of onboard date)" rows={missingDocuments} emptyText="No missing documents." />
      <Section title="Documents expiring before rotation completion" rows={expiringBeforeRotation} emptyText="Nothing expires mid-rotation." />

      <div className="bg-white border rounded-xl p-4" style={{ borderColor: "var(--ch-line)" }}>
        <div className="text-sm font-bold mb-2" style={{ color: "var(--ch-ink)" }}>Pending compliance waivers</div>
        {pendingWaivers.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No pending waiver requests.</div>}
        <div className="space-y-2">
          {pendingWaivers.map((w) => (
            <Link key={w.id} href={w.requestId ? `/mobilizations/${w.requestId}` : "/mobilizations"} className="block text-sm border rounded-lg px-3 py-2 hover:bg-gray-50" style={{ borderColor: "var(--ch-line)" }}>
              <span className="font-semibold" style={{ color: "var(--ch-ink)" }}>{w.crewName}</span>{" "}
              <span style={{ color: "var(--ch-sub)" }}>
                — {w.jobRoleName} on {w.mobilizationNumber ?? "—"} · {CHECK_DESCRIPTIONS[w.checkCode as keyof typeof CHECK_DESCRIPTIONS] ?? w.checkCode}
              </span>
              <div className="text-xs mt-0.5" style={{ color: "var(--ch-sub)" }}>{w.justification}</div>
            </Link>
          ))}
        </div>
      </div>

      <div className="bg-white border rounded-xl p-4" style={{ borderColor: "var(--ch-line)" }}>
        <div className="text-sm font-bold mb-2" style={{ color: "var(--ch-ink)" }}>Positions without an eligible candidate</div>
        {noCandidates.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>Every open position has at least one viable candidate.</div>}
        <div className="space-y-1.5">
          {noCandidates.map((n) => (
            <div key={n.positionId} className="text-sm border rounded-lg px-3 py-2" style={{ borderColor: "var(--ch-line)" }}>
              <span className="font-semibold" style={{ color: "var(--ch-ink)" }}>{n.jobRoleName}</span>{" "}
              <span style={{ color: "var(--ch-sub)" }}>on {n.mobilizationNumber ?? "—"}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Section({ title, rows, emptyText }: { title: string; rows: { positionId: string; mobilizationNumber: string | null; jobRoleName: string; crewName: string; failing: string[] }[]; emptyText: string }) {
  return (
    <div className="bg-white border rounded-xl p-4" style={{ borderColor: "var(--ch-line)" }}>
      <div className="text-sm font-bold mb-2" style={{ color: "var(--ch-ink)" }}>{title}</div>
      {rows.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>{emptyText}</div>}
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.positionId} className="text-sm border rounded-lg px-3 py-2" style={{ borderColor: "var(--ch-line)" }}>
            <span className="font-semibold" style={{ color: "var(--ch-ink)" }}>{r.crewName}</span>{" "}
            <span style={{ color: "var(--ch-sub)" }}>— {r.jobRoleName} on {r.mobilizationNumber ?? "—"}</span>
            {r.failing.length > 0 && <div className="text-xs mt-1" style={{ color: "var(--ch-sub)" }}>{r.failing.join(" ")}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
