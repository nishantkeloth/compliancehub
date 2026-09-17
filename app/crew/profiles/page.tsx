import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getEffectiveAccess, can } from "@/lib/rbac";
import NewCrewForm from "./new-crew-form";
import IntakePanel from "./intake-panel";

const STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
  candidate: { bg: "#f3f4f6", fg: "#6b7280" },
  active: { bg: "var(--ch-pass-bg)", fg: "var(--ch-pass)" },
  inactive: { bg: "#f3f4f6", fg: "#9ca3af" },
  suspended: { bg: "#fef3e2", fg: "#b45309" },
  terminated: { bg: "var(--ch-fail-bg)", fg: "var(--ch-fail)" },
};

export default async function CrewProfilesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const { q, status } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "crew.view")) redirect("/");
  const canManage = can(access, "crew.manage");
  // "Fill from documents" additionally needs crew.matrix.manage — the AI
  // infrastructure's RLS policies are gated on that permission, not
  // crew.manage (see supabase/migrations/0010_ai_crew_intake.sql).
  const canIntake = canManage && can(access, "crew.matrix.manage");

  let query = supabase
    .from("crew_profiles")
    .select("id, employee_code, full_name, employment_status, nationality, availability_date, photo_url, job_roles(name)")
    .eq("org_id", access.orgId)
    .order("full_name");

  if (q?.trim()) {
    query = query.or(`full_name.ilike.%${q.trim()}%,employee_code.ilike.%${q.trim()}%`);
  }
  if (status?.trim()) {
    query = query.eq("employment_status", status.trim());
  }

  const { data: crew } = await query;

  const [jobRolesRes] = await Promise.all([
    supabase.from("job_roles").select("id, name").eq("org_id", access.orgId).eq("is_active", true).order("name"),
  ]);

  return (
    <>
      <p className="text-sm mb-6" style={{ color: "var(--ch-sub)" }}>
        Employee/crew master records. Documents, certifications, and deployment assignments build
        on this and come next.
      </p>

      {canManage && (
        <div className="flex items-start gap-2 flex-wrap">
          <NewCrewForm jobRoles={jobRolesRes.data ?? []} />
          {canIntake && <IntakePanel />}
        </div>
      )}

      <form method="get" className="flex items-center gap-2 flex-wrap mt-5 mb-4">
        <input
          type="text"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search by name or employee code"
          className="border rounded-lg px-3 py-2 text-sm flex-1 min-w-[200px]"
          style={{ borderColor: "var(--ch-line)" }}
        />
        <select
          name="status"
          defaultValue={status ?? ""}
          className="border rounded-lg px-3 py-2 text-sm"
          style={{ borderColor: "var(--ch-line)" }}
        >
          <option value="">All statuses</option>
          <option value="candidate">Candidate</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="suspended">Suspended</option>
          <option value="terminated">Terminated</option>
        </select>
        <button type="submit" className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-line)" }}>
          Filter
        </button>
        {(q || status) && (
          <Link href="/crew/profiles" className="text-xs" style={{ color: "var(--ch-sub)" }}>
            Clear
          </Link>
        )}
      </form>

      <div className="space-y-2">
        {(crew ?? []).length === 0 && (
          <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No crew profiles match.</div>
        )}
        {(crew ?? []).map((c: any) => {
          const role = Array.isArray(c.job_roles) ? c.job_roles[0] : c.job_roles;
          const tone = STATUS_STYLE[c.employment_status] ?? STATUS_STYLE.candidate;
          return (
            <Link
              key={c.id}
              href={`/crew/profiles/${c.id}`}
              className="block bg-white border rounded-xl p-4 hover:shadow-sm transition"
              style={{ borderColor: "var(--ch-line)" }}
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                  {c.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.photo_url} alt="" className="w-9 h-9 rounded-full object-cover border flex-shrink-0" style={{ borderColor: "var(--ch-line)" }} />
                  ) : null}
                  <div>
                    <div className="font-semibold text-sm" style={{ color: "var(--ch-ink)" }}>
                      {c.full_name}
                      {c.employee_code && <span className="text-xs ml-2" style={{ color: "var(--ch-sub)" }}>{c.employee_code}</span>}
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: "var(--ch-sub)" }}>
                      {role?.name ?? "No role set"} {c.nationality ? `· ${c.nationality}` : ""}
                      {c.availability_date ? ` · Available ${c.availability_date}` : ""}
                    </div>
                  </div>
                </div>
                <span
                  className="text-xs font-semibold px-2 py-1 rounded-full uppercase tracking-wide"
                  style={{ background: tone.bg, color: tone.fg }}
                >
                  {c.employment_status}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}
