"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  matchDocumentFolders,
  createBulkIntakeJob,
  addBulkIntakeJobFiles,
  startBulkIntakeJob,
  getBulkIntakeJobStatus,
  finalizeBulkIntakeJob,
  commitDocumentIntakeFolder,
  logBulkIntakeReview,
  type FolderMatch,
  type ClassifiedFile,
  type BulkIntakeJobItemStatus,
  type ReviewLogEntry,
} from "../document-intake-actions";

const inputCls = "border rounded-lg px-2.5 py-1.5 text-xs";
const inputStyle = { borderColor: "var(--ch-line)" };
const cardCls = "bg-white border rounded-xl";
const cardStyle = { borderColor: "var(--ch-line)" };

// A folder can hold up to MAX_FILES_PER_FOLDER (40, server-side) files, and
// both classifyDocumentFolder and commitDocumentIntakeFolder used to get
// every one of them in a single request — one big multipart upload, then a
// sequential AI call per file inside one server action invocation. A large
// folder pushed that past the request body size limit (25MB, next.config.ts
// serverActions.bodySizeLimit) and/or the platform's function timeout,
// which is what "crashed" the import. Sending files in small batches
// instead — bounded by count AND total size — means each request does a
// bounded amount of work, a slow/failed batch doesn't lose progress
// already made on earlier ones, and the panel can show real progress
// instead of one long silent wait.
const CHUNK_MAX_FILES = 5;
const CHUNK_MAX_BYTES = 15 * 1024 * 1024; // stay well under the 25MB body limit, leaving room for multipart overhead

// commitDocumentIntakeFolder does far more per file than the classify-
// upload step above (a version-number lookup, two duplicate checks, the
// storage upload itself, an insert, and an update — several sequential
// Supabase round trips per file, not just one storage write), so 5 files
// in one request can run long enough to hit the platform's function
// timeout even with maxDuration raised on the page (see
// app/team/bulk-intake/document-intake/page.tsx — some hosting plans cap
// that regardless of what's requested). A timed-out request comes back
// as a platform error page, not a normal app error, which is what
// produces the generic "An unexpected response was received from the
// server" message. A smaller batch here trades a few more requests for
// a much larger safety margin under that ceiling.
const COMMIT_CHUNK_MAX_FILES = 2;

