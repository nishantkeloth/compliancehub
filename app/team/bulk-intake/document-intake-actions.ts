"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ModelMessage } from "ai";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveAccess, can } from "@/lib/rbac";
import { loadAiContext, runStructured } from "@/lib/ai/router";
import { extractDocument } from "@/lib/ai/extract";
import { mapName, type Alias, type Mapping } from "@/lib/ai/mapping";
import { sha256Hex, checkDuplicateFile, checkDuplicateDocumentNumber, validateDocumentDates } from "@/lib/documents/checks";

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

// Deliberately NOT the shared crewIntakeDocumentSchema from
// lib/ai/crew-intake-schema.ts (used by the single-document Auto-read
// button) — that flow already has a document type pre-selected by the
// person uploading, so the model is only confirming/extracting against
// a known type. Bulk intake has no pre-selection: the model has to
// classify from a closed list with no human in the loop yet, so it gets
// its own stricter contract — document_type_name is nullable and MUST
// be either an exact name from the provided list, or null. It must
// never invent a name that isn't already configured; "doesn't match
// anything in the list" and "isn't a compliance document at all"
// (payroll slips, invoices, personal correspondence, etc.) both map to
// null, and the UI treats a null the same way either way — excluded by
// default, with creating a brand-new document type left as a separate,
// deliberate action a human takes on purpose, never something this
// classification step does for them.
const bulkClassifySchema = z.object({
  document_type_name: z.string().nullable().default(null),
  document_number: z.string().nullable().default(null),
  issue_date: z.string().nullable().default(null),
  expiry_date: z.string().nullable().default(null),
  confidence: z.number().min(0).max(1).default(0.5),
  source_excerpt: z.string().nullable().default(null),
  // Phase 16c, part 2 — identity cross-check. Most documents (a
  // training certificate, a course completion letter) don't carry a
  // full name at all; these stay null for those and the check below
  // is simply skipped. The ones that matter are passports, seaman's
  // books, visas, national IDs — anything bearing a person's own
  // identity — where a mismatch against the matched crew member's
  // stored profile is a strong signal the file landed in the wrong
  // person's folder.
  document_full_name: z.string().nullable().default(null),
  document_nationality: z.string().nullable().default(null),
  document_date_of_birth: z.string().nullable().default(null),
});

const SYSTEM_CLASSIFY = `You are identifying a single scanned document (a certificate, ID, or similar) that may or may not belong to an offshore marine crew member's compliance record.
Rules:
- Return only the requested JSON. No prose outside it.
- document_type_name must be EXACTLY one of the configured type names given to you (copy it verbatim, do not paraphrase or invent a variant) — or null.
- Set document_type_name to null whenever: the document isn't an identity or certification document at all (payroll slips, remittance advices, invoices, letters, personal correspondence, etc.), OR it is a certificate/ID but doesn't clearly match any of the configured names given to you. Do NOT invent a new type name in either case — null is the correct answer, not a guess.
- Never invent a value the document doesn't support; leave a field null rather than guess.
- Dates must be ISO yyyy-mm-dd when the document states a full date; leave null if only partial or unclear.
- document_number is whatever the document itself labels as its own number/ID/reference (certificate number, passport number, visa number, etc.), not an unrelated reference on the page.
- document_full_name/document_nationality/document_date_of_birth: fill these in ONLY when the document itself is a personal identity document (passport, seaman's book, visa, national ID, or similar) and actually shows that field printed on it. Leave all three null for anything else (a training certificate, a course letter, a form with no photo-ID-style personal details) — do not guess a name from context like a filename or folder.`;

function classifyPrompt(documentTypeNames: string[], documentText: string | null, hasAttachedFile: boolean) {
  return [
    "TASK: Identify which of this company's configured document types (if any) this file is, and extract its own number and validity dates.",
    `Configured document/certificate types for this company — document_type_name MUST be one of these exact strings, or null: ${documentTypeNames.join("; ") || "(none configured)"}`,
    documentText
      ? `--- Extracted text ---\n${documentText}`
      : hasAttachedFile
        ? "(The document is attached below as an image/file — read it directly.)"
        : "(No readable text could be extracted from this file.)",
  ].join("\n\n");
}

