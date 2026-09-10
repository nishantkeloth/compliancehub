"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCrewMatrix, generateDraftFromManning } from "../actions";

type Project = { id: string; project_name: string };
type Site = { id: string; name: string; project_id: string | null };

const inputCls = "border rounded-lg px-3 py-2 text-sm";
const inputStyle = { borderColor: "var(--ch-line)" };
const cardCls = "bg-white border rounded-xl";
const cardStyle = { borderColor: "var(--ch-line)" };

type Mode = "blank" | "generate";

export default function NewMatrixForm({ projects, sites }: { projects: Project[]; sites: Site[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [mode, setMode] = useState<Mode>("blank");
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [offshoreSiteId, setOffshoreSiteId] = useState("");
  const [title, setTitle] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveTo, setEffectiveTo] = useState("");
  const [expectedPob, setExpectedPob] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eligibleSites = useMemo(() => sites.filter((s) => s.project_id === projectId), [sites, projectId]);

  const onProjectChange = (id: string) => {
    setProjectId(id);
    setOffshoreSiteId("");
  };

  const submitBlank = () => {
    if (!projectId || !offshoreSiteId || !title.trim() || submitting) return;
    setError(null);
    setSubmitting(true);
    const fd = new FormData();
    fd.set("projectId", projectId);
    fd.set("offshoreSiteId", offshoreSiteId);
    fd.set("title", title.trim());
    fd.set("effectiveFrom", effectiveFrom);
    fd.set("effectiveTo", effectiveTo);
    fd.set("expectedPob", expectedPob);
    fd.set("notes", notes);
    startTransition(async () => {
      const res = await createCrewMatrix(fd);
      if (res?.error) {
        setSubmitting(false);
        setError(res.error);
        return;
      }
      if (res?.id) router.push(`/crew/matrices/${res.id}`);
    });
  };

  const submitGenerate = () => {
    if (!projectId || !offshoreSiteId || submitting) return;
    setError(null);
    setSubmitting(true);
    startTransition(async () => {
      const res = await generateDraftFromManning(projectId, offshoreSiteId);
      if (res?.error) {
        setSubmitting(false);
        setError(res.error);
        return;
      }
      if (res?.id) router.push(`/crew/matrices/${res.id}`);
    });
  };

  return (
    <div className={`${cardCls} p-5 max-w-2xl`} style={cardStyle}>
      <div className="flex gap-2 mb-5">
        <button
          type="button"
          onClick={() => setMode("blank")}
          className="rounded-lg px-4 py-2 text-sm font-semibold border"
          style={mode === "blank" ? { background: "var(--ch-navy-soft)", color: "var(--ch-navy)", borderColor: "var(--ch-navy-soft)" } : { borderColor: "var(--ch-line)", color: "var(--ch-sub)" }}
        >
          Blank draft
        </button>
        <button
          type="button"
          onClick={() => setMode("generate")}
          className="rounded-lg px-4 py-2 text-sm font-semibold border"
          style={mode === "generate" ? { background: "var(--ch-navy-soft)", color: "var(--ch-navy)", borderColor: "var(--ch-navy-soft)" } : { borderColor: "var(--ch-line)", color: "var(--ch-sub)" }}
        >
          Generate from manning requirements
        </button>
      </div>

      {error && (
        <div className="text-sm mb-4 rounded-lg px-3 py-2" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>
          {error}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 mb-3">
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Project
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={projectId} onChange={(e) => onProjectChange(e.target.value)}>
            {projects.length === 0 && <option value="">No projects yet</option>}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.project_name}</option>
            ))}
          </select>
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Offshore site
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={offshoreSiteId} onChange={(e) => setOffshoreSiteId(e.target.value)}>
            <option value="">Select a site…</option>
            {eligibleSites.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          {projectId && eligibleSites.length === 0 && (
            <span className="block mt-1" style={{ color: "var(--ch-sub)" }}>This project has no offshore sites yet.</span>
          )}
        </label>
      </div>

      {mode === "blank" ? (
        <>
          <div className="mb-3">
            <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
              Title
              <input className={`${inputCls} w-full mt-1`} style={inputStyle} placeholder="e.g. MV Ocean Guardian — Crew Matrix" value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 mb-3">
            <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
              Effective from
              <input type="date" className={`${inputCls} w-full mt-1`} style={inputStyle} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
            </label>
            <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
              Effective to
              <input type="date" className={`${inputCls} w-full mt-1`} style={inputStyle} value={effectiveTo} onChange={(e) => setEffectiveTo(e.target.value)} />
            </label>
            <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
              Expected POB
              <input type="number" min="0" className={`${inputCls} w-full mt-1`} style={inputStyle} value={expectedPob} onChange={(e) => setExpectedPob(e.target.value)} />
            </label>
          </div>
          <div className="mb-4">
            <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
              Notes
              <textarea className={`${inputCls} w-full mt-1`} style={inputStyle} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
          </div>
          <p className="text-xs mb-4" style={{ color: "var(--ch-sub)" }}>
            You&rsquo;ll add roles, headcounts, and requirements on the matrix page after saving.
          </p>
          <button
            onClick={submitBlank}
            disabled={submitting || !projectId || !offshoreSiteId || !title.trim()}
            className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create draft matrix"}
          </button>
        </>
      ) : (
        <>
          <p className="text-xs mb-4" style={{ color: "var(--ch-sub)" }}>
            Creates a new draft matrix, pre-filled with one line per role currently defined in this
            site&rsquo;s manning requirements. You can edit, add, or remove lines afterward — nothing
            here changes the existing manning requirements.
          </p>
          <button
            onClick={submitGenerate}
            disabled={submitting || !projectId || !offshoreSiteId}
            className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {submitting ? "Generating…" : "Generate draft from manning requirements"}
          </button>
        </>
      )}
    </div>
  );
}
