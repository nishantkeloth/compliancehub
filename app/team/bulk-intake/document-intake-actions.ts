"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveAccess, can } from "@/lib/rbac";
import { sha256Hex, checkDuplicateFile, checkDuplicateDocumentNumber, validateDocumentDates } from "@/lib/documents/checks";
import { classifyOneFile, loadClassifyContext, type ClassifiedFile } from "@/lib/documents/bulk-classify";

// Bulk Data Migration — Bulk Document Intake, phase 2 of the flow shown in
// the Crew Data Migration Flow diagram. Given a folder tree (one
// subfolder per crew member, files inside it), matches each folder to an
// existing crew_profiles row by name, then reads and classifies each file
// with AI — same per-document reading primitive as the "Auto-read" button
// on a crew member's Documents tab (app/crew/profiles/document-ai-actions.ts's
// readDocumentFields), just without an expected type to compare against,
// since here the type itself is unknown going in.
//
// Kept deliberately per-folder rather than one call for the whole batch:
// each classifyDocumentFolder call runs one sequential AI read per file in
// that folder (typically a handful), which stays comfortably inside a
// serverless function's time budget. A folder with dozens of crew members
// is many small calls from the client, not one huge one from the server.
//
// Attach mechanics mirror uploadCrewDocumentVersion in
// app/crew/profiles/actions.ts exactly (same storage path shape, same
// insert-only crew_document_versions pattern, same crew_documents sync)
// so a bulk-attached file is indistinguishable in every other screen from
// one a person uploaded by hand — only source: 'ai_upload' marks it.

const MAX_FOLDERS = 300;
const MAX_FILES_PER_FOLDER = 40;
const MAX_DOCUMENT_FILE_BYTES = 20 * 1024 * 1024;

async function requireBulkDocumentAccess() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "crew.bulk_intake.manage")) throw new Error("Bulk Data Migration is restricted to company admins.");
  if (!can(access, "crew.documents.manage")) throw new Error("You don't have permission to manage crew documents.");
  if (!can(access, "crew.view")) throw new Error("You don't have permission to view crew profiles.");
  if (!access.orgId) throw new Error("No company context.");
  return { supabase, access, userId: user.id, orgId: access.orgId };
}

/* ---- local helpers (deliberately not exported from lib/ai/mapping.ts —
   same small-local-duplicate pattern already used in intake-actions.ts and
   document-ai-actions.ts for the same reason: one caller, not worth
   widening that module's exports) ---- */
function normName(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9/ ]+/g, " ").replace(/\s+/g, " ").trim();
}
function nameTokens(s: string) {
  return new Set(normName(s).split(" ").filter((t) => t.length > 1 && !["the", "and", "of", "for", "a", "an"].includes(t)));
}
function nameSimilarity(a: string, b: string) {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.max(ta.size, tb.size);
}
function sanitizeFileName(name: string) {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, "_");
  return cleaned.slice(-120) || "file";
}

/* ================= folder → crew matching ================= */

export type FolderMatch = {
  folderName: string;
  fileCount: number;
  crewId: string | null;
  crewFullName: string | null;
  crewEmployeeCode: string | null;
  score: number;
};

export async function matchDocumentFolders(
  folders: { folderName: string; fileCount: number }[]
): Promise<
  | {
      matches: FolderMatch[];
      masterData: { crew: { id: string; fullName: string; employeeCode: string | null }[]; documentTypes: { id: string; name: string }[] };
    }
  | { error: string }
