"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCrewMatrix, generateDraftFromManning } from "../actions";
import { createOffshoreSite } from "@/app/crew/setup/actions";
import AiGenerate from "./ai-generate";

type Project = {
  id: string;
  project_name: string;
  planned_start_date: string | null;
  planned_end_date: string | null;
  expected_pob: number | null;
  country: string | null;
  operating_region: string | null;
};

const SITE_TYPES = ["vessel", "rig", "platform", "barge", "camp", "fpso", "other"];

const inputCls = "border rounded-lg px-3 py-2 text-sm";
const inputStyle = { borderColor: "var(--ch-line)" };
const cardCls = "bg-white border rounded-xl";
const cardStyle = { borderColor: "var(--ch-line)" };

type Mode = "blank" | "generate" | "ai";

// Every mode on this screen creates a brand-new offshore site as part of
// creating the matrix — there's no picking from existing sites here at all.
// Full site management (editing every field, attaching manning
// requirements) happens afterward from the matrix's own Site tab.
export default function NewMatrixForm({ projects, aiVisible }: { projects: Project[]; aiVisible: boolean }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [mode, setMode] = useState<Mode>("blank");
  const defaultProject = projects[0];
  const [projectId, setProjectId] = useState(defaultProject?.id ?? "");
  const [title, setTitle] = useState("");
  const [newSiteName, setNewSiteName] = useState("");
  const [newSiteType, setNewSiteType] = useState("vessel");
  // Silently carried over from the selected project's own Country /
  // Operating region (see onProjectChange) — no longer shown as fields
  // here (a new site's location is almost always the project's own), but
  // still sent through to createOffshoreSite so the site record has it.
  // Editable afterward from the matrix's Site tab.
  const [newSiteCountry, setNewSiteCountry] = useState(defaultProject?.country ?? "");
  const [newSiteRegion, setNewSiteRegion] = useState(defaultProject?.operating_region ?? "");
  // Pre-filled from the selected project's own planned dates / expected POB
  // (see onProjectChange) — still just a starting point, freely editable.
  const [effectiveFrom, setEffectiveFrom] = useState(defaultProject?.planned_start_date ?? "");
  const [effectiveTo, setEffectiveTo] = useState(defaultProject?.planned_end_date ?? "");
  const [expectedPob, setExpectedPob] = useState(defaultProject?.expected_pob?.toString() ?? "");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // AI mode needs a real, already-created site before AiGenerate can mount
  // (it calls the AI + saves the eventual matrix against a real site id) —
  // so AI mode gets one extra step: create the site, then hand off to
  // AiGenerate. Once set, the Project/Site fields above are replaced by
  // AiGenerate's own flow.
  const [aiSiteId, setAiSiteId] = useState<string | null>(null);
  const [aiSiteName, setAiSiteName] = useState("");

  const onProjectChange = (id: string) => {
    setProjectId(id);
    setError(null);
    setAiSiteId(null);
    const project = projects.find((p) => p.id === id);
    setEffectiveFrom(project?.planned_start_date ?? "");
    setEffectiveTo(project?.planned_end_date ?? "");
    setExpectedPob(project?.expected_pob?.toString() ?? "");
    setNewSiteCountry(project?.country ?? "");
    setNewSiteRegion(project?.operating_region ?? "");
  };

  const createSite = async () => {
    const siteFd = new FormData();
    siteFd.set("projectId", projectId);
    siteFd.set("name", newSiteName.trim());
    siteFd.set("siteType", newSiteType);
    siteFd.set("country", newSiteCountry);
    siteFd.set("operatingRegion", newSiteRegion);
    return createOffshoreSite(siteFd);
  };

  const submitBlank = () => {
    if (!projectId || !newSiteName.trim() || !title.trim() || submitting) return;
    setError(null);
    setSubmitting(true);
    startTransition(async () => {
      const siteRes = await createSite();
      if (siteRes?.error || !siteRes?.id) {
        setSubmitting(false);
        setError(siteRes?.error ?? "Could not create the site.");
        return;
      }

      const fd = new FormData();
      fd.set("projectId", projectId);
      fd.set("offshoreSiteId", siteRes.id);
      fd.set("title", title.trim());
      fd.set("effectiveFrom", effectiveFrom);
      fd.set("effectiveTo", effectiveTo);
      fd.set("expectedPob", expectedPob);
      fd.set("notes", notes);
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
    if (!projectId || !newSiteName.trim() || submitting) return;
    setError(null);
    setSubmitting(true);
    startTransition(async () => {
      const siteRes = await createSite();
      if (siteRes?.error || !siteRes?.id) {
        setSubmitting(false);
        setError(siteRes?.error ?? "Could not create the site.");
        return;
      }
      const res = await generateDraftFromManning(projectId, siteRes.id);
      if (res?.error) {
        setSubmitting(false);
        setError(res.error);
        return;
      }
      if (res?.id) router.push(`/crew/matrices/${res.id}`);
    });
  };

  const continueToAi = () => {
    if (!projectId || !newSiteName.trim() || submitting) return;
    setError(null);
    setSubmitting(true);
    startTransition(async () => {
      const siteRes = await createSite();
      setSubmitting(false);
      if (siteRes?.error || !siteRes?.id) {
        setError(siteRes?.error ?? "Could not create the site.");
        return;
      }
      setAiSiteName(newSiteName.trim());
      setAiSiteId(siteRes.id);
    });
  };

  const aiReady = mode === "ai" && aiSiteId;

  return (
    <div className={`${cardCls} p-5 ${mode === "ai" ? "max-w-5xl" : "max-w-2xl"}`} style={cardStyle}>
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
        {aiVisible && (
          <button
            type="button"
            onClick={() => setMode("ai")}
            className="rounded-lg px-4 py-2 text-sm font-semibold border"
            style={mode === "ai" ? { background: "var(--ch-navy-soft)", color: "var(--ch-navy)", borderColor: "var(--ch-navy-soft)" } : { borderColor: "var(--ch-line)", color: "var(--ch-sub)" }}
          >
            ✦ Generate with AI
          </button>
        )}
      </div>

      {error && (
        <div className="text-sm mb-4 rounded-lg px-3 py-2" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>
          {error}
        </div>
      )}

      {!aiReady && (
        <>
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
              Site name
              <input
                className={`${inputCls} w-full mt-1`}
                style={inputStyle}
                placeholder="e.g. MV Ocean Guardian"
                value={newSiteName}
                onChange={(e) => setNewSiteName(e.target.value)}
              />
            </label>
          </div>

          <div className="mb-3">
            <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
              Site type
              <select className={`${inputCls} w-full mt-1 sm:w-1/2`} style={inputStyle} value={newSiteType} onChange={(e) => setNewSiteType(e.target.value)}>
                {SITE_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
            <p className="text-xs mt-1" style={{ color: "var(--ch-sub)" }}>
              A new site is created together with this matrix. Country, operating region, EPC contractor, port,
              crew-change location and other details can be filled in afterward from the matrix&rsquo;s Site tab.
            </p>
          </div>
        </>
      )}

      {mode === "blank" ? (
        <>
          <div className="mb-3">
            <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
              Title
              <input className={`${inputCls} w-full mt-1`} style={inputStyle} placeholder="e.g. MV Ocean Guardian — Crew Matrix" value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 mb-1">
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
          <p className="text-xs mb-3" style={{ color: "var(--ch-sub)" }}>
            Pre-filled from the selected project&rsquo;s planned dates and expected POB — edit any of
            these freely.
          </p>
          <div className="mb-4">
            <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
              Notes
              <textarea className={`${inputCls} w-full mt-1`} style={inputStyle} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
          </div>
          <p className="text-xs mb-4" style={{ color: "var(--ch-sub)" }}>
            You&rsquo;ll add manning lines on the matrix page after saving — a newly created site starts with none.
          </p>
          <button
            onClick={submitBlank}
            disabled={submitting || !projectId || !newSiteName.trim() || !title.trim()}
            className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create draft matrix"}
          </button>
        </>
      ) : mode === "ai" ? (
        aiReady ? (
          <AiGenerate
            key={aiSiteId}
            projectId={projectId}
            offshoreSiteId={aiSiteId as string}
            projectName={projects.find((p) => p.id === projectId)?.project_name ?? ""}
            siteName={aiSiteName}
          />
        ) : (
          <>
            <p className="text-xs mb-4" style={{ color: "var(--ch-sub)" }}>
              Creates the new site first, then the AI proposes roles and headcounts for it from a client document
              or the project context. Nothing is saved as a matrix until you review and accept the proposal.
            </p>
            <button
              onClick={continueToAi}
              disabled={submitting || !projectId || !newSiteName.trim()}
              className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
            >
              {submitting ? "Creating site…" : "Continue"}
            </button>
          </>
        )
      ) : (
        <>
          <p className="text-xs mb-4" style={{ color: "var(--ch-sub)" }}>
            Creates the new site, then a new draft matrix for it. Since the site is brand new it won&rsquo;t have
            any manning requirements yet, so the draft starts with no manning lines — with effective dates and
            expected POB copied from the selected project. Add manning lines on the matrix page afterward, or set
            up this site&rsquo;s manning requirements first (from its Site tab) before generating.
          </p>
          <button
            onClick={submitGenerate}
            disabled={submitting || !projectId || !newSiteName.trim()}
            className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {submitting ? "Generating…" : "Generate draft from manning requirements"}
          </button>
        </>
      )}
    </div>
  );
}
