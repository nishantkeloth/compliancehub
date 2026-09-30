"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
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

// The review tables below used to render every parsed row as its own <tr>
// with no limit — fine for a few hundred rows, but a workbook with a large
// Documents tab (thousands of rows) turned that into thousands of DOM
// nodes rendered at once, which is what made the tab itself unresponsive/
// crash rather than the app showing a graceful error. Paginating what's
// actually rendered keeps the DOM bounded regardless of file size; the
// underlying data (and the Include checkboxes' state) still covers every
// row, only what's drawn on screen is limited.
const PAGE_SIZE = 200;

// Below this size, also parse the file locally (client-side) purely to
// show a friendlier progress log before the authoritative server parse.
// Above it, skip that local parse entirely — it's cosmetic, and doing a
// full SheetJS parse of a large workbook twice (once here, once on the
// server) in the same tab is itself a way to hang/crash on a big file.
const LOCAL_PREVIEW_MAX_BYTES = 6 * 1024 * 1024;

// The commit step used to send every included row to
// commitCrewRegisterImport in a single request — on a big import that's
// both a timeout risk and gives no visibility into progress while it runs.
// Committing in small batches instead means each request finishes quickly,
// and lets the panel show which employee it's currently on at the bottom
// of the screen instead of one opaque "Importing…" spinner.
const IMPORT_CHUNK_SIZE = 10;

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
  const [logLines, setLogLines] = useState<string[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<CrewRegisterPreview | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set()); // keys: "p:<rowNumber>" / "d:<rowNumber>"
  const [jobRoleResolutions, setJobRoleResolutions] = useState<Record<string, Resolution>>({});
  const [documentTypeResolutions, setDocumentTypeResolutions] = useState<Record<string, Resolution>>({});
  const [result, setResult] = useState<CommitResult | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [profilePage, setProfilePage] = useState(0);
  const [documentPage, setDocumentPage] = useState(0);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number; name: string; code: string } | null>(null);

  function reset() {
    setPreview(null);
    setExcluded(new Set());
    setJobRoleResolutions({});
    setDocumentTypeResolutions({});
    setResult(null);
    setError(null);
    setLogLines([]);
    setProfilePage(0);
    setDocumentPage(0);
    setImportProgress(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function log(line: string) {
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setLogLines((prev) => [...prev, `${time}  ${line}`]);
  }

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    setResult(null);
    setLogLines([]);
    log(`Selected "${file.name}" (${(file.size / 1024).toFixed(0)} KB).`);
    log("Reading file…");

    // Parsing/matching happens in one request on the server, so there's no
    // real per-row progress signal to show. What we CAN do without waiting
    // on the server: read the file locally first (the same "xlsx" library,
    // loaded on demand) to get a real record count and log each step as it
    // happens, so the panel reads like an activity log instead of a single
    // status line that could be stuck or just slow — indistinguishable
    // before this change. This never blocks or changes the actual upload
    // below; if the local read fails for any reason it's silently skipped.
    const timers: ReturnType<typeof setTimeout>[] = [];
    let recordCount: number | null = null;
    if (file.size > LOCAL_PREVIEW_MAX_BYTES) {
      // Large file — skip the local double-parse entirely (see
      // LOCAL_PREVIEW_MAX_BYTES above) and go straight to the server.
      log("Large file — sending straight to server for validation and column matching…");
      timers.push(setTimeout(() => log("Still working — a large file can take a minute or two on the first pass…"), 8000));
      timers.push(setTimeout(() => log("Still going — automatic column matching on a large file can take a couple of minutes…"), 25000));
    } else {
      try {
        const XLSX = await import("xlsx");
        const bytes = new Uint8Array(await file.arrayBuffer());
        const wb = XLSX.read(bytes, { type: "array" });
        log(`Opened workbook — sheets: ${wb.SheetNames.join(", ") || "(none)"}.`);
        let bestSheet = wb.SheetNames[0] ?? "";
        let bestRows = 0;
        for (const name of wb.SheetNames) {
          const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null }) as unknown[][];
          if (rows.length > bestRows) {
            bestRows = rows.length;
            bestSheet = name;
          }
        }
        recordCount = Math.max(bestRows - 1, 0);
        const plural = recordCount === 1 ? "record" : "records";
        log(`Found ${recordCount} ${plural} in sheet "${bestSheet}".`);
        log("Sending to server — validating fields and matching job roles/document types against Crew Setup…");
        timers.push(
          setTimeout(() => log(`Still working on ${recordCount} ${plural} — automatic column matching can take up to a minute on larger files…`), 8000)
        );
        timers.push(setTimeout(() => log("Still going — a first-time automatic column match on a large file can take a couple of minutes…"), 25000));
      } catch {
        log("Sending to server for validation and column matching…");
        timers.push(setTimeout(() => log("Still working — this can take up to a minute on larger files…"), 8000));
        timers.push(setTimeout(() => log("Still going — a first-time automatic column match on a large file can take a couple of minutes…"), 25000));
      }
    }

    const fd = new FormData();
    fd.append("file", file);
    const res = await parseCrewRegisterFile(fd);
    for (const t of timers) clearTimeout(t);
    setBusy(false);
    if ("error" in res) {
      log(`Failed: ${res.error}`);
      setError(res.error);
      return;
    }
    log(`Done — ${res.preview.profiles.length} profile row(s) and ${res.preview.documents.length} document row(s) ready to review.`);
    setPreview(res.preview);
    setProfilePage(0);
    setDocumentPage(0);
    // Default-exclude rows that already carry blocking errors.
    const ex = new Set<string>();
    for (const p of res.preview.profiles) if (p.errors.length) ex.add(`p:${p.rowNumber}`);
    for (const d of res.preview.documents) if (d.errors.length) ex.add(`d:${d.rowNumber}`);
    setExcluded(ex);
  }

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [logLines]);

  const profileErrorCount = preview?.profiles.filter((p) => p.errors.length).length ?? 0;
  const profileWarningCount = preview?.profiles.filter((p) => !p.errors.length && p.warnings.length).length ?? 0;
  const profileUpdateMatchCount = preview?.profiles.filter((p) => !p.errors.length && p.action === "update").length ?? 0;
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
  const includedUpdateCount = preview
    ? preview.profiles.filter((p) => p.action === "update" && !p.errors.length && !excluded.has(`p:${p.rowNumber}`)).length
    : 0;
  const includedNewCount = includedProfileCount - includedUpdateCount;

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
          action: p.action,
          matchedId: p.matchedId,
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
          customFields: d.customFields,
        };
      });

    setBusy(true);
    setImportProgress(null);
    startTransition(async () => {
      const total = profiles.length;
      const aggregate: CommitResult = {
        createdProfiles: 0,
        updatedProfiles: 0,
        createdDocuments: 0,
        updatedDocuments: 0,
        errors: [],
        profiles: [],
        documents: [],
      };

      for (let i = 0; i < profiles.length; i += IMPORT_CHUNK_SIZE) {
        const chunkProfiles = profiles.slice(i, i + IMPORT_CHUNK_SIZE);
        const chunkCodes = new Set(chunkProfiles.map((p) => p.employeeCode.toLowerCase()));
        const chunkDocuments = documents.filter((d) => chunkCodes.has(d.employeeCode.toLowerCase()));
        const last = chunkProfiles[chunkProfiles.length - 1];
        setImportProgress({
          current: Math.min(i + chunkProfiles.length, total),
          total,
          name: last.fullName,
          code: last.employeeCode,
        });

        const res = await commitCrewRegisterImport(JSON.stringify({ profiles: chunkProfiles, documents: chunkDocuments }));
        if ("error" in res) {
          setBusy(false);
          setImportProgress(null);
          setError(res.error);
          if (aggregate.profiles.length || aggregate.documents.length) setResult(aggregate);
          return;
        }
        aggregate.createdProfiles += res.result.createdProfiles;
        aggregate.updatedProfiles += res.result.updatedProfiles;
        aggregate.createdDocuments += res.result.createdDocuments;
        aggregate.updatedDocuments += res.result.updatedDocuments;
        aggregate.errors.push(...res.result.errors);
        aggregate.profiles.push(...res.result.profiles);
        aggregate.documents.push(...res.result.documents);
      }

      setBusy(false);
      setImportProgress(null);
      setResult(aggregate);
      router.refresh();
    });
  }

  async function downloadResult() {
    if (!result) return;
    setDownloading(true);
    try {
      const XLSX = await import("xlsx");
      const profileRows = result.profiles.map((p) => ({
        "Employee Code": p.employeeCode,
        "Crew Code": p.crewCode ?? "",
        "Full Name": p.fullName,
        "Job Role": p.jobRoleName ?? "",
        "Employment Status": p.employmentStatus,
        Nationality: p.nationality ?? "",
        Phone: p.phone ?? "",
        Email: p.email ?? "",
        "Home Country": p.homeCountry ?? "",
        "Joining Date": p.joiningDate ?? "",
        Result: p.status === "created" ? "Created" : p.status === "updated" ? "Updated (already existed)" : "Failed",
        "Error (if any)": p.error ?? "",
      }));
      const documentRows = result.documents.map((d) => ({
        "Employee Code": d.employeeCode,
        "Document Type": d.documentTypeName ?? "",
        "Document Number": d.documentNumber ?? "",
        "Issue Date": d.issueDate ?? "",
        "Expiry Date": d.expiryDate ?? "",
        Result: d.status === "created" ? "Created" : d.status === "updated" ? "Updated (already existed)" : "Failed",
        "Error (if any)": d.error ?? "",
      }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(profileRows), "Crew Profiles");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(documentRows), "Documents");
      XLSX.writeFile(wb, `crew-register-import-result-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } finally {
      setDownloading(false);
    }
  }

  function toggleExclude(key: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function Pager({ page, setPage, total }: { page: number; setPage: (n: number) => void; total: number }) {
    const pageCount = Math.max(Math.ceil(total / PAGE_SIZE), 1);
    if (total <= PAGE_SIZE) return null;
    const start = page * PAGE_SIZE + 1;
    const end = Math.min((page + 1) * PAGE_SIZE, total);
    return (
      <div className="flex items-center gap-2 px-4 py-2 text-xs" style={{ color: "var(--ch-sub)" }}>
        <button
          onClick={() => setPage(Math.max(page - 1, 0))}
          disabled={page === 0}
          className="rounded border px-2 py-1 font-semibold disabled:opacity-40"
          style={{ borderColor: "var(--ch-line)" }}
        >
          ← Prev
        </button>
        <span>
          Showing {start}–{end} of {total} (page {page + 1} of {pageCount})
        </span>
        <button
          onClick={() => setPage(Math.min(page + 1, pageCount - 1))}
          disabled={page >= pageCount - 1}
          className="rounded border px-2 py-1 font-semibold disabled:opacity-40"
          style={{ borderColor: "var(--ch-line)" }}
        >
          Next →
        </button>
      </div>
    );
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
          {logLines.length > 0 && (
            <div
              className="mt-3 rounded-lg border p-3 text-xs font-mono space-y-1 max-h-48 overflow-y-auto"
              style={{ borderColor: "var(--ch-line)", background: "#fafafa", color: "var(--ch-sub)" }}
            >
              {logLines.map((line, i) => (
                <div key={i} className={i === logLines.length - 1 && busy ? "font-semibold" : undefined} style={i === logLines.length - 1 && busy ? { color: "var(--ch-navy)" } : undefined}>
                  {line}
                </div>
              ))}
              {busy && <div className="animate-pulse">…</div>}
              <div ref={logEndRef} />
            </div>
          )}
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
            Crew profiles: created <b>{result.createdProfiles}</b>, updated <b>{result.updatedProfiles}</b> (matched to an
            existing profile — not created twice).
          </p>
          <p className="text-sm mb-1">
            Documents: created <b>{result.createdDocuments}</b>, updated <b>{result.updatedDocuments}</b>.
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
          <div className="flex items-center gap-2 mt-4">
            <button
              onClick={downloadResult}
              disabled={downloading}
              className="rounded-lg px-4 py-2 text-sm font-semibold border disabled:opacity-50"
              style={{ borderColor: "var(--ch-line)", color: "var(--ch-navy)" }}
            >
              {downloading ? "Preparing…" : "Download imported data (.xlsx)"}
            </button>
            <button onClick={reset} className="rounded-lg px-4 py-2 text-sm font-semibold text-white" style={{ background: "var(--ch-navy)" }}>
              Import another file
            </button>
          </div>
          <p className="text-xs mt-2" style={{ color: "var(--ch-sub)" }}>
            Every row from this import — including the new Crew Code, and any that failed with a reason — so you can check it against the original file.
          </p>
        </div>
      )}

      {preview && !result && (
        <>
          <div className={`${cardCls} p-4 flex flex-wrap items-center gap-3`} style={cardStyle}>
            <span className="text-sm font-semibold" style={{ color: "var(--ch-navy)" }}>{preview.sourceFilename}</span>
            {pill(`${preview.profiles.length} profiles`, "var(--ch-navy-soft, #eef1f6)", "var(--ch-navy)")}
            {profileErrorCount > 0 && pill(`${profileErrorCount} blocked`, "var(--ch-fail-bg)", "var(--ch-fail)")}
            {profileUpdateMatchCount > 0 && pill(`${profileUpdateMatchCount} match existing crew — will update`, "var(--ch-pass-bg)", "var(--ch-pass)")}
            {profileWarningCount > 0 && pill(`${profileWarningCount} warnings`, "#fef3e2", "#b45309")}
            {pill(`${preview.documents.length} documents`, "var(--ch-navy-soft, #eef1f6)", "var(--ch-navy)")}
            {docErrorCount > 0 && pill(`${docErrorCount} blocked`, "var(--ch-fail-bg)", "var(--ch-fail)")}
            <button onClick={reset} className="ml-auto text-xs font-semibold underline" style={{ color: "var(--ch-sub)" }}>
              Start over
            </button>
          </div>

          {preview.usedAiMapping && preview.mappingSummary && preview.mappingSummary.length > 0 && (
            <div className="rounded-xl p-4 border" style={{ background: "#fef3e2", borderColor: "#f3d9a8" }}>
              <div className="text-sm font-semibold mb-1" style={{ color: "#b45309" }}>Columns were matched automatically</div>
              <ul className="text-xs space-y-1 list-disc pl-4" style={{ color: "#92400e" }}>
                {preview.mappingSummary.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>
          )}

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
                {preview.profiles.slice(profilePage * PAGE_SIZE, (profilePage + 1) * PAGE_SIZE).map((p) => {
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
            <Pager page={profilePage} setPage={setProfilePage} total={preview.profiles.length} />
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
                  <th className="text-left px-2 py-2">Custom fields</th>
                  <th className="text-left px-2 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.documents.slice(documentPage * PAGE_SIZE, (documentPage + 1) * PAGE_SIZE).map((d) => {
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
                        {d.customFields && Object.keys(d.customFields).length
                          ? Object.entries(d.customFields).map(([k, v]) => (
                              <div key={k}>
                                {k.replace(/_/g, " ")}: {v}
                              </div>
                            ))
                          : "—"}
                      </td>
                      <td className="px-2 py-1.5">
                        {d.errors.map((e, i) => <div key={i} style={{ color: "var(--ch-fail)" }}>{e}</div>)}
                        {d.warnings.map((w, i) => <div key={i} style={{ color: "#b45309" }}>{w}</div>)}
                        {!d.errors.length && !d.warnings.length && <span style={{ color: "var(--ch-pass)" }}>Ready</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pager page={documentPage} setPage={setDocumentPage} total={preview.documents.length} />
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleImport}
              disabled={busy || includedProfileCount === 0}
              className="rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
              style={{ background: "var(--ch-navy)" }}
            >
              {busy
                ? "Importing…"
                : `Import ${includedProfileCount} profile${includedProfileCount === 1 ? "" : "s"} (${includedNewCount} new, ${includedUpdateCount} update${includedUpdateCount === 1 ? "" : "s"}) and ${includedDocumentCount} document${includedDocumentCount === 1 ? "" : "s"}`}
            </button>
            {unresolvedRequiredCount > 0 && (
              <span className="text-xs" style={{ color: "#b45309" }}>
                {unresolvedRequiredCount} unmatched name{unresolvedRequiredCount === 1 ? "" : "s"} still unresolved above — those rows will import without a job role / document type link until you choose one.
              </span>
            )}
          </div>

          {busy && importProgress && (
            <div
              className={`${cardCls} px-4 py-3 flex items-center gap-2 text-sm`}
              style={cardStyle}
            >
              <span className="animate-pulse font-semibold" style={{ color: "var(--ch-navy)" }}>
                Processing {importProgress.current} of {importProgress.total}
              </span>
              <span style={{ color: "var(--ch-sub)" }}>
                — {importProgress.name} ({importProgress.code})
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