> {
  const { supabase, orgId } = await requireBulkDocumentAccess();
  if (folders.length === 0) return { error: "No folders found — select the top-level documents folder (with one subfolder per crew member)." };
  if (folders.length > MAX_FOLDERS) return { error: `That's more than ${MAX_FOLDERS} folders in one batch — split it up.` };

  const [crewRes, dtRes] = await Promise.all([
    supabase.from("crew_profiles").select("id, full_name, employee_code").eq("org_id", orgId).order("full_name"),
    supabase.from("document_types").select("id, name").eq("org_id", orgId).eq("is_active", true).order("name"),
  ]);
  const crew = (crewRes.data ?? []) as { id: string; full_name: string; employee_code: string | null }[];

  const matches: FolderMatch[] = folders.map(({ folderName, fileCount }) => {
    const codeHit = crew.find((c) => c.employee_code && c.employee_code.trim().toLowerCase() === folderName.trim().toLowerCase());
    if (codeHit) {
      return { folderName, fileCount, crewId: codeHit.id, crewFullName: codeHit.full_name, crewEmployeeCode: codeHit.employee_code, score: 1 };
    }
    let best: { c: (typeof crew)[number]; score: number } | null = null;
    for (const c of crew) {
      const s = nameSimilarity(folderName, c.full_name);
      if (s > (best?.score ?? 0)) best = { c, score: s };
    }
    if (best && best.score >= 0.6) {
      return { folderName, fileCount, crewId: best.c.id, crewFullName: best.c.full_name, crewEmployeeCode: best.c.employee_code, score: best.score };
    }
    return { folderName, fileCount, crewId: null, crewFullName: null, crewEmployeeCode: null, score: best?.score ?? 0 };
  });

  return {
    matches,
    masterData: {
      crew: crew.map((c) => ({ id: c.id, fullName: c.full_name, employeeCode: c.employee_code })),
      documentTypes: dtRes.data ?? [],
    },
  };
}

/* ================= per-folder classification ================= */
//
// The actual per-file logic (AI classify + Phase 16c's pre-commit
// checks) lives in lib/documents/bulk-classify.ts now, shared with the
// background worker (app/api/bulk-intake/process-job/route.ts) added in
// Phase 16d below — see that file's header for why. classifyDocumentFolder
// stays as a synchronous, same-request path: still used for a small
// folder opened for a quick re-check, where waiting for a background job
// to spin up would be slower than just doing the handful of files inline.

export type { ClassifiedFile } from "@/lib/documents/bulk-classify";

export async function classifyDocumentFolder(crewId: string, formData: FormData): Promise<{ files: ClassifiedFile[] } | { error: string }> {
  const { supabase, orgId, userId } = await requireBulkDocumentAccess();

  const { data: crewRow } = await supabase
    .from("crew_profiles")
    .select("id, full_name, nationality, date_of_birth")
    .eq("id", crewId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!crewRow) return { error: "Crew member not found." };

  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { error: "No files for this folder." };
  if (files.length > MAX_FILES_PER_FOLDER) return { error: `This folder has more than ${MAX_FILES_PER_FOLDER} files — split it up.` };

  const { ctx, documentTypes, documentTypeNames, aliases } = await loadClassifyContext(supabase, orgId);
  if (!ctx.settings.ai_enabled) return { error: "AI features are disabled for this company (Administration → AI Settings)." };
  const maxBytes = ctx.settings.max_upload_mb * 1024 * 1024;
  for (const f of files) if (f.size > maxBytes || f.size > MAX_DOCUMENT_FILE_BYTES) return { error: `"${f.name}" is larger than the ${Math.min(ctx.settings.max_upload_mb, MAX_DOCUMENT_FILE_BYTES / 1024 / 1024)} MB limit.` };

  const results: ClassifiedFile[] = [];
  for (const file of files) {
    results.push(await classifyOneFile(supabase, ctx, orgId, userId, crewId, crewRow, documentTypes, documentTypeNames, aliases, file));
  }

  return { files: results };
}

/* ================= background jobs (Phase 16d) ================= */
//
// The classify step above runs entirely in the request that calls it —
// fine for a folder of a few files, but it's exactly the thing that
// breaks if a large folder takes longer than the browser tab stays
// open. These three actions move that step onto a durable, server-owned
// job instead: createBulkIntakeJob uploads the raw files once (to the
// private bulk-intake-staging bucket) and writes one bulk_intake_jobs
// row + one bulk_intake_job_items row per file, then kicks off the
// worker route (app/api/bulk-intake/process-job/route.ts) which works
// through them in the background and writes each file's ClassifiedFile
// result straight into its job_items row. getBulkIntakeJobStatus is what
// the panel polls — it also doubles as a self-healing check: if a job
// claims to be "processing" but hasn't heartbeat in a while (the worker's
// self-chaining fetch died somewhere — a cold start, a deploy, a crashed
// invocation), this re-fires the worker right here before replying,
// rather than waiting for the once-a-day watchdog cron to notice.
//
// Deliberately NOT extended to the commit/import step — that stays
// exactly as it is today, human-gated, reading from a completed job's
// items instead of in-memory state. See the Phase 16d plan doc.

