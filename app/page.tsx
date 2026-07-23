import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import SignOutButton from "./signout-button";
import StartInspection from "./start-inspection";
import InspectionsPanel from "./inspections-panel";

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

  const { count: openActions } = await supabase
    .from("corrective_actions")
    .select("id", { count: "exact", head: true })
    .in("status", ["open", "in_progress"]);

  return (
    <main className="min-h-screen" style={{ background: "var(--ch-paper)" }}>
      {/* Navy header bar */}
      <div style={{ background: "var(--ch-navy)" }} className="text-white">
        <div className="max-w-4xl mx-auto px-8 py-5 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">
              Compliance<span style={{ color: "#fff", opacity: 0.7 }}>Hub</span>
            </h1>
            <p className="text-sm" style={{ color: "#c7d3de" }}>
              Signed in as {profile?.full_name ?? user.email} · {profile?.role}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/actions"
              className="text-sm font-medium bg-white/10 hover:bg-white/20 rounded-lg px-4 py-2 transition-colors"
            >
              Corrective actions
              {(openActions ?? 0) > 0 && (
                <span className="ml-2 bg-red-600 text-white rounded-full px-2 py-0.5 text-xs">
                  {openActions}
                </span>
              )}
            </Link>
            <SignOutButton />
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-8 py-8">
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

        <InspectionsPanel inspections={inspections ?? []} />
      </div>
    </main>
  );
}
