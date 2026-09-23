"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCrewMatrix, generateDraftFromManning } from "../actions";
import { createOffshoreSite, copyManningRequirements } from "@/app/crew/setup/actions";
import { COUNTRIES } from "@/lib/countries";
import { REGIONS } from "@/lib/regions";
import AiGenerate from "./ai-generate";

type Project = {
  id: string;
  project_name: string;
  planned_start_date: string | null;
  planned_end_date: string | null;
  expected_pob: number | null;
};
type Site = { id: string; name: string; project_id: string | null };

const SITE_TYPES = ["vessel", "rig", "platform", "barge", "camp", "fpso", "other"];

const inputCls = "border rounded-lg px-3 py-2 text-sm";
const inputStyle = { borderColor: "var(--ch-line)" };
const cardCls = "bg-white border rounded-xl";
const cardStyle = { borderColor: "var(--ch-line)" };

type Mode = "blank" | "generate" | "ai";

export default function NewMatrixForm({ projects, sites: initialSites, aiVisible }: { projects: Project[]; sites: Site[]; aiVisible: boolean }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [mode, setMode] = useState<Mode>("blank");
  const defaultProject = projects[0];
  const [projectId, setProjectId] = useState(defaultProject?.id ?? "");
  const [offshoreSiteId, setOffshoreSiteId] = useState("");
  const [title, setTitle] = useState("");
  // Sites created inline below (via "+ New site") are appended here so the
  // dropdown picks them up immediately — no full page reload needed just to
  // create the site a matrix is going to be built for.
  const [sites, setSites] = useState<Site[]>(initialSites);
  const [addingSite, setAddingSite] = useState(false);
  const [newSiteName, setNewSiteName] = useState("");
  const [newSiteType, setNewSiteType] = useState("vessel");
  const [newSiteCountry, setNewSiteCountry] = useState("");
  const [newSiteRegion, setNewSiteRegion] = useState("");
  const [copyFromSiteId, setCopyFromSiteId] = useState("");
  const [siteSubmitting, setSiteSubmitting] = useState(false);
  const [siteError, setSiteError] = useState<string | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  // Pre-filled from the selected project's own planned dates / expected POB
  // (see onProjectChange) — still just a starting point, freely editable.
  const [effectiveFrom, setEffectiveFrom] = useState(defaultProject?.planned_start_date ?? "");
  const [effectiveTo, setEffectiveTo] = useState(defaultProject?.planned_end_date ?? "");
  const [expectedPob, setExpectedPob] = useState(defaultProject?.expected_pob?.toString() ?? "");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eligibleSites = useMemo(() => sites.filter((s) => s.project_id === projectId), [sites, projectId]);

  const onProjectChange = (id: string) => {
    setProjectId(id);
    setOffshoreSiteId("");
    setAddingSite(false);
    setSiteError(null);
    setCopyNotice(null);
    const project = projects.find((p) => p.id === id);
    setEffectiveFrom(project?.planned_start_date ?? "");
    setEffectiveTo(project?.planned_end_date ?? "");
    setExpectedPob(project?.expected_pob?.toString() ?? "");
  };

  const submitNewSite = () => {
    if (!projectId || !newSiteName.trim() || siteSubmitting) return;
    setSiteError(null);
    setCopyNotice(null);
    setSiteSubmitting(true);
    const fd = new FormData();
    fd.set("projectId", projectId);
    fd.set("name", newSiteName.trim());
    fd.set("siteType", newSiteType);
    fd.set("country", newSiteCountry);
    fd.set("operatingRegion", newSiteRegion);
    startTransition(async () => {
      const res = await createOffshoreSite(fd);
      if (res?.error) {
        setSiteSubmitting(false);
        setSiteError(res.error);
        return;
      }
      const newId = res?.id;
      if (newId) {
        setSites((cur) => [...cur, { id: newId, name: newSiteName.trim(), project_id: projectId }]);
        setOffshoreSiteId(newId);

        if (copyFromSiteId) {
          const copyRes = await copyManningRequirements(copyFromSiteId, newId);
          if (copyRes?.error) {
            setCopyNotice(`Site created, but couldn't copy roles: ${copyRes.error}`);
          } else if (copyRes?.copied) {
            const fromName = sites.find((s) => s.id === copyFromSiteId)?.name ?? "that site";
            setCopyNotice(`Copied ${copyRes.copied} role${copyRes.copied === 1 ? "" : "s"} from ${fromName} — use "Generate from manning requirements" below to pull them in as matrix lines.`);
          } else {
            setCopyNotice("Site created — the site you copied from has no roles set up yet, so none were copied.");
          }
        }
      }
      setSiteSubmitting(false);
      setAddingSite(false);
      setNewSiteName("");
      setNewSiteType("vessel");
      setNewSiteCountry("");
      setNewSiteRegion("");
      setCopyFromSiteId("");
    });
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
          {projectId && eligibleSites.length === 0 && !addingSite && (
            <span className="block mt-1" style={{ color: "var(--ch-sub)" }}>This project has no offshore sites yet.</span>
          )}
          {projectId && !addingSite && (
            <button type="button" onClick={() => setAddingSite(true)} className="block mt-1 text-xs font-semibold ch-link-navy">
              + New site
            </button>
          )}
        </label>
      </div>

      {addingSite && (
        <div className="rounded-lg border p-3 mb-3" style={{ borderColor: "var(--ch-line)", background: "var(--ch-paper)" }}>
          <div className="text-xs font-semibold mb-2" style={{ color: "var(--ch-navy)" }}>New offshore site</div>
          {siteError && (
            <div className="text-xs mb-2 rounded-lg px-2.5 py-1.5" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>{siteError}</div>
          )}
          <div className="grid gap-2 sm:grid-cols-2 mb-2">
            <input
              className={`${inputCls} w-full`}
              style={inputStyle}
              placeholder="Site name, e.g. MV Ocean Guardian"
              value={newSiteName}
              onChange={(e) => setNewSiteName(e.target.value)}
              autoFocus
            />
            <select className={`${inputCls} w-full`} style={inputStyle} value={newSiteType} onChange={(e) => setNewSiteType(e.target.value)}>
              {SITE_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 mb-2">
            <select className={`${inputCls} w-full`} style={inputStyle} value={newSiteCountry} onChange={(e) => setNewSiteCountry(e.target.value)}>
              <option value="">Country…</option>
              {COUNTRIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <select className={`${inputCls} w-full`} style={inputStyle} value={newSiteRegion} onChange={(e) => setNewSiteRegion(e.target.value)}>
              <option value="">Operating region…</option>
              {REGIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <label className="text-xs block mb-2" style={{ color: "var(--ch-sub)" }}>
            Copy roles from an existing site (optional)
            <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={copyFromSiteId} onChange={(e) => setCopyFromSiteId(e.target.value)}>
              <option value="">Don&rsquo;t copy — start with no roles</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
          <p className="text-xs mb-2" style={{ color: "var(--ch-sub)" }}>
            Setting the operating region now is what lets Staffing Plan tell &ldquo;available&rdquo; crew
            from &ldquo;other location&rdquo; ones later — you can also add it afterward from Offshore Sites.
            If this is a sister vessel to one you already run, pick it above to copy its manning
            requirements (roles + headcounts) across, so this matrix doesn&rsquo;t start from zero.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={submitNewSite}
              disabled={siteSubmitting || !newSiteName.trim()}
              className="ch-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
            >
              {siteSubmitting ? "Creating…" : "Create site"}
            </button>
            <button
              type="button"
              onClick={() => {
                setAddingSite(false);
                setSiteError(null);
                setCopyFromSiteId("");
              }}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold border"
              style={{ borderColor: "var(--ch-line)" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {copyNotice && (
        <div className="text-xs mb-3 rounded-lg px-3 py-2" style={{ background: "var(--ch-navy-soft)", color: "var(--ch-navy)" }}>
          {copyNotice}
        </div>
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
            If the selected site already has manning requirements, its roles and headcounts are
            copied in as starting lines — otherwise you&rsquo;ll add lines on the matrix page after
            saving. Either way, you can add, edit, or remove lines afterward.
          </p>
          <button
            onClick={submitBlank}
            disabled={submitting || !projectId || !offshoreSiteId || !title.trim()}
            className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create draft matrix"}
          </button>
        </>
      ) : mode === "ai" ? (
        <AiGenerate
          key={`${projectId}-${offshoreSiteId}`}
          projectId={projectId}
          offshoreSiteId={offshoreSiteId}
          projectName={projects.find((p) => p.id === projectId)?.project_name ?? ""}
          siteName={sites.find((s) => s.id === offshoreSiteId)?.name ?? ""}
        />
      ) : (
        <>
          <p className="text-xs mb-4" style={{ color: "var(--ch-sub)" }}>
            Creates a new draft matrix, pre-filled with one line per role currently defined in this
            site&rsquo;s manning requirements, and with effective dates and expected POB copied from
            the selected project. You can edit, add, or remove lines afterward — nothing here changes
            the existing manning requirements.
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