const MAX_JOB_FILES = 500; // generous headroom over a single synchronous folder's 40-file cap
const STALE_HEARTBEAT_MS = 2 * 60 * 1000;

function workerUrl() {
  // VERCEL_URL is the deployment's own hostname, always set in a Vercel
  // runtime (preview or production) — building the worker's own fetch
  // target from it rather than a hardcoded domain means this keeps
  // working across preview deployments without any env var to maintain.
  // NEXT_PUBLIC_SITE_URL is checked first in case a canonical custom
  // domain is ever configured there for some other reason.
  const base = process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) || "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/api/bulk-intake/process-job`;
}

// Fire-and-forget on purpose — the caller (createBulkIntakeJob, or the
// self-heal check in getBulkIntakeJobStatus) must not wait on the worker
// actually finishing a whole job's worth of files; it just needs the
// chain started. INTERNAL_JOB_SECRET is the same shared-secret pattern
// as CRON_SECRET on the existing cron route, just reused here since this
// is also a server-to-server call with no user session.
function kickWorker(jobId: string) {
  const secret = process.env.INTERNAL_JOB_SECRET;
  fetch(workerUrl(), {
    method: "POST",
    headers: { "content-type": "application/json", ...(secret ? { authorization: `Bearer ${secret}` } : {}) },
    body: JSON.stringify({ jobId }),
  }).catch(() => {
    // Nothing to do with a failed kick here — the stale-heartbeat check
    // in getBulkIntakeJobStatus (and the daily watchdog cron) will
    // notice the job never advanced and re-kick it.
  });
}

export type BulkIntakeJobItemStatus = {
  id: string;
  filename: string;
  status: "pending" | "processing" | "done" | "error";
  error: string | null;
  classified: ClassifiedFile | null;
};

export type BulkIntakeJobStatus = {
  id: string;
  folderName: string;
  status: "pending" | "processing" | "awaiting_review" | "completed" | "failed" | "cancelled";
  totalFiles: number;
  processedFiles: number;
  error: string | null;
  items: BulkIntakeJobItemStatus[];
};

// Splitting job creation into three steps (create → add files, possibly
// several times → start) rather than one call, for the same reason
// classifyAll/importAll already chunk their own calls (see
// CHUNK_MAX_FILES/CHUNK_MAX_BYTES in document-intake-panel.tsx): a
// folder's files have to cross the same ~25MB server-action body limit
// to get here at all, so a large folder is several addBulkIntakeJobFiles
// calls against one job, not one call that itself exceeds the limit.
// The job is only kicked to "processing" once every batch has actually
// landed in staging, so total_files (and the worker's view of "is there
// anything still pending") is always accurate by the time it starts.
export async function createBulkIntakeJob(crewId: string, folderName: string): Promise<{ jobId: string } | { error: string }> {
  const { supabase, orgId, userId } = await requireBulkDocumentAccess();
  const { data: crewRow } = await supabase.from("crew_profiles").select("id").eq("id", crewId).eq("org_id", orgId).maybeSingle();
  if (!crewRow) return { error: "Crew member not found." };

  const { data: job, error } = await supabase
    .from("bulk_intake_jobs")
    .insert({ org_id: orgId, crew_id: crewId, folder_name: folderName, status: "pending", created_by: userId })
    .select("id")
    .single();
  if (error) return { error: error.message };
  return { jobId: job!.id as string };
}

