"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  matchDocumentFolders,
  classifyDocumentFolder,
  commitDocumentIntakeFolder,
  type FolderMatch,
  type ClassifiedFile,
} from "../document-intake-actions";

const inputCls = "border rounded-lg px-2.5 py-1.5 text-xs";
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

type MasterData = { crew: { id: string; fullName: string; employeeCode: string | null }[]; documentTypes: { id: string; name: string }[] };

type FileRowState = {
  filename: string;
  classified: ClassifiedFile | null;
  include: boolean;
  documentTypeId: string; // "" = unresolved, or a real id
  newDocumentTypeName: string | null;
  documentNumber: string;
  issueDate: string;
  expiryDate: string;
};

type FolderState = {
  folderName: string;
  files: File[];
  crewId: string | null;
  crewLabel: string | null;
  score: number;
  status: "idle" | "classifying" | "classified" | "error" | "committing" | "committed";
  error?: string;
  rows: FileRowState[];
  commitErrors?: string[];
  attached?: number;
};

function relativeFolderName(file: File): string {
  const rel = (file as unknown as { webkitRelativePath?: string }).webkitRelativePath || file.name;
  const parts = rel.split("/").filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : "(ungrouped)";
}

function rowFromClassified(c: ClassifiedFile): FileRowState {
  const hasName = !!c.documentTypeName;
  return {
    filename: c.filename,
    classified: c,
    include: !c.error && hasName,
    documentTypeId: c.mapping?.targetId ?? "",
    newDocumentTypeName: !c.mapping?.targetId && hasName ? c.documentTypeName : null,
    documentNumber: c.documentNumber ?? "",
    issueDate: c.issueDate ?? "",
    expiryDate: c.expiryDate ?? "",
  };
}

