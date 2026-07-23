"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Item = { id: string; prompt: string; maxMarks: number | null };
type Section = { id: string; title: string; items: Item[] };
type Insp = { id: string; code: string; name: string; scoring: string; site: string };

export default function Runner({
  inspection,
  sections,
}: {
  inspection: Insp;
  sections: Section[];
}) {
  const scored = inspection.scoring === "scored";

  // answers: itemId -> { v: 'ok'|'fail'|'na'|null } or { att: number }
  const [answers, setAnswers] = useState<Record<string, any>>(() => {
    const a: Record<string, any> = {};
    for (const s of sections)
      for (const it of s.items)
        a[it.id] = scored ? { att: it.maxMarks ?? 0 } : { v: null };
    return a;
  });
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allItems = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const maxMarks = useMemo(
    () => allItems.reduce((n, it) => n + (it.maxMarks ?? 0), 0),
    [allItems]
  );

  const liveAtt = scored
    ? allItems.reduce((n, it) => n + (answers[it.id]?.att ?? 0), 0)
    : 0;
  const answered = scored
    ? allItems.length
    : allItems.filter((it) => answers[it.id]?.v !== null).length;

  const submit = async () => {
    setBusy(true);
    setError(null);
    const supabase = createClient();

    let pass = 0, fail = 0, na = 0, att = 0;
    const rows = allItems.map((it) => {
      const a = answers[it.id];
      if (scored) {
        att += a.att;
        return {
          inspection_id: inspection.id,
          item_id: it.id,
          marks_attained: a.att,
          note: notes[it.id] || null,
        };
      }
      const v = a.v ?? "na"; // unanswered counts as N/A
      if (v === "ok") pass++;
      else if (v === "fail") fail++;
      else na++;
      return {
        inspection_id: inspection.id,
        item_id: it.id,
        result: v,
        note: notes[it.id] || null,
      };
    });

    // Insert responses — the DB trigger auto-creates corrective actions
    const { error: rErr } = await supabase.from("inspection_responses").insert(rows);
    if (rErr) {
      setError(rErr.message);
      setBusy(false);
      return;
    }

    const score = scored
      ? (att / maxMarks) * 100
      : pass + fail === 0
      ? 100
      : (pass / (pass + fail)) * 100;

    const { error: uErr } = await supabase
      .from("inspections")
      .update({
        status: "submitted",
        submitted_at: new Date().toISOString(),
        score_pct: Math.round(score * 100) / 100,
        marks_attained: scored ? att : null,
        marks_max: scored ? maxMarks : null,
        count_pass: pass,
        count_fail: fail,
        count_na: na,
      })
      .eq("id", inspection.id);
    if (uErr) {
      setError(uErr.message);
      setBusy(false);
      return;
    }

    window.location.href = `/inspections/${inspection.id}`;
  };

  return (
    <main className="min-h-screen bg-neutral-100 p-4 sm:p-8">
      <div className="max-w-3xl mx-auto pb-28">
        {/* Sticky header */}
        <div className="sticky top-0 z-10 bg-neutral-100 pt-2 pb-3 mb-2">
          <div className="bg-white border border-neutral-200 rounded-xl p-4 flex items-center justify-between gap-4">
            <div>
              <div className="font-bold text-neutral-900">
                {inspection.code} — {inspection.name}
              </div>
              <div className="text-sm text-neutral-500">{inspection.site}</div>
            </div>
            <div className="text-right">
              {scored ? (
                <>
                  <div className="text-xl font-extrabold text-neutral-900">
                    {liveAtt}
                    <span className="text-neutral-400 text-sm"> /{maxMarks}</span>
                  </div>
                  <div className="text-xs text-neutral-500 font-semibold">
                    {Math.round((liveAtt / maxMarks) * 100)}%
                  </div>
                </>
              ) : (
                <>
                  <div className="text-xl font-extrabold text-neutral-900">
                    {answered}
                    <span className="text-neutral-400 text-sm"> /{allItems.length}</span>
                  </div>
                  <div className="text-xs text-neutral-500 font-semibold">ANSWERED</div>
                </>
              )}
            </div>
          </div>
        </div>

        {sections.map((s) => (
          <div key={s.id} className="bg-white border border-neutral-200 rounded-xl mb-4 overflow-hidden">
            <div className="bg-neutral-900 text-white px-4 py-2 text-sm font-bold tracking-wide">
              {s.title}
            </div>
            {s.items.map((it) => {
              const a = answers[it.id];
              const failed = scored ? a.att < (it.maxMarks ?? 0) : a.v === "fail";
              return (
                <div
                  key={it.id}
                  className={`px-4 py-3 border-t border-neutral-100 ${failed ? "bg-red-50/60" : ""}`}
                >
                  <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
                    <div className="flex-1 text-sm text-neutral-800 min-w-[200px]">{it.prompt}</div>

                    {scored ? (
                      <div className="flex items-center gap-2">
                        <button
                          className="w-8 h-8 rounded-lg border border-neutral-300 font-bold hover:border-amber-400"
                          onClick={() =>
                            setAnswers({ ...answers, [it.id]: { att: Math.max(0, a.att - 1) } })
                          }
                        >
                          −
                        </button>
                        <span
                          className={`font-extrabold text-sm min-w-[44px] text-center ${
                            failed ? "text-red-700" : "text-green-700"
                          }`}
                        >
                          {a.att}
                          <span className="text-neutral-400 font-semibold"> /{it.maxMarks}</span>
                        </span>
                        <button
                          className="w-8 h-8 rounded-lg border border-neutral-300 font-bold hover:border-amber-400"
                          onClick={() =>
                            setAnswers({
                              ...answers,
                              [it.id]: { att: Math.min(it.maxMarks ?? 0, a.att + 1) },
                            })
                          }
                        >
                          +
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-1.5">
                        {(["ok", "fail", "na"] as const).map((v) => (
                          <button
                            key={v}
                            onClick={() =>
                              setAnswers({
                                ...answers,
                                [it.id]: { v: a.v === v ? null : v },
                              })
                            }
                            className={`w-11 py-1.5 rounded-lg border text-xs font-bold ${
                              a.v === v
                                ? v === "ok"
                                  ? "bg-green-100 border-green-600 text-green-700"
                                  : v === "fail"
                                  ? "bg-red-100 border-red-600 text-red-700"
                                  : "bg-neutral-200 border-neutral-500 text-neutral-600"
                                : "border-neutral-300 text-neutral-400 hover:border-neutral-400"
                            }`}
                          >
                            {v === "ok" ? "✓" : v === "fail" ? "✕" : "N/A"}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {failed && (
                    <input
                      className="mt-2 w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
                      placeholder="Finding note — what was observed?"
                      value={notes[it.id] || ""}
                      onChange={(e) => setNotes({ ...notes, [it.id]: e.target.value })}
                    />
                  )}
                </div>
              );
            })}
          </div>
        ))}

        {/* Submit bar */}
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-neutral-200 p-4">
          <div className="max-w-3xl mx-auto flex items-center gap-3">
            <button
              onClick={submit}
              disabled={busy}
              className="bg-neutral-900 text-white rounded-lg px-6 py-3 text-sm font-bold disabled:opacity-50"
            >
              {busy ? "Submitting…" : "Complete inspection"}
            </button>
            {!scored && answered < allItems.length && (
              <span className="text-xs text-neutral-500">
                {allItems.length - answered} unanswered will be recorded as N/A
              </span>
            )}
            {error && <span className="text-xs text-red-600">{error}</span>}
          </div>
        </div>
      </div>
    </main>
  );
}