export async function addBulkIntakeJobFiles(jobId: string, formData: FormData): Promise<{ added: number } | { error: string }> {
  const { supabase, orgId } = await requireBulkDocumentAccess();
  const { data: job } = await supabase.from("bulk_intake_jobs").select("id, status, total_files").eq("id", jobId).eq("org_id", orgId).maybeSingle();
  if (!job) return { error: "Job not found." };
  if (job.status !== "pending") return { error: "This job has already started processing — can't add more files to it." };

  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { error: "No files in this batch." };
  for (const f of files) if (f.size > MAX_DOCUMENT_FILE_BYTES) return { error: `"${f.name}" is larger than the ${Math.round(MAX_DOCUMENT_FILE_BYTES / 1024 / 1024)} MB limit.` };

  const startIndex = job.total_files as number;
  if (startIndex + files.length > MAX_JOB_FILES) return { error: `This folder has more than ${MAX_JOB_FILES} files — split it up.` };

  const itemRows: { org_id: string; job_id: string; filename: string; storage_path: string; content_type: string | null; file_size_bytes: number }[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const storagePath = `${orgId}/${jobId}/${startIndex + i}-${sanitizeFileName(file.name)}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { error: upErr } = await supabase.storage.from("bulk-intake-staging").upload(storagePath, bytes, { contentType: file.type || "application/octet-stream" });
    if (upErr) return { error: `Upload failed for "${file.name}": ${upErr.message}` };
    itemRows.push({ org_id: orgId, job_id: jobId, filename: file.name, storage_path: storagePath, content_type: file.type || null, file_size_bytes: file.size });
  }

  const { error: itemsErr } = await supabase.from("bulk_intake_job_items").insert(itemRows);
  if (itemsErr) return { error: itemsErr.message };

  await supabase.from("bulk_intake_jobs").update({ total_files: startIndex + files.length }).eq("id", jobId);
  return { added: files.length };
}

export async function startBulkIntakeJob(jobId: string): Promise<{ ok: true } | { error: string }> {
  const { supabase, orgId } = await requireBulkDocumentAccess();
  const { data: job } = await supabase.from("bulk_intake_jobs").select("id, total_files").eq("id", jobId).eq("org_id", orgId).maybeSingle();
  if (!job) return { error: "Job not found." };
  if (!job.total_files) return { error: "No files were uploaded for this job." };

  await supabase.from("bulk_intake_jobs").update({ status: "processing", last_heartbeat_at: new Date().toISOString() }).eq("id", jobId);
  kickWorker(jobId);
  return { ok: true };
}

export async function getBulkIntakeJobStatus(jobId: string): Promise<BulkIntakeJobStatus | { error: string }> {
  const { supabase, orgId } = await requireBulkDocumentAccess();

  const { data: jobRow } = await supabase.from("bulk_intake_jobs").select("*").eq("id", jobId).eq("org_id", orgId).maybeSingle();
  if (!jobRow) return { error: "Job not found." };

  if (jobRow.status === "processing") {
    const heartbeatAge = Date.now() - new Date(jobRow.last_heartbeat_at).getTime();
    if (heartbeatAge > STALE_HEARTBEAT_MS) kickWorker(jobId);
  }

  const { data: itemRows } = await supabase
    .from("bulk_intake_job_items")
    .select("id, filename, status, error, classified")
    .eq("job_id", jobId)
    .order("created_at", { ascending: true });

  return {
    id: jobRow.id,
    folderName: jobRow.folder_name,
    status: jobRow.status,
    totalFiles: jobRow.total_files,
    processedFiles: jobRow.processed_files,
    error: jobRow.error,
    items: (itemRows ?? []).map((r: { id: string; filename: string; status: string; error: string | null; classified: ClassifiedFile | null }) => ({
      id: r.id,
      filename: r.filename,
      status: r.status as BulkIntakeJobItemStatus["status"],
      error: r.error,
      classified: r.classified,
    })),
  };
}

// Called once the reviewer finishes importing from an awaiting_review
// job (successfully or not — see importAll() in document-intake-panel.tsx),
// so a finished job doesn't sit around looking actionable forever. Also
// cleans up its staged files now that crew_document_versions (for
// anything actually attached) and bulk_intake_review_log (for the record
// of the whole review) already have everything worth keeping.
export async function finalizeBulkIntakeJob(jobId: string): Promise<{ ok: true } | { error: string }> {
  const { supabase, orgId } = await requireBulkDocumentAccess();
  const { data: jobRow } = await supabase.from("bulk_intake_jobs").select("id").eq("id", jobId).eq("org_id", orgId).maybeSingle();
  if (!jobRow) return { error: "Job not found." };

  const { data: items } = await supabase.from("bulk_intake_job_items").select("storage_path").eq("job_id", jobId);
  const paths = (items ?? []).map((r: { storage_path: string }) => r.storage_path);
  if (paths.length) await supabase.storage.from("bulk-intake-staging").remove(paths);

  await supabase.from("bulk_intake_jobs").update({ status: "completed" }).eq("id", jobId);
  return { ok: true };
}

/* ================= commit ================= */

type CommitFileEntry = {
  filename: string;
  documentTypeId: string | null;
  newDocumentTypeName: string | null;
  documentNumber: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  confidence: number | null;
  // Phase 16c — set only when the AI guessed a type name during
  // classification that didn't match any configured type AND the
  // reviewer then manually picked an existing type for that row (not
  // "+ Create new"). That combination means the reviewer just taught
  // the system what the AI's guess actually means, so it's worth
  // remembering — see the alias-learning block below.
  aiGuessedName: string | null;
};

export type FolderCommitResult = { attached: number; errors: string[]; warnings: string[] };

export async function commitDocumentIntakeFolder(crewId: string, manifestJson: string, formData: FormData): Promise<{ result: FolderCommitResult } | { error: string }> {
  const { supabase, access, userId, orgId } = await requireBulkDocumentAccess();
  let manifest: CommitFileEntry[];
  try {
    manifest = JSON.parse(manifestJson);
  } catch {
    return { error: "Invalid payload." };
  }
  if (!manifest.length) return { error: "Nothing to attach — every file was excluded." };

  const { data: crewRow } = await supabase.from("crew_profiles").select("id").eq("id", crewId).eq("org_id", orgId).maybeSingle();
  if (!crewRow) return { error: "Crew member not found." };
  if (!can(access, "crew.documents.manage")) return { error: "You don't have permission to manage crew documents." };

  const filesByName = new Map<string, File>();
  for (const f of formData.getAll("files")) if (f instanceof File) filesByName.set(f.name, f);

  const docTypeCache = new Map<string, string>();
  const crewDocumentCache = new Map<string, string>(); // documentTypeId -> crew_documents.id
  const errors: string[] = [];
  const warnings: string[] = [];
  let attached = 0;

  for (const entry of manifest) {
    const file = filesByName.get(entry.filename);
    if (!file) {
      errors.push(`${entry.filename}: file missing from upload.`);
      continue;
    }
    try {
      const dateCheck = validateDocumentDates(entry.issueDate, entry.expiryDate);
      if (dateCheck.errors.length) throw new Error(dateCheck.errors.join(" "));
      for (const w of dateCheck.warnings) warnings.push(`${entry.filename}: ${w}`);

      const documentTypeId =
        entry.documentTypeId ??
        (entry.newDocumentTypeName
          ? await (async () => {
              const key = entry.newDocumentTypeName!.trim().toLowerCase();
              if (docTypeCache.has(key)) return docTypeCache.get(key)!;
              const { data: found } = await supabase.from("document_types").select("id").eq("org_id", orgId).ilike("name", entry.newDocumentTypeName!.trim()).maybeSingle();
              if (found) {
                docTypeCache.set(key, found.id as string);
                return found.id as string;
              }
              const { data, error } = await supabase
                .from("document_types")
                .insert({ org_id: orgId, name: entry.newDocumentTypeName!.trim(), category: "certificate", tracks_number: true, created_by: userId })
                .select("id")
                .single();
              if (error) throw new Error(`Could not create document type "${entry.newDocumentTypeName}": ${error.message}`);
              docTypeCache.set(key, data!.id as string);
              return data!.id as string;
            })()
          : null);
      if (!documentTypeId) {
        errors.push(`${entry.filename}: no document type resolved.`);
        continue;
      }

      // Alias learning — only when the reviewer resolved an AI guess
      // that didn't match anything by picking an EXISTING type (not
      // creating a new one). Ignore the insert error on purpose: the
      // unique index on (org_id, entity_type, lower(alias)) means a
      // duplicate from an earlier file in this same batch, or an
      // earlier import, is expected and harmless — same pattern as the
      // existing alias-learning in intake-actions.ts / matrices/ai-actions.ts.
      if (entry.aiGuessedName && entry.documentTypeId) {
        await supabase
          .from("ai_name_aliases")
          .insert({ org_id: orgId, entity_type: "document_type", alias: entry.aiGuessedName.trim(), target_id: entry.documentTypeId, created_by: userId });
      }

      let crewDocumentId = crewDocumentCache.get(documentTypeId);
      if (!crewDocumentId) {
        // .maybeSingle() throws if more than one active crew_documents row
        // already matches (a crew member with two "Passport" rows on file,
        // for instance — not rare, since this same crew+type match used to
        // have no dedup at all before this existed). Order + limit(1)
        // instead, so an ambiguous match still resolves to "update the
        // most recent one" rather than failing the whole file.
        const { data: existingDocs, error: existingErr } = await supabase
          .from("crew_documents")
          .select("id")
          .eq("org_id", orgId)
          .eq("crew_id", crewId)
          .eq("document_type_id", documentTypeId)
          .eq("is_active", true)
          .order("created_at", { ascending: false })
          .limit(1);
        if (existingErr) throw new Error(existingErr.message);
        const existingDoc = existingDocs?.[0] ?? null;
        if (existingDoc) {
          crewDocumentId = existingDoc.id as string;
        } else {
          const { data: newDoc, error: newDocErr } = await supabase
            .from("crew_documents")
            .insert({
              org_id: orgId,
              crew_id: crewId,
              document_type_id: documentTypeId,
              document_number: entry.documentNumber,
              issue_date: entry.issueDate,
              expiry_date: entry.expiryDate,
              created_by: userId,
              updated_by: userId,
            })
            .select("id")
            .single();
          if (newDocErr) throw new Error(newDocErr.message);
          crewDocumentId = newDoc!.id as string;
        }
        crewDocumentCache.set(documentTypeId, crewDocumentId);
      }

      const { data: latest } = await supabase
        .from("crew_document_versions")
        .select("version_number")
        .eq("crew_document_id", crewDocumentId)
        .order("version_number", { ascending: false })
        .limit(1);
      const nextVersion = (latest?.[0]?.version_number ?? 0) + 1;

      const bytes = new Uint8Array(await file.arrayBuffer());
      const fileHash = sha256Hex(bytes);

      const dupFile = await checkDuplicateFile(supabase, orgId, crewId, fileHash);
      if (dupFile) {
        warnings.push(
          `${entry.filename}: this exact file was already uploaded${dupFile.documentTypeName ? ` (as ${dupFile.documentTypeName})` : ""} on ${new Date(dupFile.uploadedAt).toLocaleDateString()}.`
        );
      }
      if (entry.documentNumber) {
        const dupNumber = await checkDuplicateDocumentNumber(supabase, orgId, documentTypeId, entry.documentNumber, crewId);
        if (dupNumber) {
          warnings.push(
            `${entry.filename}: document number "${entry.documentNumber}" is already on file for ${dupNumber.fullName}${dupNumber.employeeCode ? ` (${dupNumber.employeeCode})` : ""}.`
          );
        }
      }

      const filePath = `${orgId}/${crewId}/${crewDocumentId}/${nextVersion}_${sanitizeFileName(file.name)}`;
      const { error: upErr } = await supabase.storage.from("crew-documents").upload(filePath, bytes, { contentType: file.type || "application/octet-stream" });
      if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

      const { error: versionErr } = await supabase.from("crew_document_versions").insert({
        org_id: orgId,
        crew_document_id: crewDocumentId,
        crew_id: crewId,
        version_number: nextVersion,
        file_path: filePath,
        file_name: file.name,
        content_type: file.type || null,
        file_size_bytes: file.size,
        file_hash: fileHash,
        document_number: entry.documentNumber,
        issue_date: entry.issueDate,
        expiry_date: entry.expiryDate,
        source: "ai_upload",
        ai_confidence: entry.confidence,
        uploaded_by: userId,
      });
      if (versionErr) throw new Error(versionErr.message);

      const syncUpdate: Record<string, unknown> = { updated_by: userId };
      if (entry.documentNumber) syncUpdate.document_number = entry.documentNumber;
      if (entry.issueDate) syncUpdate.issue_date = entry.issueDate;
      if (entry.expiryDate) syncUpdate.expiry_date = entry.expiryDate;
      await supabase.from("crew_documents").update(syncUpdate).eq("id", crewDocumentId);

      attached++;
    } catch (e) {
      errors.push(`${entry.filename}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  revalidatePath(`/crew/profiles/${crewId}`);
  revalidatePath("/crew/documents");
  return { result: { attached, errors, warnings } };
}

/* ================= review audit log ================= */
//
// Phase 16b — a record of the review step itself, not just its final
// outcome. commitDocumentIntakeFolder above only ever sees the rows the
// reviewer left checked (crew_document_versions is the record of what
// got attached); this is the complementary record of what the AI
// originally proposed for EVERY file in a folder — including the ones
// the reviewer excluded, and what if anything the reviewer changed
// before confirming. Called once per folder after its commit batches
// finish (see importAll() in document-intake-panel.tsx), independent
// of the chunked file-upload loop above so a file with nothing to
// upload (excluded, or "not applicable") still gets logged exactly
// once rather than needing to ride along with a file-bytes batch it
// isn't part of.

export type ReviewLogEntry = {
  filename: string;
  aiDocumentTypeName: string | null;
  aiNotApplicable: boolean;
  aiDocumentNumber: string | null;
  aiIssueDate: string | null;
  aiExpiryDate: string | null;
  aiConfidence: number | null;
  included: boolean;
  finalDocumentTypeId: string | null;
  finalNewDocumentTypeName: string | null;
  finalDocumentNumber: string | null;
  finalIssueDate: string | null;
  finalExpiryDate: string | null;
};

export async function logBulkIntakeReview(crewId: string, folderName: string, entries: ReviewLogEntry[]): Promise<{ ok: true } | { error: string }> {
  if (entries.length === 0) return { ok: true };
  const { supabase, orgId, userId } = await requireBulkDocumentAccess();

  const { data: crewRow } = await supabase.from("crew_profiles").select("id").eq("id", crewId).eq("org_id", orgId).maybeSingle();
  if (!crewRow) return { error: "Crew member not found." };

  const rows = entries.map((e) => ({
    org_id: orgId,
    crew_id: crewId,
    folder_name: folderName,
    filename: e.filename,
    ai_document_type_name: e.aiDocumentTypeName,
    ai_not_applicable: e.aiNotApplicable,
    ai_document_number: e.aiDocumentNumber,
    ai_issue_date: e.aiIssueDate,
    ai_expiry_date: e.aiExpiryDate,
    ai_confidence: e.aiConfidence,
    included: e.included,
    final_document_type_id: e.finalDocumentTypeId,
    final_new_document_type_name: e.finalNewDocumentTypeName,
    final_document_number: e.finalDocumentNumber,
    final_issue_date: e.finalIssueDate,
    final_expiry_date: e.finalExpiryDate,
    reviewed_by: userId,
  }));

  // Logging failures must never block the import itself — the caller
  // surfaces this as a warning, not an error, since the documents
  // themselves (if any) are already safely attached by this point.
  const { error } = await supabase.from("bulk_intake_review_log").insert(rows);
  if (error) return { error: error.message };
  return { ok: true };
}