export default function DocumentIntakePanel() {
  const router = useRouter();
  const dirInputRef = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [folders, setFolders] = useState<FolderState[] | null>(null);
  const [master, setMaster] = useState<MasterData | null>(null);
  const [phase, setPhase] = useState<"select" | "matched" | "reviewing" | "done">("select");

  function attachDirAttrs(el: HTMLInputElement | null) {
    if (el) {
      el.setAttribute("webkitdirectory", "");
      el.setAttribute("directory", "");
    }
  }

  function reset() {
    setFolders(null);
    setMaster(null);
    setPhase("select");
    setError(null);
    if (dirInputRef.current) dirInputRef.current.value = "";
  }

  async function handleFolderSelect(fileList: FileList) {
    setError(null);
    const grouped = new Map<string, File[]>();
    for (const file of Array.from(fileList)) {
      const name = relativeFolderName(file);
      if (name === "(ungrouped)") continue; // files dropped at the top level aren't attributable to anyone
      if (!grouped.has(name)) grouped.set(name, []);
      grouped.get(name)!.push(file);
    }
    if (grouped.size === 0) {
      setError("No per-crew-member subfolders found — select the parent folder that contains one folder per crew member.");
      return;
    }

    setBusy(true);
    const summaries = [...grouped.entries()].map(([folderName, files]) => ({ folderName, fileCount: files.length }));
    const res = await matchDocumentFolders(summaries);
    setBusy(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    const byName = new Map(res.matches.map((m) => [m.folderName, m]));
    const next: FolderState[] = [...grouped.entries()].map(([folderName, files]) => {
      const m: FolderMatch | undefined = byName.get(folderName);
      return {
        folderName,
        files,
        crewId: m?.crewId ?? null,
        crewLabel: m?.crewFullName ? `${m.crewFullName}${m.crewEmployeeCode ? ` (${m.crewEmployeeCode})` : ""}` : null,
        score: m?.score ?? 0,
        status: "idle",
        rows: [],
      };
    });
    setFolders(next);
    setMaster(res.masterData);
    setPhase("matched");
  }

  function setFolderCrew(folderName: string, crewId: string) {
    setFolders((prev) =>
      (prev ?? []).map((f) => {
        if (f.folderName !== folderName) return f;
        const c = master?.crew.find((x) => x.id === crewId) ?? null;
        return { ...f, crewId: crewId || null, crewLabel: c ? `${c.fullName}${c.employeeCode ? ` (${c.employeeCode})` : ""}` : null, score: 1 };
      })
    );
  }

  async function classifyAll() {
    if (!folders) return;
    setBusy(true);
    setError(null);
    for (const f of folders) {
      if (!f.crewId) continue;
      setFolders((prev) => (prev ?? []).map((x) => (x.folderName === f.folderName ? { ...x, status: "classifying" } : x)));
      const fd = new FormData();
      for (const file of f.files) fd.append("files", file);
      const res = await classifyDocumentFolder(f.crewId, fd);
      setFolders((prev) =>
        (prev ?? []).map((x) => {
          if (x.folderName !== f.folderName) return x;
          if ("error" in res) return { ...x, status: "error", error: res.error };
          return { ...x, status: "classified", rows: res.files.map(rowFromClassified) };
        })
      );
    }
    setBusy(false);
    setPhase("reviewing");
  }

  function updateRow(folderName: string, filename: string, patch: Partial<FileRowState>) {
    setFolders((prev) =>
      (prev ?? []).map((f) => (f.folderName !== folderName ? f : { ...f, rows: f.rows.map((r) => (r.filename === filename ? { ...r, ...patch } : r)) }))
    );
  }

  async function importAll() {
    if (!folders) return;
    setBusy(true);
    setError(null);
    for (const f of folders) {
      const included = f.rows.filter((r) => r.include && (r.documentTypeId || r.newDocumentTypeName));
      if (!f.crewId || included.length === 0) continue;
      setFolders((prev) => (prev ?? []).map((x) => (x.folderName === f.folderName ? { ...x, status: "committing" } : x)));
      const fd = new FormData();
      for (const file of f.files) if (included.some((r) => r.filename === file.name)) fd.append("files", file);
      const manifest = included.map((r) => ({
        filename: r.filename,
        documentTypeId: r.documentTypeId || null,
        newDocumentTypeName: r.documentTypeId ? null : r.newDocumentTypeName,
        documentNumber: r.documentNumber || null,
        issueDate: r.issueDate || null,
        expiryDate: r.expiryDate || null,
        confidence: r.classified?.confidence ?? null,
      }));
      const res = await commitDocumentIntakeFolder(f.crewId, JSON.stringify(manifest), fd);
      setFolders((prev) =>
        (prev ?? []).map((x) => {
          if (x.folderName !== f.folderName) return x;
          if ("error" in res) return { ...x, status: "error", error: res.error };
          return { ...x, status: "committed", attached: res.result.attached, commitErrors: res.result.errors };
        })
      );
    }
    setBusy(false);
    setPhase("done");
    router.refresh();
  }

  const unmatchedFolderCount = folders ? folders.filter((f) => !f.crewId).length : 0;
  const totalAttached = folders ? folders.reduce((n, f) => n + (f.attached ?? 0), 0) : 0;
  const totalCommitErrors = folders ? folders.flatMap((f) => f.commitErrors ?? []) : [];

  return (
    <div className="space-y-5">
      {phase === "select" && (
        <div className={`${cardCls} p-5`} style={cardStyle}>
          <label className="text-xs font-semibold block mb-2" style={{ color: "var(--ch-navy)" }}>
            Documents folder
          </label>
          <input
            ref={(el) => {
              dirInputRef.current = el;
              attachDirAttrs(el);
            }}
            type="file"
            multiple
            disabled={busy}
            onChange={(e) => {
              if (e.target.files && e.target.files.length) void handleFolderSelect(e.target.files);
            }}
            className="text-sm"
          />
          {busy && <p className="text-xs mt-3" style={{ color: "var(--ch-sub)" }}>Matching folders to crew members…</p>}
        </div>
      )}

      {error && (
        <div className="rounded-lg px-4 py-3 text-sm" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>
          {error}
        </div>
      )}

      {folders && phase === "matched" && (
        <>
          <div className={`${cardCls} p-4`} style={cardStyle}>
            <div className="text-sm font-semibold mb-1" style={{ color: "var(--ch-navy)" }}>Match each folder to a crew member</div>
            <p className="text-xs mb-3" style={{ color: "var(--ch-sub)" }}>
              {folders.length} folder{folders.length === 1 ? "" : "s"} found. Fix any that matched the wrong person, or pick one for folders with no confident match, before reading the files inside.
            </p>
            <div className="space-y-1.5">
              {folders.map((f) => (
                <div key={f.folderName} className="flex items-center gap-2 text-sm">
                  <span className="w-52 truncate" title={f.folderName}>{f.folderName}</span>
                  <span className="text-xs w-16" style={{ color: "var(--ch-sub)" }}>{f.files.length} file{f.files.length === 1 ? "" : "s"}</span>
                  <select className={inputCls} style={inputStyle} value={f.crewId ?? ""} onChange={(e) => setFolderCrew(f.folderName, e.target.value)}>
                    <option value="">— no match, choose one —</option>
                    {master?.crew.map((c) => (
                      <option key={c.id} value={c.id}>{c.fullName}{c.employeeCode ? ` (${c.employeeCode})` : ""}</option>
                    ))}
                  </select>
                  {!f.crewId && pill("unmatched", "var(--ch-fail-bg)", "var(--ch-fail)")}
                  {f.crewId && f.score >= 0.999 && pill("matched", "var(--ch-pass-bg, #dcfce7)", "var(--ch-pass, #15803d)")}
                  {f.crewId && f.score < 0.999 && pill("best guess", "#fef3e2", "#b45309")}
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={classifyAll}
              disabled={busy || folders.every((f) => !f.crewId)}
              className="rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
              style={{ background: "var(--ch-navy)" }}
            >
              {busy ? "Reading files…" : `Read & classify files (${folders.filter((f) => f.crewId).length} folder${folders.filter((f) => f.crewId).length === 1 ? "" : "s"})`}
            </button>
            {unmatchedFolderCount > 0 && (
              <span className="text-xs" style={{ color: "#b45309" }}>
                {unmatchedFolderCount} unmatched folder{unmatchedFolderCount === 1 ? "" : "s"} will be skipped unless you pick someone.
              </span>
            )}
          </div>
        </>
      )}

      {folders && (phase === "reviewing" || phase === "done") && (
        <>
          {phase === "done" && (
            <div className={`${cardCls} p-5`} style={cardStyle}>
              <div className="text-sm font-semibold mb-2" style={{ color: "var(--ch-navy)" }}>Import complete</div>
              <p className="text-sm mb-1">
                Attached <b>{totalAttached}</b> document{totalAttached === 1 ? "" : "s"} across {folders.filter((f) => f.attached).length} crew member{folders.filter((f) => f.attached).length === 1 ? "" : "s"}.
              </p>
              {totalCommitErrors.length > 0 && (
                <div className="mt-3">
                  <div className="text-xs font-semibold mb-1" style={{ color: "var(--ch-fail)" }}>{totalCommitErrors.length} problem{totalCommitErrors.length === 1 ? "" : "s"}:</div>
                  <ul className="text-xs list-disc pl-4 space-y-0.5" style={{ color: "var(--ch-sub)" }}>
                    {totalCommitErrors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              )}
              <button onClick={reset} className="mt-4 rounded-lg px-4 py-2 text-sm font-semibold text-white" style={{ background: "var(--ch-navy)" }}>
                Import another batch
              </button>
            </div>
          )}

          {folders.filter((f) => f.status === "classified" || f.status === "committing" || f.status === "committed").map((f) => (
            <div key={f.folderName} className={`${cardCls} overflow-x-auto`} style={cardStyle}>
              <div className="px-4 pt-4 flex items-center gap-2">
                <span className="text-sm font-semibold" style={{ color: "var(--ch-navy)" }}>{f.crewLabel ?? f.folderName}</span>
                <span className="text-xs" style={{ color: "var(--ch-sub)" }}>({f.folderName})</span>
                {f.status === "committed" && pill(`${f.attached ?? 0} attached`, "var(--ch-pass-bg, #dcfce7)", "var(--ch-pass, #15803d)")}
              </div>
              <table className="text-xs w-full mt-2">
                <thead>
                  <tr style={{ color: "var(--ch-sub)" }}>
                    <th className="text-left px-4 py-2">Include</th>
                    <th className="text-left px-2 py-2">File</th>
                    <th className="text-left px-2 py-2">Document Type</th>
                    <th className="text-left px-2 py-2">Number</th>
                    <th className="text-left px-2 py-2">Issue</th>
                    <th className="text-left px-2 py-2">Expiry</th>
                    <th className="text-left px-2 py-2">Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {f.rows.map((r) => {
                    const locked = phase === "done" || f.status === "committing" || f.status === "committed";
                    const canResolve = !!r.documentTypeId || !!r.newDocumentTypeName;
                    return (
                      <tr key={r.filename} style={{ borderTop: "1px solid var(--ch-line)", opacity: locked && !r.include ? 0.5 : 1 }}>
                        <td className="px-4 py-1.5">
                          <input
                            type="checkbox"
                            disabled={locked || !canResolve}
                            checked={r.include}
                            onChange={(e) => updateRow(f.folderName, r.filename, { include: e.target.checked })}
                          />
                        </td>
                        <td className="px-2 py-1.5 max-w-[160px] truncate" title={r.filename}>{r.filename}</td>
                        <td className="px-2 py-1.5">
                          <select
                            className={inputCls}
                            style={inputStyle}
                            disabled={locked}
                            value={r.documentTypeId}
                            onChange={(e) => {
                              const v = e.target.value;
                              updateRow(f.folderName, r.filename, { documentTypeId: v, newDocumentTypeName: v ? null : r.newDocumentTypeName });
                            }}
                          >
                            <option value="">
                              {r.newDocumentTypeName ? `+ Create "${r.newDocumentTypeName}"` : "— unresolved —"}
                            </option>
                            {master?.documentTypes.map((d) => (
                              <option key={d.id} value={d.id}>{d.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-1.5">
                          <input className={inputCls} style={{ ...inputStyle, width: 110 }} disabled={locked} value={r.documentNumber} onChange={(e) => updateRow(f.folderName, r.filename, { documentNumber: e.target.value })} />
                        </td>
                        <td className="px-2 py-1.5">
                          <input type="date" className={inputCls} style={{ ...inputStyle, width: 130 }} disabled={locked} value={r.issueDate} onChange={(e) => updateRow(f.folderName, r.filename, { issueDate: e.target.value })} />
                        </td>
                        <td className="px-2 py-1.5">
                          <input type="date" className={inputCls} style={{ ...inputStyle, width: 130 }} disabled={locked} value={r.expiryDate} onChange={(e) => updateRow(f.folderName, r.filename, { expiryDate: e.target.value })} />
                        </td>
                        <td className="px-2 py-1.5">{Math.round((r.classified?.confidence ?? 0) * 100)}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}

          {folders.some((f) => f.status === "error") && (
            <div className="rounded-lg px-4 py-3 text-sm" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>
              {folders.filter((f) => f.status === "error").map((f) => (
                <div key={f.folderName}>{f.folderName}: {f.error}</div>
              ))}
            </div>
          )}

          {phase === "reviewing" && (
            <div className="flex items-center gap-3">
              <button
                onClick={importAll}
                disabled={busy}
                className="rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
                style={{ background: "var(--ch-navy)" }}
              >
                {busy ? "Importing…" : "Import checked documents"}
              </button>
              <button onClick={reset} disabled={busy} className="text-xs font-semibold underline" style={{ color: "var(--ch-sub)" }}>
                Start over
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
