import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import Runner from "./runner";

export default async function InspectionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: insp } = await supabase
    .from("inspections")
    .select(
      "id, status, score_pct, marks_attained, marks_max, count_pass, count_fail, count_na, started_at, submitted_at, template_id, templates(code, name, scoring_type), sites(name)"
    )
    .eq("id", id)
    .single();
  if (!insp) notFound();

  const { data: sections } = await supabase
    .from("template_sections")
    .select("id, title, sort_order, template_items(id, prompt, sort_order, max_marks, response_type)")
    .eq("template_id", insp.template_id)
    .order("sort_order");

  const orderedSections = (sections ?? [])
    .sort((a: any, b: any) => a.sort_order - b.sort_order)
    .map((s: any) => ({
      ...s,
      template_items: [...s.template_items].sort(
        (a: any, b: any) => a.sort_order - b.sort_order
      ),
    }));

  /* ---------- Submitted: read-only summary ---------- */
  if (insp.status !== "in_progress") {
    const { data: responses } = await supabase
      .from("inspection_responses")
      .select("item_id, result, marks_attained, note")
      .eq("inspection_id", insp.id);

    const respByItem = new Map((responses ?? []).map((r: any) => [r.item_id, r]));
    const scoring = (insp as any).templates?.scoring_type;

    const findings: { section: string; prompt: string; note: string | null; lost?: number }[] = [];
    for (const s of orderedSections) {
      for (const it of s.template_items) {
        const r = respByItem.get(it.id);
        if (!r) continue;
        if (scoring === "checklist" && r.result === "fail")
          findings.push({ section: s.title, prompt: it.prompt, note: r.note });
        if (scoring === "scored" && r.marks_attained != null && r.marks_attained < (it.max_marks ?? 0))
          findings.push({ section: s.title, prompt: it.prompt, note: r.note, lost: (it.max_marks ?? 0) - r.marks_attained });
      }
    }

    const pct = Math.round(insp.score_pct ?? 0);
    return (
      <main className="min-h-screen bg-neutral-100 p-8">
        <div className="max-w-3xl mx-auto">
          <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900">
            ‹ Dashboard
          </Link>
          <div className="bg-white border border-neutral-200 rounded-xl p-6 mt-4 mb-6 flex items-center gap-6 flex-wrap">
            <div
              className={`w-24 h-24 rounded-full flex items-center justify-center text-2xl font-extrabold ${
                pct >= 90
                  ? "bg-green-100 text-green-800"
                  : pct >= 75
                  ? "bg-amber-100 text-amber-800"
                  : "bg-red-100 text-red-800"
              }`}
            >
              {pct}%
            </div>
            <div>
              <div className="font-bold text-lg text-neutral-900">
                {(insp as any).templates?.code} — {(insp as any).templates?.name}
              </div>
              <div className="text-sm text-neutral-500">
                {(insp as any).sites?.name} · submitted{" "}
                {insp.submitted_at ? new Date(insp.submitted_at).toLocaleString() : ""}
              </div>
              <div className="text-sm text-neutral-700 mt-2">
                {scoring === "scored"
                  ? `${insp.marks_attained} of ${insp.marks_max} marks`
                  : `${insp.count_pass} acceptable · ${insp.count_fail} not acceptable · ${insp.count_na} N/A`}
              </div>
            </div>
          </div>

          <div className="bg-white border border-neutral-200 rounded-xl p-6">
            <div className="font-semibold text-neutral-900 mb-3">
              Findings ({findings.length})
            </div>
            {findings.length === 0 ? (
              <div className="text-sm text-green-700 font-medium">
                Clean inspection — no findings. ✓
              </div>
            ) : (
              <>
                <div className="divide-y divide-neutral-100">
                  {findings.map((f, i) => (
                    <div key={i} className="py-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                        {f.section}
                        {f.lost ? ` · −${f.lost} mark${f.lost > 1 ? "s" : ""}` : ""}
                      </div>
                      <div className="text-sm font-medium text-neutral-900">{f.prompt}</div>
                      {f.note && <div className="text-sm text-neutral-500">Note: {f.note}</div>}
                    </div>
                  ))}
                </div>
                <Link
                  href="/actions"
                  className="inline-block mt-4 bg-neutral-900 text-white rounded-lg px-4 py-2 text-sm font-semibold"
                >
                  View corrective actions →
                </Link>
              </>
            )}
          </div>
        </div>
      </main>
    );
  }

  /* ---------- In progress: interactive runner ---------- */
  return (
    <Runner
      inspection={{
        id: insp.id,
        code: (insp as any).templates?.code,
        name: (insp as any).templates?.name,
        scoring: (insp as any).templates?.scoring_type,
        site: (insp as any).sites?.name,
      }}
      sections={orderedSections.map((s: any) => ({
        id: s.id,
        title: s.title,
        items: s.template_items.map((it: any) => ({
          id: it.id,
          prompt: it.prompt,
          maxMarks: it.max_marks,
        })),
      }))}
    />
  );
}