// Phase 16d — how often the panel checks in on a background classify job.
// getBulkIntakeJobStatus is cheap (a couple of indexed selects), and this
// is only ever polled while this one admin's tab has this one job open,
// so there's no real cost to checking fairly often.
const JOB_POLL_INTERVAL_MS = 1500;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A folder could get stuck forever mid-upload/mid-poll with no error ever
// shown — the panel just sat on "Uploading N of M files…" indefinitely —
// whenever one of these server-action calls itself threw or never settled
// (a dropped connection, a function that was killed without responding,
// a parse error on a malformed response) rather than cleanly resolving to
// an `{ error }` value. Nothing downstream was wrapped in try/catch, so
// the thrown/pending promise just stalled the async function in place:
// `busy` stayed true, the row's progress label never updated, and there
// was no way out except reloading the page. withTimeout() bounds every
// such call so a genuine hang surfaces as a real, actionable error within
// NETWORK_TIMEOUT_MS instead of spinning forever; classifyOneFolder/
// classifyAll/importAll below also now wrap their loops in try/catch so a
// thrown error (timeout or otherwise) always lands on that folder's
// "error" status and always clears `busy`, rather than leaving the whole
// panel stuck.
const NETWORK_TIMEOUT_MS = 60_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} is taking too long (over ${Math.round(ms / 1000)}s) — check your connection and try again.`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong — please try again.";
}

function batchFiles(files: File[], maxCount: number, maxBytes: number): File[][] {
  const batches: File[][] = [];
  let current: File[] = [];
  let currentBytes = 0;
  for (const file of files) {
    if (current.length > 0 && (current.length >= maxCount || currentBytes + file.size > maxBytes)) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(file);
    currentBytes += file.size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

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
  // Only ever set by the reviewer explicitly choosing "+ Create new
  // document type" below — never pre-filled from the AI's raw guess.
  // That guess (when there was one and it didn't match anything
  // configured) is kept separately in unmatchedGuess, purely as a
  // hint shown in the dropdown's placeholder text.
  newDocumentTypeName: string | null;
  notApplicable: boolean; // AI positively said: not a compliance document / nothing configured fits
  unmatchedGuess: string | null; // AI named a type but it isn't one of this company's configured ones
  documentNumber: string;
  issueDate: string;
  expiryDate: string;
  // Phase 16d — while a row's file is still sitting in the background
  // job's queue (not yet picked up by the worker, or picked up but not
  // finished), classified is null for a reason other than an error: it
  // just hasn't been read yet. Left undefined for rows built the old
  // way (rowFromClassified, still used for the done/error cases), which
  // always have a real result by the time they exist.
  itemStatus?: "pending" | "processing" | "done" | "error";
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
  commitWarnings?: string[];
  attached?: number;
  // Set while classifying/committing in batches, so the panel can show
  // "N of M files" instead of one long, silent wait.
  progressLabel?: string;
  // Phase 16d — the background job backing this folder's classify pass,
  // once createBulkIntakeJob has returned one. Carried through so
  // importAll can finalize (clean up staging + mark completed) it once
  // review/import finishes.
  jobId?: string;
};

function relativeFolderName(file: File): string {
  const rel = (file as unknown as { webkitRelativePath?: string }).webkitRelativePath || file.name;
  const parts = rel.split("/").filter(Boolean);
  // parts[0] is the folder the user selected itself; parts[1] is the crew
  // member's own subfolder immediately under it — group every file by
  // that name, no matter how many levels it's nested beneath (a crew
  // folder split into per-document-type subfolders, e.g.
  // "<Crew Name>/Training Certificate/file.pdf", is just as valid as one
  // flat "<Crew Name>/file.pdf" folder — both attribute to the same
  // person). Using the file's *immediate* parent instead (the old
  // parts[parts.length - 2]) broke exactly that case: a file one level
  // deeper had its document-type folder picked up as the "crew folder",
  // not the crew member's own folder above it.
  return parts.length >= 3 ? parts[1] : "(ungrouped)";
}

function rowFromClassified(c: ClassifiedFile): FileRowState {
  const matchedExisting = !!c.mapping?.targetId;
  return {
    filename: c.filename,
    classified: c,
    // Only auto-included when the AI matched one of this company's
    // actually-configured document types — never on an unresolved
    // guess, and never on "not applicable". Those two require a human
    // to look and decide, so they start unchecked.
    include: !c.error && matchedExisting,
    documentTypeId: c.mapping?.targetId ?? "",
    newDocumentTypeName: null,
    notApplicable: c.notApplicable,
    unmatchedGuess: !matchedExisting && !c.notApplicable ? c.documentTypeName : null,
    documentNumber: c.documentNumber ?? "",
    issueDate: c.issueDate ?? "",
    expiryDate: c.expiryDate ?? "",
    itemStatus: "done",
  };
}

// Phase 16d — builds a row straight from a job item's current state,
// whether or not the worker has gotten to it yet. Once classified is
// set, this is identical to rowFromClassified; until then it's an inert
// placeholder (unchecked, unresolved, nothing to edit) that just carries
// the filename and a status the table uses to show "reading…" instead
// of a confusing empty dropdown.
function rowFromJobItem(item: BulkIntakeJobItemStatus): FileRowState {
  if (item.classified) return { ...rowFromClassified(item.classified), itemStatus: item.status };
  if (item.status === "error") {
    return {
      ...rowFromClassified({
        filename: item.filename,
        mapping: null,
        documentTypeName: null,
        notApplicable: false,
        documentNumber: null,
        issueDate: null,
        expiryDate: null,
        confidence: 0,
        error: item.error ?? "Failed to read this file.",
        warnings: [],
      }),
      itemStatus: "error",
    };
  }
  return {
    filename: item.filename,
    classified: null,
    include: false,
    documentTypeId: "",
    newDocumentTypeName: null,
    notApplicable: false,
    unmatchedGuess: null,
    documentNumber: "",
    issueDate: "",
    expiryDate: "",
    itemStatus: item.status,
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

  // Phase 16d — classify now runs as a background job instead of the
  // browser driving a sequential AI call per file itself: upload the
  // folder's files to the job once (still chunked for the same body-size
  // reason as before), start it, then poll its status until the worker
  // has worked through every file. The AI calls themselves now happen
  // server-side in app/api/bulk-intake/process-job/route.ts and survive
  // this tab closing partway through — closing the tab just means
  // nobody's watching the progress bar for a while; reopening Bulk Data
  // Migration later and re-selecting the same folder re-matches it, and
  // a still-running job for that crew member picks up from wherever the
  // worker got to (see getBulkIntakeJobStatus's self-heal check).
  async function classifyOneFolder(f: FolderState) {
    if (!f.crewId) return;
    const crewId = f.crewId;
    setFolders((prev) => (prev ?? []).map((x) => (x.folderName === f.folderName ? { ...x, status: "classifying", rows: [], error: undefined } : x)));

    try {
      const createRes = await withTimeout(createBulkIntakeJob(crewId, f.folderName), NETWORK_TIMEOUT_MS, "Starting the job");
      if ("error" in createRes) {
        setFolders((prev) => (prev ?? []).map((x) => (x.folderName === f.folderName ? { ...x, status: "error", error: createRes.error } : x)));
        return;
      }
      const jobId = createRes.jobId;
      setFolders((prev) => (prev ?? []).map((x) => (x.folderName === f.folderName ? { ...x, jobId } : x)));

      const batches = batchFiles(f.files, CHUNK_MAX_FILES, CHUNK_MAX_BYTES);
      let uploaded = 0;
      for (const chunk of batches) {
        uploaded += chunk.length;
        const label = `Uploading ${uploaded} of ${f.files.length} files…`;
        setFolders((prev) => (prev ?? []).map((x) => (x.folderName === f.folderName ? { ...x, progressLabel: label } : x)));
        const fd = new FormData();
        for (const file of chunk) fd.append("files", file);
        const res = await withTimeout(addBulkIntakeJobFiles(jobId, fd), NETWORK_TIMEOUT_MS, "Uploading files");
        if ("error" in res) {
          setFolders((prev) => (prev ?? []).map((x) => (x.folderName === f.folderName ? { ...x, status: "error", error: res.error, progressLabel: undefined } : x)));
          return;
        }
      }

      const startRes = await withTimeout(startBulkIntakeJob(jobId), NETWORK_TIMEOUT_MS, "Starting classification");
      if ("error" in startRes) {
        setFolders((prev) => (prev ?? []).map((x) => (x.folderName === f.folderName ? { ...x, status: "error", error: startRes.error, progressLabel: undefined } : x)));
        return;
      }

      // Poll until the worker's classified every file (or given up).
      for (;;) {
        const status = await withTimeout(getBulkIntakeJobStatus(jobId), NETWORK_TIMEOUT_MS, "Checking progress");
        // BulkIntakeJobStatus itself carries a job-level `error` field
        // (string | null), so "error" in status is true for both shapes —
        // `items` is the only field unique to the success shape, so that's
        // the actual discriminant here.
        if (!("items" in status)) {
          setFolders((prev) => (prev ?? []).map((x) => (x.folderName === f.folderName ? { ...x, status: "error", error: status.error ?? undefined, progressLabel: undefined } : x)));
          return;
        }
        const rows = status.items.map(rowFromJobItem);
        const label = status.status === "processing" ? `Reading ${status.processedFiles} of ${status.totalFiles} files…` : undefined;
        setFolders((prev) => (prev ?? []).map((x) => (x.folderName === f.folderName ? { ...x, rows, progressLabel: label } : x)));

        if (status.status === "awaiting_review") {
          setFolders((prev) => (prev ?? []).map((x) => (x.folderName === f.folderName ? { ...x, status: "classified", progressLabel: undefined } : x)));
          return;
        }
        if (status.status === "failed" || status.status === "cancelled") {
          setFolders((prev) =>
            (prev ?? []).map((x) => (x.folderName === f.folderName ? { ...x, status: "error", error: status.error ?? "This job stopped before finishing.", progressLabel: undefined } : x))
          );
          return;
        }
        await sleep(JOB_POLL_INTERVAL_MS);
      }
    } catch (err) {
      // Anything that threw rather than resolved to an `{ error }` value —
      // a dropped connection, a timed-out call above, a killed serverless
      // function — lands here instead of leaving this folder's row stuck
      // on its last progress label forever.
      setFolders((prev) => (prev ?? []).map((x) => (x.folderName === f.folderName ? { ...x, status: "error", error: errorMessage(err), progressLabel: undefined } : x)));
    }
  }

  async function classifyAll() {
    if (!folders) return;
    setBusy(true);
    setError(null);
    try {
      for (const f of folders) {
        if (!f.crewId) continue;
        // classifyOneFolder catches its own errors onto that folder's row —
        // this outer try/finally exists so a bug there that somehow still
        // throws can't also strand every folder after it in "classifying".
        await classifyOneFolder(f);
      }
    } finally {
      setBusy(false);
      setPhase("reviewing");
    }
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
    try {
      for (const f of folders) {
        await importOneFolder(f);
      }
    } finally {
      setBusy(false);
      setPhase("done");
      router.refresh();
    }
  }

  async function importOneFolder(f: FolderState) {
    // Folders that were never classified (unmatched, skipped) have no
    // rows and nothing to log; a classified folder goes through the
    // commit step below regardless of whether anything in it ended up
    // checked, so there's always exactly one review-log entry written
    // per reviewed file — included or not.
    if (!f.crewId || f.rows.length === 0) return;
    const included = f.rows.filter((r) => r.include && (r.documentTypeId || r.newDocumentTypeName));
    setFolders((prev) => (prev ?? []).map((x) => (x.folderName === f.folderName ? { ...x, status: "committing" } : x)));

    let totalAttached = 0;
    const allErrors: string[] = [];
    const allWarnings: string[] = [];

    try {
      if (included.length > 0) {
        // Upload/commit in small batches too — same reasoning as
        // classifyAll above. A failed batch is recorded as an error for
        // that batch and the loop moves on, so documents already
        // attached from earlier batches in this folder are never lost.
        const includedFiles = f.files.filter((file) => included.some((r) => r.filename === file.name));
        const fileBatches = batchFiles(includedFiles, COMMIT_CHUNK_MAX_FILES, CHUNK_MAX_BYTES);
        let doneCount = 0;
        for (const chunk of fileBatches) {
          doneCount += chunk.length;
          const label = `Uploading ${doneCount} of ${includedFiles.length} files…`;
          setFolders((prev) => (prev ?? []).map((x) => (x.folderName === f.folderName ? { ...x, progressLabel: label } : x)));
          const chunkRows = included.filter((r) => chunk.some((file) => file.name === r.filename));
          const fd = new FormData();
          for (const file of chunk) fd.append("files", file);
          const manifest = chunkRows.map((r) => ({
            filename: r.filename,
            documentTypeId: r.documentTypeId || null,
            newDocumentTypeName: r.documentTypeId ? null : r.newDocumentTypeName,
            documentNumber: r.documentNumber || null,
            issueDate: r.issueDate || null,
            expiryDate: r.expiryDate || null,
            confidence: r.classified?.confidence ?? null,
            // Only meaningful when the reviewer picked an existing type
            // for a row the AI guessed but couldn't match on its own —
            // see the alias-learning block in commitDocumentIntakeFolder.
            aiGuessedName: r.unmatchedGuess && r.documentTypeId ? r.unmatchedGuess : null,
          }));
          const res = await withTimeout(commitDocumentIntakeFolder(f.crewId, JSON.stringify(manifest), fd), NETWORK_TIMEOUT_MS, "Importing files");
          if ("error" in res) {
            allErrors.push(`Batch of ${chunk.length} file(s): ${res.error}`);
          } else {
            totalAttached += res.result.attached;
            allErrors.push(...res.result.errors);
            allWarnings.push(...res.result.warnings);
          }
          setFolders((prev) =>
            (prev ?? []).map((x) => (x.folderName === f.folderName ? { ...x, attached: totalAttached, commitErrors: allErrors, commitWarnings: allWarnings } : x))
          );
        }
      }

      // One audit entry per reviewed file in this folder — what the AI
      // proposed and what the reviewer actually decided — whether or not
      // that file ended up attached. Logging failures are surfaced as a
      // warning, never as a reason to treat the import itself as failed.
      const logEntries: ReviewLogEntry[] = f.rows.map((r) => ({
        filename: r.filename,
        aiDocumentTypeName: r.classified?.documentTypeName ?? null,
        aiNotApplicable: r.notApplicable,
        aiDocumentNumber: r.classified?.documentNumber ?? null,
        aiIssueDate: r.classified?.issueDate ?? null,
        aiExpiryDate: r.classified?.expiryDate ?? null,
        aiConfidence: r.classified?.confidence ?? null,
        included: r.include,
        finalDocumentTypeId: r.documentTypeId || null,
        finalNewDocumentTypeName: r.documentTypeId ? null : r.newDocumentTypeName,
        finalDocumentNumber: r.documentNumber || null,
        finalIssueDate: r.issueDate || null,
        finalExpiryDate: r.expiryDate || null,
      }));
      const logRes = await withTimeout(logBulkIntakeReview(f.crewId, f.folderName, logEntries), NETWORK_TIMEOUT_MS, "Saving the review log");
      if ("error" in logRes) {
        allWarnings.push(`Review log wasn't saved for this folder: ${logRes.error}`);
        setFolders((prev) =>
          (prev ?? []).map((x) => (x.folderName === f.folderName ? { ...x, commitWarnings: [...(x.commitWarnings ?? []), ...allWarnings.slice(-1)] } : x))
        );
      }

      // Phase 16d — the background job behind this folder (if any; a
      // folder classified before this feature shipped, or re-reviewed
      // from a fresh tab, may not have one) has nothing left to do once
      // review/import is finished. This clears its staged files and
      // marks it completed rather than leaving it sitting there looking
      // like unfinished work.
      if (f.jobId) await withTimeout(finalizeBulkIntakeJob(f.jobId), NETWORK_TIMEOUT_MS, "Finishing up the job");

      setFolders((prev) =>
        (prev ?? []).map((x) => (x.folderName === f.folderName ? { ...x, status: "committed", progressLabel: undefined } : x))
      );
    } catch (err) {
      // Same reasoning as classifyOneFolder's catch — a thrown error
      // (dropped connection, a timeout from withTimeout above) used to
      // leave this folder stuck on "committing" forever with importAll
      // never reaching setBusy(false). Record what was attached so far
      // (earlier batches in this folder aren't lost) and let the import
      // move on to the next folder instead of hanging the whole panel.
      allErrors.push(errorMessage(err));
      setFolders((prev) =>
        (prev ?? []).map((x) =>
          x.folderName === f.folderName ? { ...x, status: "committed", attached: totalAttached, commitErrors: allErrors, commitWarnings: allWarnings, progressLabel: undefined } : x
        )
      );
    }
  }

  const unmatchedFolderCount = folders ? folders.filter((f) => !f.crewId).length : 0;
  const totalAttached = folders ? folders.reduce((n, f) => n + (f.attached ?? 0), 0) : 0;
  const totalCommitErrors = folders ? folders.flatMap((f) => f.commitErrors ?? []) : [];
  const totalCommitWarnings = folders ? folders.flatMap((f) => f.commitWarnings ?? []) : [];

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
                  <span className="w-52 truncate font-medium" style={{ color: "var(--ch-navy)" }} title={f.folderName}>{f.folderName}</span>
                  <span className="text-xs w-16" style={{ color: "#4b5563" }}>{f.files.length} file{f.files.length === 1 ? "" : "s"}</span>
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

      {folders && (phase === "reviewing" || phase === "done" || (phase === "matched" && busy)) && (
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
              {totalCommitWarnings.length > 0 && (
                <div className="mt-3">
                  <div className="text-xs font-semibold mb-1" style={{ color: "#b45309" }}>
                    {totalCommitWarnings.length} warning{totalCommitWarnings.length === 1 ? "" : "s"} — attached, but worth a look:
                  </div>
                  <ul className="text-xs list-disc pl-4 space-y-0.5" style={{ color: "#92400e" }}>
                    {totalCommitWarnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </div>
              )}
              <button onClick={reset} className="mt-4 rounded-lg px-4 py-2 text-sm font-semibold text-white" style={{ background: "var(--ch-navy)" }}>
                Import another batch
              </button>
            </div>
          )}

          {folders.filter((f) => f.status === "classifying" || f.status === "classified" || f.status === "committing" || f.status === "committed").map((f) => (
            <div key={f.folderName} className={`${cardCls} overflow-x-auto`} style={cardStyle}>
              <div className="px-4 pt-4 flex items-center gap-2">
                <span className="text-sm font-semibold" style={{ color: "var(--ch-navy)" }}>{f.crewLabel ?? f.folderName}</span>
                <span className="text-xs" style={{ color: "var(--ch-sub)" }}>({f.folderName})</span>
                {f.status === "committed" && pill(`${f.attached ?? 0} attached`, "var(--ch-pass-bg, #dcfce7)", "var(--ch-pass, #15803d)")}
                {f.progressLabel && (
                  <span className="text-xs font-semibold animate-pulse" style={{ color: "var(--ch-navy)" }}>{f.progressLabel}</span>
                )}
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
                    <th className="text-left px-2 py-2">Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {f.rows.map((r) => {
                    const locked = phase === "done" || f.status === "committing" || f.status === "committed";
                    const creatingNew = r.newDocumentTypeName !== null;
                    const canResolve = !!r.documentTypeId || (creatingNew && !!r.newDocumentTypeName?.trim());
                    // Phase 16d — still sitting in the background job's
                    // queue, not read yet. Show that plainly instead of
                    // an empty "— unresolved —" dropdown that looks like
                    // a classification result rather than a non-result.
                    const notYetRead = (r.itemStatus === "pending" || r.itemStatus === "processing") && !r.classified;
                    return (
                      <tr key={r.filename} style={{ borderTop: "1px solid var(--ch-line)", opacity: locked && !r.include ? 0.5 : notYetRead ? 0.6 : 1 }}>
                        <td className="px-4 py-1.5">
                          <input
                            type="checkbox"
                            disabled={locked || !canResolve}
                            checked={r.include}
                            onChange={(e) => updateRow(f.folderName, r.filename, { include: e.target.checked })}
                          />
                        </td>
                        <td className="px-2 py-1.5 max-w-[160px] truncate" style={{ color: "var(--ch-ink, #171717)" }} title={r.filename}>{r.filename}</td>
                        {notYetRead ? (
                          <>
                            <td className="px-2 py-1.5 italic animate-pulse" style={{ color: "var(--ch-sub)" }} colSpan={5}>
                              {r.itemStatus === "processing" ? "Reading…" : "Queued…"}
                            </td>
                          </>
                        ) : (
                        <>
                        <td className="px-2 py-1.5">
                          <select
                            className={inputCls}
                            style={inputStyle}
                            disabled={locked}
                            value={creatingNew ? "__new__" : r.documentTypeId}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v === "__new__") {
                                // Deliberate human action, not an AI default — the
                                // AI's own guess (if it had one) is offered below
                                // only as a pre-fill suggestion the reviewer can
                                // edit or clear, never auto-created on its own.
                                updateRow(f.folderName, r.filename, { documentTypeId: "", newDocumentTypeName: r.unmatchedGuess ?? "" });
                              } else {
                                updateRow(f.folderName, r.filename, { documentTypeId: v, newDocumentTypeName: null });
                              }
                            }}
                          >
                            <option value="">
                              {r.notApplicable
                                ? "Not a recognized document — excluded"
                                : r.unmatchedGuess
                                  ? `No match for "${r.unmatchedGuess}" — review`
                                  : "— unresolved —"}
                            </option>
                            {master?.documentTypes.map((d) => (
                              <option key={d.id} value={d.id}>{d.name}</option>
                            ))}
                            <option value="__new__">+ Create new document type…</option>
                          </select>
                          {creatingNew && (
                            <input
                              className={inputCls}
                              style={{ ...inputStyle, display: "block", marginTop: 4, width: 150 }}
                              disabled={locked}
                              placeholder="New type name"
                              value={r.newDocumentTypeName ?? ""}
                              onChange={(e) => updateRow(f.folderName, r.filename, { newDocumentTypeName: e.target.value })}
                            />
                          )}
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
                        <td className="px-2 py-1.5">
                          {!!r.classified?.warnings?.length && (
                            <span
                              className="text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5 whitespace-nowrap cursor-help"
                              style={{ background: "#fef3c7", color: "#92400e" }}
                              title={r.classified.warnings.join("\n")}
                            >
                              {r.classified.warnings.length === 1 ? "1 flag" : `${r.classified.warnings.length} flags`}
                            </span>
                          )}
                        </td>
                        </>
                        )}
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
