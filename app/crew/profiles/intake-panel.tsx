"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { intakeAvailability, extractCrewIntake, saveCrewIntake, discardCrewIntake, type MappedIntakeProposal } from "./intake-actions";
import { COUNTRIES } from "@/lib/countries";

// Phase 12 — "Fill from documents" intake panel. Mirrors the review/map/
// save UI pattern of app/crew/matrices/new/ai-generate.tsx, scoped to a
// single crew member: upload a CV/passport/ID/certificates, review the
// AI's reading of them (every field editable, every document mapped or
// created), resolve any duplicate-name warning, then save as a new crew
// profile with its documents.

const inputCls = "border rounded-lg px-3 py-2 text-sm";
const inputStyle = { borderColor: "var(--ch-line)" };
const cardCls = "bg-white border rounded-xl";
const cardStyle = { borderColor: "var(--ch-line)" };
const lbl = "text-xs";
const lblStyle = { color: "var(--ch-sub)" };

function pill(text: string, bg: string, fg: string) {
  return (
    <span className="text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5 whitespace-nowrap" style={{ background: bg, color: fg }}>
      {text}
    </span>
  );
}
function confidencePill(c: number) {
  const pct = Math.round(c * 100);
  return pill(`${pct}%`, c >= 0.8 ? "var(--ch-pass-bg)" : c >= 0.5 ? "#fef3e2" : "var(--ch-fail-bg)", c >= 0.8 ? "var(--ch-pass)" : c >= 0.5 ? "#b45309" : "var(--ch-fail)");
}

type EditDocument = { name: string; id: string | null; create: boolean; method: string; documentNumber: string; issueDate: string; expiryDate: string; confidence: number; source_excerpt: string | null };

function toEditDocuments(p: MappedIntakeProposal): EditDocument[] {
  return p.documents.map((d) => ({
    name: d.name,
    id: d.mapping.targetId,
    create: false,
    method: d.mapping.method,
    documentNumber: d.document_number ?? "",
    issueDate: d.issue_date ?? "",
    expiryDate: d.expiry_date ?? "",
    confidence: d.confidence,
    source_excerpt: d.source_excerpt,
  }));
}

