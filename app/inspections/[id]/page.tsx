import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import Runner from "./runner";
import DuplicateInspection from "./duplicate-button";

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
      "id, status, score_pct, marks_attained, marks_max, count_pass, count_fail, count_na, started_at, submitted_at, template_id, site_id, org_id, templates(code, name, scoring_type), sites(name)"
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
      .select("item_id, result, marks_attained, note, photo_urls")
      .eq("inspection_id", insp.id);

    const respByItem = new Map((responses ?? []).map((r: any) => [r.item_id, r]));
    const scoring = (insp as any).templates?.scoring_type;

    const findings: { section: string; prompt: string; note: string | null; lost?: number; photos: string[] }[] = [];
    for (const s of orderedSections) {
      for (const it of s.template_items) {
        const r = respByItem.get(it.id);
        if (!r) continue;
        if (scoring === "checklist" && r.result === "fail")
          findings.push({ section: s.title, prompt: it.prompt, note: r.note, photos: r.photo_urls ?? [] });
        if (scoring === "scored" && r.marks_attained != null && r.marks_attained < (it.max_marks ?? 0))
          findings.push({ section: s.title, prompt: it.prompt, note: r.note, lost: (it.max_marks ?? 0) - r.marks_attained, photos: r.photo_urls ?? [] });
      }
    }

    const pct = Math.round(insp.score_pct ?? 0);
    const tone =
      pct >= 90
        ? { bg: "var(--ch-pass-bg)", fg: "var(--ch-pass)" }
        : pct >= 75
        ? { bg: "#fef3e2", fg: "#b45309" }
        : { bg: "var(--ch-fail-bg)", fg: "var(--ch-fail)" };

    return (
      <main className="min-h-screen p-8" style={{ background: "var(--ch-paper)" }}>
        <div className="max-w-3xl mx-auto">
          <Link href="/" className="text-sm hover:underline" style={{ color: "var(--ch-navy)" }}>
            ‹ Dashboard
          </Link>

          <div className="bg-white border rounded-xl p-6 mt-4 mb-6 flex items-center gap-6 flex-wrap" style={{ borderColor: "var(--ch-line)" }}>
            <div
              className="w-24 h-24 rounded-full flex items-center justify-center text-2xl font-extrabold"
              style={{ background: tone.bg, color: tone.fg }}
            >
              {pct}%
            </div>
            <div className="flex-1 min-w-[220px]">
              <div className="font-bold text-lg" style={{ color: "var(--ch-ink)" }}>
                {(insp as any).templates?.code} — {(insp as any).templates?.name}
              </div>
              <div className="text-sm" style={{ color: "var(--ch-sub)" }}>
                {(insp as any).sites?.name} · submitted{" "}
                {insp.submitted_at ? new Date(insp.submitted_at).toLocaleString() : ""}
              </div>
              <div className="text-sm mt-2" style={{ color: "var(--ch-ink)" }}>
                {scoring === "scored"
                  ? `${insp.marks_attained} of ${insp.marks_max} marks`
                  : `${insp.count_pass} acceptable · ${insp.count_fail} not acceptable · ${insp.count_na} N/A`}
              </div>
              <div className="mt-3">
                <DuplicateInspection
                  templateId={insp.template_id}
                  siteId={insp.site_id}
                  orgId={insp.org_id}
                />
              </div>
            </div>
          </div>

          <div className="bg-white border rounded-xl p-6" style={{ borderColor: "var(--ch-line)" }}>
            <div className="font-semibold mb-3" style={{ color: "var(--ch-ink)" }}>
              Findings ({findings.length})
            </div>
            {findings.length === 0 ? (
              <div className="text-sm font-medium" style={{ color: "var(--ch-pass)" }}>
                Clean inspection — no findings. ✓
              </div>
            ) : (
              <>
                <div className="divide-y" style={{ borderColor: "var(--ch-line)" }}>
                  {findings.map((f, i) => (
                    <div key={i} className="py-3">
                      <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--ch-sub)" }}>
                        {f.section}
                        {f.lost ? ` · −${f.lost} mark${f.lost > 1 ? "s" : ""}` : ""}
                      </div>
                      <div className="text-sm font-medium" style={{ color: "var(--ch-ink)" }}>{f.prompt}</div>
                      {f.note && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>Note: {f.note}</div>}
                      {f.photos.length > 0 && (
                        <div className="flex gap-2 mt-2 flex-wrap">
                          {f.photos.map((url) => (
                            <a key={url} href={url} target="_blank" rel="noopener noreferrer">
                              <img
                                src={url}
                                alt="Finding photo"
                                className="w-20 h-20 object-cover rounded-lg border"
                                style={{ borderColor: "var(--ch-line)" }}
                              />
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <Link href="/actions" className="inline-block mt-4 ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold">
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
        orgId: insp.org_id,
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
