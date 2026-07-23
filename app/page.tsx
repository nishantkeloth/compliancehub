import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import SignOutButton from "./signout-button";
import StartInspection from "./start-inspection";

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
    .select("id, status, score_pct, started_at, submitted_at, templates(code, name), sites(name)")
    .order("started_at", { ascending: false })
    .limit(8);

  const { count: openActions } = await supabase
    .from("corrective_actions")
    .select("id", { count: "exact", head: true })
    .in("status", ["open", "in_progress"]);

  return (
    <main className="min-h-screen bg-neutral-100 p-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-xl font-bold text-neutral-900">
              Compliance<span className="text-amber-500">Hub</span>
            </h1>
            <p className="text-sm text-neutral-500">
              Signed in as {profile?.full_name ?? user.email} · {profile?.role}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/actions"
              className="text-sm font-medium text-neutral-700 border border-neutral-300 rounded-lg px-4 py-2 hover:bg-white"
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

        <h2 className="text-sm font-semibold text-neutral-500 uppercase tracking-wide mb-3">
          Templates
        </h2>
        <div className="space-y-3 mb-10">
          {(templates ?? []).map((t) => (
            <div
              key={t.id}
              className="bg-white border border-neutral-200 rounded-xl p-5 flex items-center justify-between gap-4 flex-wrap"
            >
              <div>
                <div className="font-semibold text-neutral-900">{t.name}</div>
                <div className="text-sm text-neutral-500">
                  {t.code} · Rev {t.revision} ·{" "}
                  <span className="uppercase text-xs font-semibold">{t.scoring_type}</span>
                </div>
              </div>
              <StartInspection templateId={t.id} orgId={profile!.org_id} />
            </div>
          ))}
        </div>

        <h2 className="text-sm font-semibold text-neutral-500 uppercase tracking-wide mb-3">
          Recent inspections
        </h2>
        {!inspections || inspections.length === 0 ? (
          <div className="bg-white border border-neutral-200 rounded-xl p-6 text-sm text-neutral-500">
            No inspections yet — start one from a template above.
          </div>
        ) : (
          <div className="space-y-2">
            {inspections.map((i: any) => (
              <Link
                key={i.id}
                href={`/inspections/${i.id}`}
                className="bg-white border border-neutral-200 rounded-xl p-4 flex items-center justify-between gap-3 hover:border-amber-400 transition-colors block"
              >
                <div>
                  <div className="font-medium text-neutral-900 text-sm">
                    {i.templates?.code} — {i.sites?.name}
                  </div>
                  <div className="text-xs text-neutral-500">
                    {new Date(i.started_at).toLocaleString()}
                  </div>
                </div>
                {i.status === "in_progress" ? (
                  <span className="text-xs font-semibold uppercase bg-amber-100 text-amber-800 rounded-full px-3 py-1">
                    In progress
                  </span>
                ) : (
                  <span
                    className={`text-xs font-bold rounded-full px-3 py-1 ${
                      (i.score_pct ?? 0) >= 90
                        ? "bg-green-100 text-green-800"
                        : (i.score_pct ?? 0) >= 75
                        ? "bg-amber-100 text-amber-800"
                        : "bg-red-100 text-red-800"
                    }`}
                  >
                    {Math.round(i.score_pct ?? 0)}%
                  </span>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