export default function IntakePanel() {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [availability, setAvailability] = useState<{ enabled: boolean; reason: string | null; maxUploadMb: number; documentCapable: boolean } | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [pasted, setPasted] = useState("");
  const [extractAsImage, setExtractAsImage] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<{ model: string; outcome: string }[]>([]);
  const [proposal, setProposal] = useState<MappedIntakeProposal | null>(null);

  const [fullName, setFullName] = useState("");
  const [employeeCode, setEmployeeCode] = useState("");
  const [employmentStatus, setEmploymentStatus] = useState("candidate");
  const [jobRoleId, setJobRoleId] = useState<string | null>(null);
  const [createJobRole, setCreateJobRole] = useState(false);
  const [jobRoleName, setJobRoleName] = useState<string | null>(null);
  const [jobRoleMethod, setJobRoleMethod] = useState<string>("none");
  const [nationality, setNationality] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [homeCountry, setHomeCountry] = useState("");
  const [documents, setDocuments] = useState<EditDocument[]>([]);
  const [resolved, setResolved] = useState<Record<string, boolean>>({});
  const [duplicatesAck, setDuplicatesAck] = useState(false);

  useEffect(() => {
    if (!open || availability) return;
    intakeAvailability()
      .then(setAvailability)
      .catch((e) => setAvailability({ enabled: false, reason: e instanceof Error ? e.message : String(e), maxUploadMb: 20, documentCapable: false }));
  }, [open, availability]);

  const generate = () => {
    setBusy(true);
    setError(null);
    setAttempts([]);
    const fd = new FormData();
    for (const f of files) fd.append("files", f);
    fd.set("pastedText", pasted);
    fd.set("extractAsImage", String(extractAsImage));
    startTransition(async () => {
      const res = await extractCrewIntake(fd);
      setBusy(false);
      if ("error" in res) {
        setError(res.error);
        setAttempts(res.attempts ?? []);
        return;
      }
      const p = res.proposal;
      setProposal(p);
      setFullName(p.full_name ?? "");
      setEmployeeCode("");
      setEmploymentStatus("candidate");
      setJobRoleId(p.job_role?.targetId ?? null);
      setCreateJobRole(false);
      setJobRoleName(p.job_role?.name ?? null);
      setJobRoleMethod(p.job_role?.method ?? "none");
      setNationality(p.nationality ?? "");
      setDateOfBirth(p.date_of_birth ?? "");
      setGender(p.gender ?? "");
      setPhone(p.phone ?? "");
      setEmail(p.email ?? "");
      setHomeCountry(p.home_country ?? "");
      setDocuments(toEditDocuments(p));
      setResolved({});
      setDuplicatesAck(false);
    });
  };

  const unmappedDocs = documents.filter((d) => !d.id && !d.create).map((d) => `document "${d.name}"`);
  const openItems = proposal ? proposal.assumptions.map((a, i) => ({ k: `a${i}`, text: a })) : [];
  const unresolved = openItems.filter((o) => !resolved[o.k]).length;
  const needsDuplicateAck = !!proposal && proposal.duplicates.length > 0 && !duplicatesAck;
  const canSave = !!proposal && !!fullName.trim() && (!jobRoleName || !!jobRoleId || createJobRole) && unmappedDocs.length === 0 && unresolved === 0 && !needsDuplicateAck && !busy;

  const save = () => {
    if (!proposal || !canSave) return;
    setBusy(true);
    setError(null);
    const payload = {
      fullName: fullName.trim(),
      employeeCode: employeeCode.trim() || null,
      employmentStatus,
      jobRoleId: createJobRole ? null : jobRoleId,
      newJobRoleName: createJobRole ? jobRoleName : null,
      jobRoleAlias: jobRoleId && jobRoleMethod !== "exact" && !createJobRole ? jobRoleName : null,
      nationality: nationality.trim() || null,
      dateOfBirth: dateOfBirth || null,
      gender: gender.trim() || null,
      phone: phone.trim() || null,
      email: email.trim() || null,
      homeCountry: homeCountry.trim() || null,
      documents: documents.map((d) => ({
        documentTypeId: d.create ? null : d.id,
        newName: d.create ? d.name : null,
        alias: d.id && d.method !== "exact" && !d.create ? d.name : null,
        documentNumber: d.documentNumber.trim() || null,
        issueDate: d.issueDate || null,
        expiryDate: d.expiryDate || null,
      })),
    };
    startTransition(async () => {
      const res = await saveCrewIntake(proposal.generationId, JSON.stringify(payload));
      setBusy(false);
      if (res?.error) {
        setError(res.error);
        return;
      }
      if (res?.id) router.push(`/crew/profiles/${res.id}`);
    });
  };

  const discard = () => {
    if (proposal) discardCrewIntake(proposal.generationId);
    setProposal(null);
    setDocuments([]);
    setFiles([]);
    setPasted("");
  };

  const close = () => {
    discard();
    setOpen(false);
  };

  const updateDoc = (i: number, patch: Partial<EditDocument>) => setDocuments((ds) => ds.map((d, di) => (di === i ? { ...d, ...patch } : d)));

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-line)", color: "var(--ch-navy)" }}>
        ✦ Add from CV / ID scan
      </button>
    );
  }

  return (
    <div className={`${cardCls} p-5`} style={cardStyle}>
      <div className="flex items-center gap-2 mb-3">
        <div className="font-semibold text-sm" style={{ color: "var(--ch-ink)" }}>Add from CV / ID scan</div>
        <button onClick={close} className="ml-auto text-xs font-semibold" style={{ color: "var(--ch-sub)" }}>Close</button>
      </div>

      {availability && !availability.enabled && (
        <div className="text-sm rounded-lg px-3 py-2" style={{ background: "#fef3e2", color: "#b45309" }}>
          {availability.reason} <Link href="/team/ai" className="font-semibold underline">Open AI Settings</Link>
        </div>
      )}

      {(!availability || availability.enabled) && !proposal && (
        <div>
          <p className="text-xs mb-3" style={{ color: "var(--ch-sub)" }}>
            Upload a CV, passport, national ID, or certificates for one person. The AI reads them and proposes a crew profile with their documents — you review and edit everything before anything is saved. The scanned documents themselves are sent to the configured AI model.
          </p>
          <div className={`${lbl} block mb-2`} style={lblStyle}>
            Documents (PDF, Word, image, or text{availability ? `, up to ${availability.maxUploadMb} MB each` : ""})
          </div>
          {/* A bare <input type="file"> renders as a browser-native
              "Choose Files / No file chosen" control that reads like a
              disabled text field rather than something clickable. Hiding
              it and triggering it from a real button makes the click
              target obvious. */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.docx,.xlsx,.xls,.csv,.txt,.md,.png,.jpg,.jpeg"
            className="hidden"
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []);
              if (picked.length) setFiles((fs) => [...fs, ...picked]);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded-lg border px-4 py-2 text-sm font-semibold mb-2"
            style={{ borderColor: "var(--ch-line)", color: "var(--ch-navy)" }}
          >
            + Choose files
          </button>
          {files.length > 0 && (
            <ul className="text-xs mb-2 space-y-0.5" style={{ color: "var(--ch-ink)" }}>
              {files.map((f, i) => (
                <li key={i} className="flex items-center gap-2">
                  {f.name}
                  <button onClick={() => setFiles((fs) => fs.filter((_, fi) => fi !== i))} style={{ color: "var(--ch-fail)" }}>✕</button>
                </li>
              ))}
            </ul>
          )}
          <label className="flex items-start gap-2 text-xs mb-3" style={{ color: "var(--ch-ink)" }}>
            <input type="checkbox" checked={extractAsImage} onChange={(e) => setExtractAsImage(e.target.checked)} />
            <span>
              Read scanned documents as images (usually more accurate for scans, but needs a vision-capable AI
              model). Uncheck to extract text via OCR first instead — works with any text-only AI model, including
              free ones that reject images/PDFs. Either way, an AI model still reads the extracted text to fill in
              the fields below — OCR only gets the raw text out of the scan, it doesn&apos;t structure it.
            </span>
          </label>
          {extractAsImage && availability && !availability.documentCapable && files.some((f) => /\.(png|jpe?g)$/i.test(f.name)) && (
            <div className="text-xs mb-2" style={{ color: "#b45309" }}>No configured model accepts images — a scanned document will fail; uncheck &ldquo;Read scanned documents as images&rdquo; above to extract text via OCR instead, or enable a document-capable model.</div>
          )}
          <label className={`${lbl} block mb-3`} style={lblStyle}>
            …or paste CV / ID text
            <textarea className={`${inputCls} w-full mt-1`} style={inputStyle} rows={4} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Paste CV or document text here" />
          </label>
          {error && <div className="text-sm mb-3 rounded-lg px-3 py-2" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>{error}</div>}
          {attempts.length > 0 && <div className="text-xs mb-3" style={{ color: "var(--ch-sub)" }}>{attempts.map((a) => `${a.model}: ${a.outcome}`).join(" · ")}</div>}
          <button
            onClick={generate}
            disabled={busy || (files.length === 0 && !pasted.trim()) || (availability ? !availability.enabled : false)}
            className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {busy ? "Reading documents… (this can take up to a minute)" : "Extract with AI"}
          </button>
        </div>
      )}

      {proposal && (
        <div>
          <div className="flex items-center gap-2 flex-wrap mb-3">
            {pill("AI proposal", "var(--ch-navy-soft)", "var(--ch-navy)")}
            <span className="text-xs" style={{ color: "var(--ch-sub)" }}>
              Answered by {proposal.modelLabel}
              {proposal.attempts.length > 1 ? ` · ${proposal.attempts.slice(0, -1).map((a) => `${a.model}: ${a.outcome}`).join("; ")}` : ""}
            </span>
            <button onClick={discard} className="ml-auto text-xs font-semibold" style={{ color: "var(--ch-sub)" }}>Discard &amp; start over</button>
          </div>
          {error && <div className="text-sm mb-3 rounded-lg px-3 py-2" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>{error}</div>}

          {proposal.name_mismatch_warning && (
            <div className="text-xs mb-3 rounded-lg px-3 py-2" style={{ background: "#fef3e2", color: "#b45309" }}>
              <b>Name mismatch:</b> {proposal.name_mismatch_warning}
            </div>
          )}

          {proposal.duplicates.length > 0 && (
            <div className="border rounded-lg p-3 mb-3" style={{ borderColor: "var(--ch-line)", background: "#fffaf0" }}>
              <div className="text-xs font-bold mb-1.5" style={{ color: "#b45309" }}>Possible existing crew member(s) with a similar name</div>
              <ul className="text-xs mb-2 space-y-0.5" style={{ color: "var(--ch-ink)" }}>
                {proposal.duplicates.map((d) => (
                  <li key={d.id}>
                    <Link href={`/crew/profiles/${d.id}`} target="_blank" className="ch-link-navy font-semibold">{d.full_name}</Link>
                    {d.employee_code ? ` (${d.employee_code})` : ""} — {Math.round(d.score * 100)}% name match
                  </li>
                ))}
              </ul>
              <label className="flex items-start gap-2 text-xs" style={{ color: "var(--ch-ink)" }}>
                <input type="checkbox" checked={duplicatesAck} onChange={(e) => setDuplicatesAck(e.target.checked)} />
                <span>I checked the above and this is a different person (or intentionally a new record).</span>
              </label>
            </div>
          )}

          {openItems.length > 0 && (
            <div className="border rounded-lg p-3 mb-3" style={{ borderColor: "var(--ch-line)", background: "#fffaf0" }}>
              <div className="text-xs font-bold mb-1.5" style={{ color: "#b45309" }}>Assumptions — tick each once reviewed ({unresolved} left)</div>
              {openItems.map((o) => (
                <label key={o.k} className="flex items-start gap-2 text-xs py-0.5" style={{ color: "var(--ch-ink)" }}>
                  <input type="checkbox" checked={!!resolved[o.k]} onChange={(e) => setResolved((r) => ({ ...r, [o.k]: e.target.checked }))} />
                  <span>{o.text}</span>
                </label>
              ))}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 mb-3">
            <label className={lbl} style={lblStyle}>
              Full name
              <input className={`${inputCls} w-full mt-1`} style={inputStyle} value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </label>
            <label className={lbl} style={lblStyle}>
              Employee code (optional)
              <input className={`${inputCls} w-full mt-1`} style={inputStyle} value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value)} />
            </label>

            <label className={lbl} style={lblStyle}>
              Job role / rank
              <select
                className={`${inputCls} w-full mt-1`}
                style={{ ...inputStyle, borderColor: jobRoleName && !jobRoleId && !createJobRole ? "var(--ch-fail)" : "var(--ch-line)" }}
                value={createJobRole ? "__create__" : jobRoleId ?? ""}
                onChange={(e) => {
                  if (e.target.value === "__create__") {
                    setCreateJobRole(true);
                    setJobRoleId(null);
                  } else {
                    setCreateJobRole(false);
                    setJobRoleId(e.target.value || null);
                  }
                }}
              >
                <option value="">{jobRoleName ? `Map “${jobRoleName}”…` : "No role"}</option>
                {proposal.masterData.jobRoles.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
                {jobRoleName && <option value="__create__">＋ Create “{jobRoleName}”</option>}
              </select>
              {jobRoleMethod === "fuzzy" && jobRoleId && <span className="mt-1 inline-block">{pill("fuzzy match", "#fef3e2", "#b45309")}</span>}
            </label>
            <label className={lbl} style={lblStyle}>
              Employment status
              <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={employmentStatus} onChange={(e) => setEmploymentStatus(e.target.value)}>
                <option value="candidate">Candidate</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>

            <label className={lbl} style={lblStyle}>
              Nationality
              <input className={`${inputCls} w-full mt-1`} style={inputStyle} value={nationality} onChange={(e) => setNationality(e.target.value)} />
            </label>
            <label className={lbl} style={lblStyle}>
              Date of birth
              <input type="date" className={`${inputCls} w-full mt-1`} style={inputStyle} value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
            </label>
            <label className={lbl} style={lblStyle}>
              Gender
              <input className={`${inputCls} w-full mt-1`} style={inputStyle} value={gender} onChange={(e) => setGender(e.target.value)} />
            </label>
            <label className={lbl} style={lblStyle}>
              Home country
              <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={homeCountry} onChange={(e) => setHomeCountry(e.target.value)}>
                <option value="">Home country…</option>
                {/* AI-extracted text (e.g. from a passport) may not match
                    the fixed list below — keep it selectable rather than
                    silently dropping what was read. */}
                {homeCountry && !COUNTRIES.includes(homeCountry as (typeof COUNTRIES)[number]) && (
                  <option value={homeCountry}>{homeCountry} (unmatched — pick below)</option>
                )}
                {COUNTRIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className={lbl} style={lblStyle}>
              Phone
              <input className={`${inputCls} w-full mt-1`} style={inputStyle} value={phone} onChange={(e) => setPhone(e.target.value)} />
            </label>
            <label className={lbl} style={lblStyle}>
              Email
              <input className={`${inputCls} w-full mt-1`} style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
          </div>

          <div className="text-xs font-bold mb-1.5" style={{ color: "var(--ch-ink)" }}>Documents found ({documents.length})</div>
          {documents.length === 0 && <div className="text-xs mb-3" style={{ color: "var(--ch-sub)" }}>None proposed — you can add documents later from the crew member&rsquo;s page.</div>}
          <div className="space-y-2 mb-3">
            {documents.map((d, i) => (
              <div key={i} className={cardCls} style={cardStyle}>
                <div className="p-2.5 flex items-center gap-2 flex-wrap">
                  {confidencePill(d.confidence)}
                  <select
                    className={`${inputCls} min-w-[180px]`}
                    style={{ ...inputStyle, borderColor: !d.id && !d.create ? "var(--ch-fail)" : "var(--ch-line)" }}
                    value={d.create ? "__create__" : d.id ?? ""}
                    onChange={(e) => updateDoc(i, e.target.value === "__create__" ? { create: true, id: null } : { create: false, id: e.target.value || null })}
                  >
                    <option value="">Map “{d.name}”…</option>
                    {proposal.masterData.documentTypes.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                    <option value="__create__">＋ Create “{d.name}”</option>
                  </select>
                  {d.method === "fuzzy" && d.id && pill("fuzzy match", "#fef3e2", "#b45309")}
                  {d.method === "alias" && pill("alias", "var(--ch-paper)", "var(--ch-sub)")}
                  <input className={`${inputCls} w-32`} style={inputStyle} placeholder="Document #" value={d.documentNumber} onChange={(e) => updateDoc(i, { documentNumber: e.target.value })} />
                  <label className="text-xs flex items-center gap-1" style={{ color: "var(--ch-sub)" }}>
                    Issued
                    <input type="date" className={`${inputCls} w-36`} style={inputStyle} value={d.issueDate} onChange={(e) => updateDoc(i, { issueDate: e.target.value })} />
                  </label>
                  <label className="text-xs flex items-center gap-1" style={{ color: "var(--ch-sub)" }}>
                    Expires
                    <input type="date" className={`${inputCls} w-36`} style={inputStyle} value={d.expiryDate} onChange={(e) => updateDoc(i, { expiryDate: e.target.value })} />
                  </label>
                  <button onClick={() => setDocuments((ds) => ds.filter((_, di) => di !== i))} className="ml-auto text-xs" style={{ color: "var(--ch-fail)" }}>✕</button>
                </div>
                {d.source_excerpt && <div className="px-2.5 pb-2 text-[11px] italic" style={{ color: "var(--ch-sub)" }}>Source: “{d.source_excerpt}”</div>}
              </div>
            ))}
          </div>

          {unmappedDocs.length > 0 && (
            <div className="text-xs mb-2 rounded-lg px-3 py-2" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>
              Needs mapping before saving: {unmappedDocs.join("; ")}
            </div>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={save} disabled={!canSave} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
              {busy ? "Saving…" : "Create crew member"}
            </button>
            <span className="text-xs" style={{ color: "var(--ch-sub)" }}>
              {unresolved > 0
                ? `${unresolved} assumption(s) to review`
                : needsDuplicateAck
                  ? "Review the possible duplicate above"
                  : unmappedDocs.length > 0
                    ? "Resolve the document mappings above"
                    : "You can add or edit anything else on the crew member's page afterward."}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