export type ClassifiedFile = {
  filename: string;
  mapping: Mapping | null;
  documentTypeName: string | null;
  // true when the AI positively returned null (not applicable / no
  // configured type fits) rather than this being a read error.
  notApplicable: boolean;
  documentNumber: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  confidence: number;
  error: string | null;
  // Phase 16c — surfaced during classification (not after commit, the
  // way checkDuplicateFile/checkDuplicateDocumentNumber were originally
  // used elsewhere in this file) so a reviewer sees "already on file"
  // or "expires soon" before clicking Import, when it can still change
  // their mind, rather than as a warning on the done screen after the
  // document is already attached. Duplicate/expiry checks only run once
  // the file matched a configured document type; the identity
  // cross-check below runs independent of that, whenever the document
  // itself carries a readable name (a misfiled passport is just as much
  // a problem whether or not "Passport" happens to be a configured type).
  warnings: string[];
};

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

  const ctx = await loadAiContext(supabase, orgId);
  if (!ctx.settings.ai_enabled) return { error: "AI features are disabled for this company (Administration → AI Settings)." };
  const maxBytes = ctx.settings.max_upload_mb * 1024 * 1024;
  for (const f of files) if (f.size > maxBytes || f.size > MAX_DOCUMENT_FILE_BYTES) return { error: `"${f.name}" is larger than the ${Math.min(ctx.settings.max_upload_mb, MAX_DOCUMENT_FILE_BYTES / 1024 / 1024)} MB limit.` };

  const [dt, al] = await Promise.all([
    supabase.from("document_types").select("id, name").eq("org_id", orgId).eq("is_active", true).order("name"),
    supabase.from("ai_name_aliases").select("entity_type, alias, target_id").eq("org_id", orgId),
  ]);
  const documentTypes = dt.data ?? [];
  const aliases = (al.data ?? []) as Alias[];
  const documentTypeNames = documentTypes.map((d) => d.name);

  const results: ClassifiedFile[] = [];
  for (const file of files) {
    const extracted = await extractDocument(file);
    if (extracted.unreadable) {
      results.push({ filename: file.name, mapping: null, documentTypeName: null, notApplicable: false, documentNumber: null, issueDate: null, expiryDate: null, confidence: 0, error: "Doesn't look like a valid file of its type.", warnings: [] });
      continue;
    }
    const prompt = classifyPrompt(documentTypeNames, extracted.text, extracted.needsModelVision);
    const fileParts = extracted.needsModelVision ? [{ type: "file" as const, data: extracted.bytes, mediaType: extracted.mediaType, filename: extracted.filename }] : [];
    const content: Exclude<ModelMessage, { role: "system" | "assistant" | "tool" }>["content"] = fileParts.length ? [{ type: "text", text: prompt }, ...fileParts] : prompt;
    const messages: ModelMessage[] = [{ role: "user", content }];

    const result = await runStructured(supabase, ctx, {
      task: "crew_intake",
      schema: bulkClassifySchema,
      system: SYSTEM_CLASSIFY,
      messages,
      needsDocuments: extracted.needsModelVision,
      userId,
    });
    if ("error" in result) {
      results.push({ filename: file.name, mapping: null, documentTypeName: null, notApplicable: false, documentNumber: null, issueDate: null, expiryDate: null, confidence: 0, error: result.error, warnings: [] });
      continue;
    }
    const p = result.object;
    // mapName still runs even on a name the model wasn't supposed to
    // invent — if it ever does anyway, this correctly comes back with
    // targetId: null (method "none"), and the UI treats that exactly
    // like notApplicable: it's never auto-included or auto-created.
    const mapping = p.document_type_name ? mapName(p.document_type_name, "document_type", documentTypes, aliases) : null;

    // Pre-commit checks — only meaningful once we actually know which
    // configured document type this is. checkDuplicateFile/
    // checkDuplicateDocumentNumber already existed but only ran inside
    // commitDocumentIntakeFolder, after the file was already attached;
    // running them here means the review table can show "already on
    // file" before Import is ever clicked.
    const warnings: string[] = [];
    if (mapping?.targetId) {
      const fileHash = sha256Hex(extracted.bytes);
      const dupFile = await checkDuplicateFile(supabase, orgId, crewId, fileHash);
      if (dupFile) {
        warnings.push(
          `Same file already on record${dupFile.documentTypeName ? ` (as ${dupFile.documentTypeName})` : ""}, uploaded ${new Date(dupFile.uploadedAt).toLocaleDateString()}.`
        );
      }
      if (p.document_number) {
        const dupNumber = await checkDuplicateDocumentNumber(supabase, orgId, mapping.targetId, p.document_number, crewId);
        if (dupNumber) {
          warnings.push(`Document number already on file for ${dupNumber.fullName}${dupNumber.employeeCode ? ` (${dupNumber.employeeCode})` : ""}.`);
        }
      }
      const dateCheck = validateDocumentDates(p.issue_date, p.expiry_date, { warnExpiringWithinDays: 60 });
      warnings.push(...dateCheck.errors, ...dateCheck.warnings);
    }

    // Identity cross-check — independent of whether a document type
    // matched. Only fires when the document actually carries a
    // readable name (most files leave this null and skip the check
    // entirely) and the crew member's own profile has something to
    // compare it against. A low name-similarity score is treated the
    // same way folder-matching treats one (see matchDocumentFolders
    // above) — token overlap below 0.6, not an exact-string demand, so
    // "J. Smith" vs "John Smith" doesn't false-positive. Nationality
    // and date of birth are compared more strictly since those have
    // much less legitimate formatting variance.
    if (p.document_full_name && crewRow.full_name) {
      const score = nameSimilarity(p.document_full_name, crewRow.full_name);
      if (score < 0.6) {
        warnings.push(`Name on document ("${p.document_full_name}") doesn't closely match this crew member's profile ("${crewRow.full_name}") — check this is the right person's file.`);
      }
    }
    if (p.document_nationality && crewRow.nationality && normName(p.document_nationality) !== normName(crewRow.nationality)) {
      warnings.push(`Nationality on document ("${p.document_nationality}") differs from the profile ("${crewRow.nationality}").`);
    }
    if (p.document_date_of_birth && crewRow.date_of_birth) {
      const docDob = new Date(p.document_date_of_birth);
      const profileDob = new Date(crewRow.date_of_birth);
      if (!Number.isNaN(docDob.getTime()) && !Number.isNaN(profileDob.getTime()) && docDob.getTime() !== profileDob.getTime()) {
        warnings.push(`Date of birth on document (${p.document_date_of_birth}) differs from the profile (${crewRow.date_of_birth}).`);
      }
    }

    results.push({
      filename: file.name,
      mapping,
      documentTypeName: p.document_type_name,
      notApplicable: p.document_type_name === null,
      documentNumber: p.document_number,
      issueDate: p.issue_date,
      expiryDate: p.expiry_date,
      confidence: p.confidence,
      error: null,
      warnings,
    });
  }

  return { files: results };
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
