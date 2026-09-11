"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { aiAvailability, generateMatrixDraft, saveGeneratedMatrix, discardGeneration, type MappedProposal, type MappedLine } from "../ai-actions";

const inputCls = "border rounded-lg px-3 py-2 text-sm";
const inputStyle = { borderColor: "var(--ch-line)" };
const cardCls = "bg-white border rounded-xl";
const cardStyle = { borderColor: "var(--ch-line)" };
const lbl = "text-xs";
const lblStyle = { color: "var(--ch-sub)" };

function pill(text: string, bg: string, fg: string) {
  return <span className="text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5 whitespace-nowrap" style={{ background: bg, color: fg }}>{text}</span>;
}
function confidencePill(c: number) {
  const pct = Math.round(c * 100);
  return pill(`${pct}%`, c >= 0.8 ? "var(--ch-pass-bg)" : c >= 0.5 ? "#fef3e2" : "var(--ch-fail-bg)", c >= 0.8 ? "var(--ch-pass)" : c >= 0.5 ? "#b45309" : "var(--ch-fail)");
}

// Editable state per line: keeps the model's names alongside the chosen
// master-data ids (or "create" decisions).
type EditLine = {
  key: number;
  jobRoleName: string;
  jobRoleId: string | null;
  createJobRole: boolean;
  method: string;
  required_headcount: number;
  day: string;
  night: string;
  other: string;
  rotationName: string | null;
  rotationId: string | null;
  employment_type_preference: string;
  nationality_preference: string;
  language_requirement: string;
  minimum_experience_years: string;
  mobilization_lead_days: string;
  client_approval_required: boolean;
  remarks: string;
  documents: { name: string; id: string | null; create: boolean; method: string; is_mandatory: boolean; waiver_permitted: boolean; minimum_remaining_validity_days: string }[];
  skills: { name: string; id: string | null; create: boolean; method: string }[];
  competencies: { name: string; minimum_grade: string | null }[];
  client_requirements: { text: string; is_mandatory: boolean }[];
  confidence: number;
  source_excerpt: string | null;
  norm_applied: string | null;
};

function toEdit(l: MappedLine, i: number): EditLine {
  return {
    key: i,
    jobRoleName: l.job_role.name,
    jobRoleId: l.job_role.targetId,
    createJobRole: false,
    method: l.job_role.method,
    required_headcount: l.required_headcount,
    day: l.day_shift_quantity != null ? String(l.day_shift_quantity) : "",
    night: l.night_shift_quantity != null ? String(l.night_shift_quantity) : "",
    other: l.other_shift_quantity != null ? String(l.other_shift_quantity) : "",
    rotationName: l.rotation?.name ?? null,
    rotationId: l.rotation?.targetId ?? null,
    employment_type_preference: l.employment_type_preference ?? "",
    nationality_preference: l.nationality_preference ?? "",
    language_requirement: l.language_requirement ?? "",
    minimum_experience_years: l.minimum_experience_years != null ? String(l.minimum_experience_years) : "",
    mobilization_lead_days: l.mobilization_lead_days != null ? String(l.mobilization_lead_days) : "",
    client_approval_required: l.client_approval_required,
    remarks: l.remarks ?? "",
    documents: l.documents.map((d) => ({ name: d.name, id: d.mapping.targetId, create: false, method: d.mapping.method, is_mandatory: d.is_mandatory, waiver_permitted: d.waiver_permitted, minimum_remaining_validity_days: d.minimum_remaining_validity_days != null ? String(d.minimum_remaining_validity_days) : "" })),
    skills: l.skills.map((s) => ({ name: s.name, id: s.targetId, create: false, method: s.method })),
    competencies: l.competencies,
    client_requirements: l.client_requirements,
    confidence: l.confidence,
    source_excerpt: l.source_excerpt,
    norm_applied: l.norm_applied,
  };
}

