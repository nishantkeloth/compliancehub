import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import StartInspection from "./start-inspection";
import InspectionsPanel from "./inspections-panel";
import AppShell from "./app-shell";

export default async function Home() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role, org_id")
    .eq("id", user.id)
    .single();

  const { data: templates } = await supabase
    .from("templates")
    .select("id, code, name, revision, scoring_type")
    .order("code");

  const { data: inspections } = await supabase
    .from("inspections")
    .select(
      "id, status, score_pct, started_at, submitted_at, template_id, site_id, templates(code, name), sites(name)"
    )
    .order("started_at", { ascending: false })
    .limit(30);

  // Supabase's generated types can't tell these joins return a single row
  // (not an array) for this relationship — normalize so the shape matches
  // what InspectionsPanel expects, and so Vercel's strict production
  // type-check passes (this is more lenient in local `next dev`).
  const normalizedInspections = (inspections ?? []).map((i: any) => ({
    id: i.id,
    status: i.status,
    score_pct: i.score_pct,
    started_at: i.started_at,
    submitted_at: i.submitted_at,
    templates: Array.isArray(i.templates) ? i.templates[0] : i.templates,
    sites: Array.isArray(i.sites) ? i.sites[0] : i.sites,
  }));

  const { count: openActions } = await supabase
    .from("corrective_actions")
    .select("id", { count: "exact", head: true })
    .in("status", ["open", "in_progress"]);

  return (
    <AppShell
      active="dashboard"
      title="Dashboard"
      headerRight={
        <Link
          href="/actions"
          className="text-sm font-medium rounded-lg px-4 py-2 transition-colors"
          style={{ background: "var(--ch-navy-soft)", color: "var(--ch-navy)" }}
        >
          Corrective actions
          {(openActions ?? 0) > 0 && (
            <span className="ml-2 bg-red-600 text-white rounded-full px-2 py-0.5 text-xs">
              {openActions}
            </span>
          )}
        </Link>
      }
    >
      <h2 className="text-sm font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--ch-sub)" }}>
        Templates
      </h2>
      <div className="space-y-3 mb-10">
        {(templates ?? []).map((t) => (
          <div
            key={t.id}
            className="bg-white border rounded-xl p-5 flex items-center justify-between gap-4 flex-wrap"
            style={{ borderColor: "var(--ch-line)" }}
          >
            <div>
              <div className="font-semibold" style={{ color: "var(--ch-ink)" }}>
                {t.name}
              </div>
              <div className="text-sm" style={{ color: "var(--ch-sub)" }}>
                {t.code} · Rev {t.revision} ·{" "}
                <span className="uppercase text-xs font-semibold">{t.scoring_type}</span>
              </div>
            </div>
            <StartInspection templateId={t.id} orgId={profile!.org_id} />
          </div>
        ))}
      </div>

      <InspectionsPanel inspections={normalizedInspections} />
    </AppShell>
  );
}
