"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Item = { id: string; prompt: string; maxMarks: number | null };
type Section = { id: string; title: string; items: Item[] };
type Insp = { id: string; code: string; name: string; scoring: string; site: string; orgId: string };

export default function Runner({
  inspection,
  sections,
}: {
  inspection: Insp;
  sections: Section[];
}) {
  const scored = inspection.scoring === "scored";

  const [answers, setAnswers] = useState<Record<string, any>>(() => {
    const a: Record<string, any> = {};
    for (const s of sections)
      for (const it of s.items)
        a[it.id] = scored ? { att: it.maxMarks ?? 0 } : { v: null };
    return a;
  });
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [photos, setPhotos] = useState<Record<string, string[]>>({});
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
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

  const uploadPhoto = async (itemId: string, file: File) => {
    setUploading((u) => ({ ...u, [itemId]: true }));
    setError(null);
    const supabase = createClient();

    const ext = file.name.split(".").pop() || "jpg";
    const path = `${inspection.orgId}/${inspection.id}/${itemId}-${Date.now()}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from("inspection-photos")
      .upload(path, file, { contentType: file.type || "image/jpeg" });

    if (upErr) {
      setError(`Photo upload failed: ${upErr.message}`);
      setUploading((u) => ({ ...u, [itemId]: false }));
      return;
    }

    const { data: pub } = supabase.storage.from("inspection-photos").getPublicUrl(path);
    setPhotos((p) => ({ ...p, [itemId]: [...(p[itemId] ?? []), pub.publicUrl] }));
    setUploading((u) => ({ ...u, [itemId]: false }));
  };

  const removePhoto = (itemId: string, url: string) => {
    setPhotos((p) => ({ ...p, [itemId]: (p[itemId] ?? []).filter((u) => u !== url) }));
    // Not deleting from storage here — harmless orphan object; keeps this simple.
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    const supabase = createClient();

    let pass = 0, fail = 0, na = 0, att = 0;
    const rows = allItems.map((it) => {
      const a = answers[it.id];
      const photoUrls = photos[it.id] ?? [];
      if (scored) {
        att += a.att;
        return {
          inspection_id: inspection.id,
          item_id: it.id,
          marks_attained: a.att,
          note: notes[it.id] || null,
          photo_urls: photoUrls,
        };
      }
      const v = a.v ?? "na";
      if (v === "ok") pass++;
      else if (v === "fail") fail++;
      else na++;
      return {
        inspection_id: inspection.id,
        item_id: it.id,
        result: v,
        note: notes[it.id] || null,
        photo_urls: photoUrls,
      };
    });

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
    <main className="min-h-screen p-4 sm:p-8" style={{ background: "var(--ch-paper)" }}>
      <div className="max-w-3xl mx-auto pb-28">
        <div className="sticky top-0 z-10 pt-2 pb-3 mb-2" style={{ background: "var(--ch-paper)" }}>
          <div
            className="rounded-xl p-4 flex items-center justify-between gap-4 text-white"
            style={{ background: "var(--ch-navy)" }}
          >
            <div>
              <div className="font-bold">
                {inspection.code} — {inspection.name}
              </div>
              <div className="text-sm" style={{ color: "#c7d3de" }}>{inspection.site}</div>
            </div>
            <div className="text-right">
              {scored ? (
                <>
                  <div className="text-xl font-extrabold">
                    {liveAtt}
                    <span style={{ color: "#c7d3de" }} className="text-sm"> /{maxMarks}</span>
                  </div>
                  <div className="text-xs font-semibold" style={{ color: "#c7d3de" }}>
                    {Math.round((liveAtt / maxMarks) * 100)}%
                  </div>
                </>
              ) : (
                <>
                  <div className="text-xl font-extrabold">
                    {answered}
                    <span style={{ color: "#c7d3de" }} className="text-sm"> /{allItems.length}</span>
                  </div>
                  <div className="text-xs font-semibold" style={{ color: "#c7d3de" }}>ANSWERED</div>
                </>
              )}
            </div>
          </div>
        </div>

        {sections.map((s) => (
          <div key={s.id} className="bg-white border rounded-xl mb-4 overflow-hidden" style={{ borderColor: "var(--ch-line)" }}>
            <div className="px-4 py-2 text-sm font-bold tracking-wide text-white" style={{ background: "var(--ch-navy)" }}>
              {s.title}
            </div>
            {s.items.map((it) => {
              const a = answers[it.id];
              const failed = scored ? a.att < (it.maxMarks ?? 0) : a.v === "fail";
              const itemPhotos = photos[it.id] ?? [];
              const isUploading = uploading[it.id];
              return (
                <div
                  key={it.id}
                  className="px-4 py-3 border-t"
                  style={{ borderColor: "var(--ch-line)", background: failed ? "var(--ch-fail-bg)" : "#fff" }}
                >
                  <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
                    <div className="flex-1 text-sm min-w-[200px]" style={{ color: "var(--ch-ink)" }}>{it.prompt}</div>

                    {scored ? (
                      <div className="flex items-center gap-2">
                        <button
                          className="w-8 h-8 rounded-lg border font-bold"
                          style={{ borderColor: "var(--ch-line)" }}
                          onClick={() =>
                            setAnswers({ ...answers, [it.id]: { att: Math.max(0, a.att - 1) } })
                          }
                        >
                          −
                        </button>
                        <span
                          className="font-extrabold text-sm min-w-[44px] text-center"
                          style={{ color: failed ? "var(--ch-fail)" : "var(--ch-pass)" }}
                        >
                          {a.att}
                          <span style={{ color: "var(--ch-sub)" }} className="font-semibold"> /{it.maxMarks}</span>
                        </span>
                        <button
                          className="w-8 h-8 rounded-lg border font-bold"
                          style={{ borderColor: "var(--ch-line)" }}
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
                            className="w-11 py-1.5 rounded-lg border text-xs font-bold"
                            style={
                              a.v === v
                                ? v === "ok"
                                  ? { background: "var(--ch-pass-bg)", borderColor: "var(--ch-pass)", color: "var(--ch-pass)" }
                                  : v === "fail"
                                  ? { background: "var(--ch-fail-bg)", borderColor: "var(--ch-fail)", color: "var(--ch-fail)" }
                                  : { background: "#e5e7eb", borderColor: "#6b7280", color: "#374151" }
                                : { borderColor: "var(--ch-line)", color: "#9ca3af" }
                            }
                          >
                            {v === "ok" ? "✓" : v === "fail" ? "✕" : "N/A"}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {failed && (
                    <div className="mt-2 space-y-2">
                      <input
                        className="w-full border rounded-lg px-3 py-2 text-sm"
                        style={{ borderColor: "var(--ch-line)" }}
                        placeholder="Finding note — what was observed?"
                        value={notes[it.id] || ""}
                        onChange={(e) => setNotes({ ...notes, [it.id]: e.target.value })}
                      />

                      <div className="flex items-center gap-2 flex-wrap">
                        {itemPhotos.map((url) => (
                          <div key={url} className="relative">
                            <img
                              src={url}
                              alt="Finding photo"
                              className="w-16 h-16 object-cover rounded-lg border"
                              style={{ borderColor: "var(--ch-line)" }}
                            />
                            <button
                              onClick={() => removePhoto(it.id, url)}
                              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-white border text-xs font-bold flex items-center justify-center"
                              style={{ borderColor: "var(--ch-fail)", color: "var(--ch-fail)" }}
                              title="Remove photo"
                            >
                              ×
                            </button>
                          </div>
                        ))}

                        <label
                          className="w-16 h-16 rounded-lg border-2 border-dashed flex items-center justify-center text-xs font-semibold cursor-pointer text-center px-1"
                          style={{ borderColor: "var(--ch-navy)", color: "var(--ch-navy)" }}
                        >
                          {isUploading ? "…" : "+ Photo"}
                          <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            className="hidden"
                            disabled={isUploading}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) uploadPhoto(it.id, file);
                              e.target.value = "";
                            }}
                          />
                        </label>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}

        <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-4" style={{ borderColor: "var(--ch-line)" }}>
          <div className="max-w-3xl mx-auto flex items-center gap-3">
            <button
              onClick={submit}
              disabled={busy}
              className="ch-btn-primary rounded-lg px-6 py-3 text-sm font-bold disabled:opacity-50"
            >
              {busy ? "Submitting…" : "Complete inspection"}
            </button>
            {!scored && answered < allItems.length && (
              <span className="text-xs" style={{ color: "var(--ch-sub)" }}>
                {allItems.length - answered} unanswered will be recorded as N/A
              </span>
            )}
            {error && <span className="text-xs" style={{ color: "var(--ch-fail)" }}>{error}</span>}
          </div>
        </div>
      </div>
    </main>
  );
}