export default function AiGenerate({ projectId, offshoreSiteId, projectName, siteName }: { projectId: string; offshoreSiteId: string; projectName: string; siteName: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [availability, setAvailability] = useState<{ enabled: boolean; reason: string | null; maxUploadMb: number; documentCapable: boolean } | null>(null);
  const [mode, setMode] = useState<"document" | "context">("document");
  const [file, setFile] = useState<File | null>(null);
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<{ model: string; outcome: string }[]>([]);
  const [proposal, setProposal] = useState<MappedProposal | null>(null);
  const [lines, setLines] = useState<EditLine[]>([]);
  const [title, setTitle] = useState("");
  const [expectedPob, setExpectedPob] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveTo, setEffectiveTo] = useState("");
  const [notes, setNotes] = useState("");
  const [resolved, setResolved] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    aiAvailability().then(setAvailability).catch((e) => setAvailability({ enabled: false, reason: e instanceof Error ? e.message : String(e), maxUploadMb: 20, documentCapable: false }));
  }, []);

  const generate = () => {
    if (!projectId || !offshoreSiteId) return;
    setBusy(true);
    setError(null);
    setAttempts([]);
    const fd = new FormData();
    fd.set("mode", mode);
    fd.set("projectId", projectId);
    fd.set("offshoreSiteId", offshoreSiteId);
    fd.set("pastedText", pasted);
    if (file) fd.set("file", file);
    startTransition(async () => {
      const res = await generateMatrixDraft(fd);
      setBusy(false);
      if ("error" in res) {
        setError(res.error);
        setAttempts(res.attempts ?? []);
        return;
      }
      setProposal(res.proposal);
      setLines(res.proposal.lines.map(toEdit));
      setTitle(res.proposal.title ?? `${siteName} — Crew Matrix`);
      setExpectedPob(res.proposal.expected_pob != null ? String(res.proposal.expected_pob) : "");
      setResolved({});
      setExpanded(null);
    });
  };

  const unmapped = lines.flatMap((l) => [
    ...(!l.jobRoleId && !l.createJobRole ? [`Line ${l.key + 1}: job role "${l.jobRoleName}"`] : []),
    ...l.documents.filter((d) => !d.id && !d.create).map((d) => `Line ${l.key + 1}: document "${d.name}"`),
    ...l.skills.filter((s) => !s.id && !s.create).map((s) => `Line ${l.key + 1}: skill "${s.name}"`),
  ]);
  const openItems = proposal ? [...proposal.assumptions.map((a, i) => ({ k: `a${i}`, text: a, kind: "assumption" })), ...proposal.open_questions.map((q, i) => ({ k: `q${i}`, text: q, kind: "question" }))] : [];
  const unresolved = openItems.filter((o) => !resolved[o.k]).length;
  const canSave = !!proposal && !!title.trim() && lines.length > 0 && unmapped.length === 0 && unresolved === 0 && !busy;

  const save = () => {
    if (!proposal || !canSave) return;
    setBusy(true);
    setError(null);
    const payload = {
      title: title.trim(),
      effectiveFrom: effectiveFrom || null,
      effectiveTo: effectiveTo || null,
      expectedPob: expectedPob ? Number(expectedPob) : null,
      notes: notes || null,
      lines: lines.map((l) => ({
        job_role_id: l.createJobRole ? null : l.jobRoleId,
        new_job_role_name: l.createJobRole ? l.jobRoleName : null,
        job_role_alias: l.jobRoleId && l.method !== "exact" && !l.createJobRole ? l.jobRoleName : null,
        required_headcount: l.required_headcount,
        day_shift_quantity: l.day ? Number(l.day) : null,
        night_shift_quantity: l.night ? Number(l.night) : null,
        other_shift_quantity: l.other ? Number(l.other) : null,
        rotation_template_id: l.rotationId,
        employment_type_preference: l.employment_type_preference || null,
        nationality_preference: l.nationality_preference || null,
        language_requirement: l.language_requirement || null,
        minimum_experience_years: l.minimum_experience_years ? Number(l.minimum_experience_years) : null,
        mobilization_lead_days: l.mobilization_lead_days ? Number(l.mobilization_lead_days) : null,
        client_approval_required: l.client_approval_required,
        remarks: l.remarks || null,
        documents: l.documents.map((d) => ({ document_type_id: d.create ? null : d.id, new_name: d.create ? d.name : null, alias: d.id && d.method !== "exact" && !d.create ? d.name : null, is_mandatory: d.is_mandatory, waiver_permitted: d.waiver_permitted, minimum_remaining_validity_days: d.minimum_remaining_validity_days ? Number(d.minimum_remaining_validity_days) : null })),
        skills: l.skills.map((s) => ({ skill_id: s.create ? null : s.id, new_name: s.create ? s.name : null, alias: s.id && s.method !== "exact" && !s.create ? s.name : null })),
        competencies: l.competencies,
        client_requirements: l.client_requirements,
      })),
    };
    startTransition(async () => {
      const res = await saveGeneratedMatrix(proposal.generationId, JSON.stringify(payload));
      setBusy(false);
      if (res?.error) {
        setError(res.error);
        return;
      }
      if (res?.id) router.push(`/crew/matrices/${res.id}`);
    });
  };

  const discard = () => {
    if (proposal) discardGeneration(proposal.generationId);
    setProposal(null);
    setLines([]);
  };

  const update = (key: number, patch: Partial<EditLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  if (availability && !availability.enabled) {
    return (
      <div className="text-sm rounded-lg px-3 py-2" style={{ background: "#fef3e2", color: "#b45309" }}>
        {availability.reason} <Link href="/team/ai" className="font-semibold underline">Open AI Settings</Link>
      </div>
    );
  }

  if (!proposal) {
    return (
      <div>
        <div className="flex items-center gap-3 flex-wrap mb-3 text-xs" style={{ color: "var(--ch-ink)" }}>
          <label className="flex items-center gap-1"><input type="radio" checked={mode === "document"} onChange={() => setMode("document")} /> From a client manning document</label>
          <label className="flex items-center gap-1"><input type="radio" checked={mode === "context"} onChange={() => setMode("context")} /> From project context (services, POB, norms, history)</label>
        </div>
        {mode === "document" && (
          <div className="space-y-2 mb-3">
            <label className={lbl} style={lblStyle}>
              Upload document (PDF, Word, Excel, image or text{availability ? `, up to ${availability.maxUploadMb} MB` : ""})
              <input type="file" accept=".pdf,.docx,.xlsx,.xls,.csv,.txt,.md,.png,.jpg,.jpeg" className={`${inputCls} w-full mt-1`} style={inputStyle} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
            {availability && !availability.documentCapable && file && /\.(png|jpe?g)$/i.test(file.name) && (
              <div className="text-xs" style={{ color: "#b45309" }}>No configured model accepts images — a scanned document will fail; paste the text instead or enable a document-capable model.</div>
            )}
            <label className={lbl} style={lblStyle}>
              …or paste the requirement text
              <textarea className={`${inputCls} w-full mt-1`} style={inputStyle} rows={5} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Paste the manning requirement / scope of work here" />
            </label>
          </div>
        )}
        {mode === "context" && (
          <p className="text-xs mb-3" style={{ color: "var(--ch-sub)" }}>
            The AI will propose roles and headcounts for <b>{siteName}</b> on <b>{projectName}</b> from the contract services, expected POB, the company&rsquo;s catering norms and previously approved matrices. Every number shows which norm produced it.
          </p>
        )}
        {error && <div className="text-sm mb-3 rounded-lg px-3 py-2" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>{error}</div>}
        {attempts.length > 0 && <div className="text-xs mb-3" style={{ color: "var(--ch-sub)" }}>{attempts.map((a) => `${a.model}: ${a.outcome}`).join(" · ")}</div>}
        <button onClick={generate} disabled={busy || !projectId || !offshoreSiteId || (mode === "document" && !file && !pasted.trim()) || !availability} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
          {busy ? "Generating… (this can take up to a minute)" : "Generate draft with AI"}
        </button>
        <p className="text-[11px] mt-3" style={{ color: "var(--ch-sub)" }}>
          The result is a proposal you review before anything is saved. It is created as a normal draft matrix and goes through the usual approval.
        </p>
      </div>
    );
  }

  const md = proposal.masterData;
  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap mb-3">
        {pill("AI proposal", "var(--ch-navy-soft)", "var(--ch-navy)")}
        <span className="text-xs" style={{ color: "var(--ch-sub)" }}>Answered by {proposal.modelLabel}{proposal.attempts.length > 1 ? ` · ${proposal.attempts.slice(0, -1).map((a) => `${a.model}: ${a.outcome}`).join("; ")}` : ""}</span>
        <button onClick={discard} className="ml-auto text-xs font-semibold" style={{ color: "var(--ch-sub)" }}>Discard &amp; start over</button>
      </div>
      {error && <div className="text-sm mb-3 rounded-lg px-3 py-2" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>{error}</div>}

      {openItems.length > 0 && (
        <div className="border rounded-lg p-3 mb-3" style={{ borderColor: "var(--ch-line)", background: "#fffaf0" }}>
          <div className="text-xs font-bold mb-1.5" style={{ color: "#b45309" }}>Assumptions &amp; open questions — tick each once reviewed ({unresolved} left)</div>
          {openItems.map((o) => (
            <label key={o.k} className="flex items-start gap-2 text-xs py-0.5" style={{ color: "var(--ch-ink)" }}>
              <input type="checkbox" checked={!!resolved[o.k]} onChange={(e) => setResolved((r) => ({ ...r, [o.k]: e.target.checked }))} />
              <span>{pill(o.kind, "var(--ch-paper)", "var(--ch-sub)")} {o.text}</span>
            </label>
          ))}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 mb-3">
        <label className={`${lbl} sm:col-span-2`} style={lblStyle}>
          Title
          <input className={`${inputCls} w-full mt-1`} style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className={lbl} style={lblStyle}>Effective from<input type="date" className={`${inputCls} w-full mt-1`} style={inputStyle} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} /></label>
        <div className="grid grid-cols-2 gap-2">
          <label className={lbl} style={lblStyle}>Effective to<input type="date" className={`${inputCls} w-full mt-1`} style={inputStyle} value={effectiveTo} onChange={(e) => setEffectiveTo(e.target.value)} /></label>
          <label className={lbl} style={lblStyle}>Expected POB<input type="number" min={0} className={`${inputCls} w-full mt-1`} style={inputStyle} value={expectedPob} onChange={(e) => setExpectedPob(e.target.value)} /></label>
        </div>
      </div>

      <div className="text-xs font-bold mb-1.5" style={{ color: "var(--ch-ink)" }}>Proposed lines ({lines.length}) — total headcount {lines.reduce((n, l) => n + l.required_headcount, 0)}</div>
      <div className="space-y-2 mb-3">
        {lines.map((l) => (
          <div key={l.key} className={cardCls} style={cardStyle}>
            <div className="p-2.5 flex items-center gap-2 flex-wrap">
              {confidencePill(l.confidence)}
              <select
                className={`${inputCls} min-w-[180px]`}
                style={{ ...inputStyle, borderColor: !l.jobRoleId && !l.createJobRole ? "var(--ch-fail)" : "var(--ch-line)" }}
                value={l.createJobRole ? "__create__" : l.jobRoleId ?? ""}
                onChange={(e) => update(l.key, e.target.value === "__create__" ? { createJobRole: true, jobRoleId: null } : { createJobRole: false, jobRoleId: e.target.value || null })}
              >
                <option value="">Map job role “{l.jobRoleName}”…</option>
                {md.jobRoles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                <option value="__create__">＋ Create “{l.jobRoleName}”</option>
              </select>
              {l.method === "fuzzy" && l.jobRoleId && pill("fuzzy match", "#fef3e2", "#b45309")}
              {l.method === "alias" && pill("alias", "var(--ch-paper)", "var(--ch-sub)")}
              <label className="text-xs flex items-center gap-1" style={{ color: "var(--ch-sub)" }}>
                Headcount
                <input type="number" min={1} className={`${inputCls} w-16`} style={inputStyle} value={l.required_headcount} onChange={(e) => update(l.key, { required_headcount: Math.max(1, Number(e.target.value) || 1) })} />
              </label>
              <span className="text-xs" style={{ color: "var(--ch-sub)" }}>D/N/O</span>
              <input className={`${inputCls} w-12`} style={inputStyle} placeholder="D" value={l.day} onChange={(e) => update(l.key, { day: e.target.value })} />
              <input className={`${inputCls} w-12`} style={inputStyle} placeholder="N" value={l.night} onChange={(e) => update(l.key, { night: e.target.value })} />
              <input className={`${inputCls} w-12`} style={inputStyle} placeholder="O" value={l.other} onChange={(e) => update(l.key, { other: e.target.value })} />
              <select className={inputCls} style={inputStyle} value={l.rotationId ?? ""} onChange={(e) => update(l.key, { rotationId: e.target.value || null })}>
                <option value="">Rotation{l.rotationName ? ` (“${l.rotationName}”)` : ""}…</option>
                {md.rotationTemplates.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              {l.norm_applied && pill(l.norm_applied, "var(--ch-navy-soft)", "var(--ch-navy)")}
              <div className="ml-auto flex items-center gap-2">
                <button onClick={() => setExpanded(expanded === l.key ? null : l.key)} className="text-xs font-semibold ch-link-navy">{expanded === l.key ? "Less" : `Details (${l.documents.length} docs, ${l.skills.length} skills)`}</button>
                <button onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="text-xs" style={{ color: "var(--ch-fail)" }}>✕</button>
              </div>
            </div>
            {l.source_excerpt && (
              <div className="px-2.5 pb-2 text-[11px] italic" style={{ color: "var(--ch-sub)" }}>Source: “{l.source_excerpt}”</div>
            )}
            {expanded === l.key && (
              <div className="border-t p-2.5 space-y-2" style={{ borderColor: "var(--ch-line)" }}>
                <div className="grid gap-2 sm:grid-cols-3">
                  <input className={inputCls} style={inputStyle} placeholder="Employment type preference" value={l.employment_type_preference} onChange={(e) => update(l.key, { employment_type_preference: e.target.value })} />
                  <input className={inputCls} style={inputStyle} placeholder="Nationality preference" value={l.nationality_preference} onChange={(e) => update(l.key, { nationality_preference: e.target.value })} />
                  <input className={inputCls} style={inputStyle} placeholder="Language requirement" value={l.language_requirement} onChange={(e) => update(l.key, { language_requirement: e.target.value })} />
                  <input type="number" min={0} step="0.5" className={inputCls} style={inputStyle} placeholder="Min experience (yrs)" value={l.minimum_experience_years} onChange={(e) => update(l.key, { minimum_experience_years: e.target.value })} />
                  <input type="number" min={0} className={inputCls} style={inputStyle} placeholder="Mobilization lead (days)" value={l.mobilization_lead_days} onChange={(e) => update(l.key, { mobilization_lead_days: e.target.value })} />
                  <label className="text-xs flex items-center gap-1" style={{ color: "var(--ch-ink)" }}><input type="checkbox" checked={l.client_approval_required} onChange={(e) => update(l.key, { client_approval_required: e.target.checked })} /> Client approval required</label>
                </div>
                <input className={`${inputCls} w-full`} style={inputStyle} placeholder="Remarks" value={l.remarks} onChange={(e) => update(l.key, { remarks: e.target.value })} />

                <div className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--ch-sub)" }}>Required documents</div>
                {l.documents.length === 0 && <div className="text-xs" style={{ color: "var(--ch-sub)" }}>None proposed.</div>}
                {l.documents.map((d, di) => (
                  <div key={di} className="flex items-center gap-2 flex-wrap text-xs">
                    <select
                      className={inputCls}
                      style={{ ...inputStyle, borderColor: !d.id && !d.create ? "var(--ch-fail)" : "var(--ch-line)" }}
                      value={d.create ? "__create__" : d.id ?? ""}
                      onChange={(e) => update(l.key, { documents: l.documents.map((x, i) => (i === di ? (e.target.value === "__create__" ? { ...x, create: true, id: null } : { ...x, create: false, id: e.target.value || null }) : x)) })}
                    >
                      <option value="">Map “{d.name}”…</option>
                      {md.documentTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      <option value="__create__">＋ Create “{d.name}”</option>
                    </select>
                    {d.method === "fuzzy" && d.id && pill("fuzzy", "#fef3e2", "#b45309")}
                    <label className="flex items-center gap-1" style={{ color: "var(--ch-ink)" }}><input type="checkbox" checked={d.is_mandatory} onChange={(e) => update(l.key, { documents: l.documents.map((x, i) => (i === di ? { ...x, is_mandatory: e.target.checked } : x)) })} /> Mandatory</label>
                    <label className="flex items-center gap-1" style={{ color: "var(--ch-ink)" }}><input type="checkbox" checked={d.waiver_permitted} onChange={(e) => update(l.key, { documents: l.documents.map((x, i) => (i === di ? { ...x, waiver_permitted: e.target.checked } : x)) })} /> Waiver ok</label>
                    <input type="number" min={0} className={`${inputCls} w-24`} style={inputStyle} placeholder="Min validity d" value={d.minimum_remaining_validity_days} onChange={(e) => update(l.key, { documents: l.documents.map((x, i) => (i === di ? { ...x, minimum_remaining_validity_days: e.target.value } : x)) })} />
                    <button onClick={() => update(l.key, { documents: l.documents.filter((_, i) => i !== di) })} style={{ color: "var(--ch-fail)" }}>✕</button>
                  </div>
                ))}

                <div className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--ch-sub)" }}>Required skills</div>
                {l.skills.length === 0 && <div className="text-xs" style={{ color: "var(--ch-sub)" }}>None proposed.</div>}
                {l.skills.map((s, si) => (
                  <div key={si} className="flex items-center gap-2 flex-wrap text-xs">
                    <select
                      className={inputCls}
                      style={{ ...inputStyle, borderColor: !s.id && !s.create ? "var(--ch-fail)" : "var(--ch-line)" }}
                      value={s.create ? "__create__" : s.id ?? ""}
                      onChange={(e) => update(l.key, { skills: l.skills.map((x, i) => (i === si ? (e.target.value === "__create__" ? { ...x, create: true, id: null } : { ...x, create: false, id: e.target.value || null }) : x)) })}
                    >
                      <option value="">Map “{s.name}”…</option>
                      {md.skills.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      <option value="__create__">＋ Create “{s.name}”</option>
                    </select>
                    {s.method === "fuzzy" && s.id && pill("fuzzy", "#fef3e2", "#b45309")}
                    <button onClick={() => update(l.key, { skills: l.skills.filter((_, i) => i !== si) })} style={{ color: "var(--ch-fail)" }}>✕</button>
                  </div>
                ))}

                {(l.competencies.length > 0 || l.client_requirements.length > 0) && (
                  <div className="text-xs" style={{ color: "var(--ch-sub)" }}>
                    {l.competencies.length > 0 && <div>Competencies: {l.competencies.map((c) => `${c.name}${c.minimum_grade ? ` (${c.minimum_grade})` : ""}`).join(", ")}</div>}
                    {l.client_requirements.length > 0 && <div>Client requirements: {l.client_requirements.map((c) => `${c.text}${c.is_mandatory ? " (mandatory)" : ""}`).join("; ")}</div>}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <label className={`${lbl} block mb-3`} style={lblStyle}>
        Notes
        <textarea className={`${inputCls} w-full mt-1`} style={inputStyle} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>

      {unmapped.length > 0 && (
        <div className="text-xs mb-2 rounded-lg px-3 py-2" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>
          Needs mapping before saving: {unmapped.join("; ")}
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={save} disabled={!canSave} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
          {busy ? "Saving…" : "Create draft matrix"}
        </button>
        <span className="text-xs" style={{ color: "var(--ch-sub)" }}>
          {unresolved > 0 ? `${unresolved} assumption(s)/question(s) to review` : unmapped.length > 0 ? "Resolve the mappings above" : "Saves as a normal draft — approval workflow unchanged."}
        </span>
      </div>
    </div>
  );
}
