"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  parseCrewRegisterFile,
  commitCrewRegisterImport,
  type CrewRegisterPreview,
  type CommitResult,
} from "../crew-register-actions";

const inputCls = "border rounded-lg px-3 py-2 text-sm";
const inputStyle = { borderColor: "var(--ch-line)" };
const cardCls = "bg-white border rounded-xl";
const cardStyle = { borderColor: "var(--ch-line)" };

function pill(text: string, bg: string, fg: string) {
  return (
    <span className="text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5 whitespace-nowrap" style={{ background: bg, color: fg }}>
      {text}
    </span>
  );
}

type Resolution = { id: string } | { createNew: true } | null;

function resolutionSelectValue(res: Resolution): string {
  if (!res) return "";
  if ("id" in res) return res.id;
  return "__new__";
}

export default function CrewRegisterImportPanel({ canDocuments }: { canDocuments: boolean }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<CrewRegisterPreview | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set()); // keys: "p:<rowNumber>" / "d:<rowNumber>"
  const [jobRoleResolutions, setJobRoleResolutions] = useState<Record<string, Resolution>>({});
  const [documentTypeResolutions, setDocumentTypeResolutions] = useState<Record<string, Resolution>>({});
  const [result, setResult] = useState<CommitResult | null>(null);

  function reset() {
    setPreview(null);
    setExcluded(new Set());
    setJobRoleResolutions({});
    setDocumentTypeResolutions({});
    setResult(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    setResult(null);
    const fd = new FormData();
    fd.append("file", file);
    const res = await parseCrewRegisterFile(fd);
    setBusy(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setPreview(res.preview);
    // Default-exclude rows that already carry blocking errors.
    const ex = new Set<string>();
    for (const p of res.preview.profiles) if (p.errors.length) ex.add(`p:${p.rowNumber}`);
    for (const d of res.preview.documents) if (d.errors.length) ex.add(`d:${d.rowNumber}`);
    setExcluded(ex);
  }

  const profileErrorCount = preview?.profiles.filter((p) => p.errors.length).length ?? 0;
  const profileWarningCount = preview?.profiles.filter((p) => !p.errors.length && p.warnings.length).length ?? 0;
  const docErrorCount = preview?.documents.filter((d) => d.errors.length).length ?? 0;

  const unresolvedRequiredCount = useMemo(() => {
    if (!preview) return 0;
    let n = 0;
    for (const name of preview.unmatchedJobRoles) if (!jobRoleResolutions[name]) n++;
    for (const name of preview.unmatchedDocumentTypes) if (!documentTypeResolutions[name]) n++;
    return n;
  }, [preview, jobRoleResolutions, documentTypeResolutions]);

  const includedProfileCount = preview ? preview.profiles.filter((p) => !p.errors.length && !excluded.has(`p:${p.rowNumber}`)).length : 0;
  const includedDocumentCount = preview ? preview.documents.filter((d) => !d.errors.length && !excluded.has(`d:${d.rowNumber}`)).length : 0;

  function resolveJobRole(name: string | null): { jobRoleId: string | null; newJobRoleName: string | null } {
    if (!name) return { jobRoleId: null, newJobRoleName: null };
    const key = name.trim().toLowerCase();
    const existing = preview?.masterData.jobRoles.find((r) => r.name.trim().toLowerCase() === key);
    if (existing) return { jobRoleId: existing.id, newJobRoleName: null };
    const res = jobRoleResolutions[name];
    if (res && "id" in res) return { jobRoleId: res.id, newJobRoleName: null };
    if (res && "createNew" in res) return { jobRoleId: null, newJobRoleName: name };
    return { jobRoleId: null, newJobRoleName: null };
  }
  function resolveDocType(name: string): { documentTypeId: string | null; newDocumentTypeName: string | null } {
    const key = name.trim().toLowerCase();
    const existing = preview?.masterData.documentTypes.find((r) => r.name.trim().toLowerCase() === key);
    if (existing) return { documentTypeId: existing.id, newDocumentTypeName: null };
    const res = documentTypeResolutions[name];
    if (res && "id" in res) return { documentTypeId: res.id, newDocumentTypeName: null };
    if (res && "createNew" in res) return { documentTypeId: null, newDocumentTypeName: name };
    return { documentTypeId: null, newDocumentTypeName: null };
  }

  function handleImport() {
    if (!preview) return;
    setError(null);
    const profiles = preview.profiles
      .filter((p) => !p.errors.length && !excluded.has(`p:${p.rowNumber}`))
      .map((p) => {
        const { jobRoleId, newJobRoleName } = p.jobRoleMapping?.targetId
          ? { jobRoleId: p.jobRoleMapping.targetId, newJobRoleName: null }
          : resolveJobRole(p.jobRoleName);
        return {
          employeeCode: p.employeeCode,
          fullName: p.fullName,
          jobRoleId,
          newJobRoleName,
          employmentStatus: p.employmentStatus,
          employmentType: p.employmentType,
          nationality: p.nationality,
          dateOfBirth: p.dateOfBirth,
          gender: p.gender,
          phone: p.phone,
          email: p.email,
          homeCountry: p.homeCountry,
          currentLocation: p.currentLocation,
          nearestAirport: p.nearestAirport,
          joiningDate: p.joiningDate,
          noticePeriodDays: p.noticePeriodDays,
          availabilityDate: p.availabilityDate,
          emergencyContactName: p.emergencyContactName,
          emergencyContactPhone: p.emergencyContactPhone,
          dayRate: p.dayRate,
          currency: p.currency,
          dietaryMedicalNotes: p.dietaryMedicalNotes,
          notes: p.notes,
        };
      });
    const includedCodes = new Set(profiles.map((p) => p.employeeCode.toLowerCase()));
    const documents = preview.documents
      .filter((d) => !d.errors.length && !excluded.has(`d:${d.rowNumber}`) && includedCodes.has(d.employeeCode.toLowerCase()))
      .map((d) => {
        const { documentTypeId, newDocumentTypeName } = d.mapping?.targetId
          ? { documentTypeId: d.mapping.targetId, newDocumentTypeName: null }
          : resolveDocType(d.documentTypeName);
        return {
          employeeCode: d.employeeCode,
          documentTypeId,
          newDocumentTypeName,
          documentNumber: d.documentNumber,
          issueDate: d.issueDate,
          expiryDate: d.expiryDate,
          notes: d.notes,
        };
      });

    setBusy(true);
    startTransition(async () => {
      const res = await commitCrewRegisterImport(JSON.stringify({ profiles, documents }));
      setBusy(false);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setResult(res.result);
      router.refresh();
    });
  }

  function toggleExclude(key: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="space-y-5">
      {!preview && (
        <div className={`${cardCls} p-5`} style={cardStyle}>
          <label className="text-xs font-semibold block mb-2" style={{ color: "var(--ch-navy)" }}>
            Filled-in crew register workbook
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
            className="text-sm"
          />
          {busy && <p className="text-xs mt-3" style={{ color: "var(--ch-sub)" }}>Parsing…</p>}
        </div>
      )}

      {error && (
        <div className="rounded-lg px-4 py-3 text-sm" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>
          {error}
        </div>
      )}

      {result && (
        <div className={`${cardCls} p-5`} style={cardStyle}>
          <div className="text-sm font-semibold mb-2" style={{ color: "var(--ch-navy)" }}>Import complete</div>
          <p className="text-sm mb-1">
            Created <b>{result.createdProfiles}</b> crew profile{result.createdProfiles === 1 ? "" : "s"} and{" "}
            <b>{result.createdDocuments}</b> document{result.createdDocuments === 1 ? "" : "s"}.
          </p>
          {result.errors.length > 0 && (
            <div className="mt-3">
              <div className="text-xs font-semibold mb-1" style={{ color: "var(--ch-fail)" }}>
                {result.errors.length} row{result.errors.length === 1 ? "" : "s"} had a problem:
              </div>
              <ul className="text-xs list-disc pl-4 space-y-0.5" style={{ color: "var(--ch-sub)" }}>
                {result.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}
          <button onClick={reset} className="mt-4 rounded-lg px-4 py-2 text-sm font-semibold text-white" style={{ background: "var(--ch-navy)" }}>
            Import another file
          </button>
        </div>
      )}

      {preview && !result && (
        <>
          <div className={`${cardCls} p-4 flex flex-wrap items-center gap-3`} style={cardStyle}>
            <span className="text-sm font-semibold" style={{ color: "var(--ch-navy)" }}>{preview.sourceFilename}</span>
            {pill(`${preview.profiles.length} profiles`, "var(--ch-navy-soft, #eef1f6)", "var(--ch-navy)")}
            {profileErrorCount > 0 && pill(`${profileErrorCount} blocked`, "var(--ch-fail-bg)", "var(--ch-fail)")}
            {profileWarningCount > 0 && pill(`${profileWarningCount} warnings`, "#fef3e2", "#b45309")}
            {pill(`${preview.documents.length} documents`, "var(--ch-navy-soft, #eef1f6)", "var(--ch-navy)")}
            {docErrorCount > 0 && pill(`${docErrorCount} blocked`, "var(--ch-fail-bg)", "var(--ch-fail)")}
            <button onClick={reset} className="ml-auto text-xs font-semibold underline" style={{ color: "var(--ch-sub)" }}>
              Start over
            </button>
          </div>

          {(preview.unmatchedJobRoles.length > 0 || preview.unmatchedDocumentTypes.length > 0) && (
            <div className={`${cardCls} p-4`} style={cardStyle}>
              <div className="text-sm font-semibold mb-1" style={{ color: "var(--ch-navy)" }}>Resolve unmatched names</div>
              <p className="text-xs mb-3" style={{ color: "var(--ch-sub)" }}>
                These names from the workbook didn't match anything already set up in Crew Setup. Map each one to an existing entry, or create it new.
              </p>
              <div className="space-y-4">
                {preview.unmatchedJobRoles.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold mb-1.5" style={{ color: "var(--ch-sub)" }}>Job roles</div>
                    <div className="space-y-1.5">
                      {preview.unmatchedJobRoles.map((name) => (
                        <div key={name} className="flex items-center gap-2 text-sm">
                          <span className="w-48 truncate" title={name}>{name}</span>
                          <select
                            className={inputCls}
                            style={inputStyle}
                            value={resolutionSelectValue(jobRoleResolutions[name] ?? null)}
                            onChange={(e) => {
                              const v = e.target.value;
                              setJobRoleResolutions((prev) => ({
                                ...prev,
                                [name]: v === "" ? null : v === "__new__" ? { createNew: true } : { id: v },
                              }));
                            }}
                          >
                            <option value="">Choose…</option>
                            <option value="__new__">+ Create new job role &quot;{name}&quot;</option>
                            {preview.masterData.jobRoles.map((r) => (
                              <option key={r.id} value={r.id}>{r.name}</option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {preview.unmatchedDocumentTypes.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold mb-1.5" style={{ color: "var(--ch-sub)" }}>Document types</div>
                    <div className="space-y-1.5">
                      {preview.unmatchedDocumentTypes.map((name) => (
                        <div key={name} className="flex items-center gap-2 text-sm">
                          <span className="w-48 truncate" title={name}>{name}</span>
                          <select
                            className={inputCls}
                            style={inputStyle}
                            value={resolutionSelectValue(documentTypeResolutions[name] ?? null)}
                            onChange={(e) => {
                              const v = e.target.value;
                              setDocumentTypeResolutions((prev) => ({
                                ...prev,
                                [name]: v === "" ? null : v === "__new__" ? { createNew: true } : { id: v },
                              }));
                            }}
                          >
                            <option value="">Choose…</option>
                            <option value="__new__">+ Create new document type &quot;{name}&quot;</option>
                            {preview.masterData.documentTypes.map((r) => (
                              <option key={r.id} value={r.id}>{r.name}</option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className={`${cardCls} overflow-x-auto`} style={cardStyle}>
            <div className="px-4 pt-4 text-sm font-semibold" style={{ color: "var(--ch-navy)" }}>Crew Profile rows</div>
            <table className="text-xs w-full mt-2">
              <thead>
                <tr style={{ color: "var(--ch-sub)" }}>
                  <th className="text-left px-4 py-2">Include</th>
                  <th className="text-left px-2 py-2">Row</th>
                  <th className="text-left px-2 py-2">Employee Code</th>
                  <th className="text-left px-2 py-2">Full Name</th>
                  <th className="text-left px-2 py-2">Job Role</th>
                  <th className="text-left px-2 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.profiles.map((p) => {
                  const key = `p:${p.rowNumber}`;
                  const blocked = p.errors.length > 0;
                  return (
                    <tr key={key} style={{ borderTop: "1px solid var(--ch-line)", opacity: blocked || excluded.has(key) ? 0.55 : 1 }}>
                      <td className="px-4 py-1.5">
                        <input type="checkbox" disabled={blocked} checked={!excluded.has(key)} onChange={() => toggleExclude(key)} />
                      </td>
                      <td className="px-2 py-1.5">{p.rowNumber}</td>
                      <td className="px-2 py-1.5">{p.employeeCode}</td>
                      <td className="px-2 py-1.5">{p.fullName}</td>
                      <td className="px-2 py-1.5">{p.jobRoleName ?? "—"}</td>
                      <td className="px-2 py-1.5">
                        {p.errors.map((e, i) => <div key={i} style={{ color: "var(--ch-fail)" }}>{e}</div>)}
                        {p.warnings.map((w, i) => <div key={i} style={{ color: "#b45309" }}>{w}</div>)}
                        {!p.errors.length && !p.warnings.length && <span style={{ color: "var(--ch-pass)" }}>Ready</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className={`${cardCls} overflow-x-auto`} style={cardStyle}>
            <div className="px-4 pt-4 text-sm font-semibold" style={{ color: "var(--ch-navy)" }}>Document rows</div>
            {!canDocuments && (
              <p className="text-xs px-4 pt-1" style={{ color: "#b45309" }}>
                You don&apos;t have permission to manage crew documents — these rows will be skipped.
              </p>
            )}
            <table className="text-xs w-full mt-2">
              <thead>
                <tr style={{ color: "var(--ch-sub)" }}>
                  <th className="text-left px-4 py-2">Include</th>
                  <th className="text-left px-2 py-2">Row</th>
                  <th className="text-left px-2 py-2">Employee Code</th>
                  <th className="text-left px-2 py-2">Document Type</th>
                  <th className="text-left px-2 py-2">Number</th>
                  <th className="text-left px-2 py-2">Expiry</th>
                  <th className="text-left px-2 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.documents.map((d) => {
                  const key = `d:${d.rowNumber}`;
                  const blocked = d.errors.length > 0;
                  return (
                    <tr key={key} style={{ borderTop: "1px solid var(--ch-line)", opacity: blocked || excluded.has(key) ? 0.55 : 1 }}>
                      <td className="px-4 py-1.5">
                        <input type="checkbox" disabled={blocked} checked={!excluded.has(key)} onChange={() => toggleExclude(key)} />
                      </td>
                      <td className="px-2 py-1.5">{d.rowNumber}</td>
                      <td className="px-2 py-1.5">{d.employeeCode}</td>
                      <td className="px-2 py-1.5">{d.documentTypeName}</td>
                      <td className="px-2 py-1.5">{d.documentNumber ?? "—"}</td>
                      <td className="px-2 py-1.5">{d.expiryDate ?? "—"}</td>
                      <td className="px-2 py-1.5">
                        {d.errors.map((e, i) => <div key={i} style={{ color: "var(--ch-fail)" }}>{e}</div>)}
                        {!d.errors.length && <span style={{ color: "var(--ch-pass)" }}>Ready</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleImport}
              disabled={busy || includedProfileCount === 0}
              className="rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
              style={{ background: "var(--ch-navy)" }}
            >
              {busy ? "Importing…" : `Import ${includedProfileCount} profile${includedProfileCount === 1 ? "" : "s"} and ${includedDocumentCount} document${includedDocumentCount === 1 ? "" : "s"}`}
            </button>
            {unresolvedRequiredCount > 0 && (
              <span className="text-xs" style={{ color: "#b45309" }}>
                {unresolvedRequiredCount} unmatched name{unresolvedRequiredCount === 1 ? "" : "s"} still unresolved above — those rows will import without a job role / document type link until you choose one.
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
