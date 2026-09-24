"use server";

import { revalidatePath } from "next/cache";
import type { ModelMessage } from "ai";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveAccess, can } from "@/lib/rbac";
import { loadAiContext, runStructured } from "@/lib/ai/router";
import { crewIntakeDocumentSchema } from "@/lib/ai/crew-intake-schema";
import { extractDocument } from "@/lib/ai/extract";
import { mapName, type Alias, type Mapping } from "@/lib/ai/mapping";

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

const SYSTEM_CLASSIFY = `You are identifying a single scanned document (a certificate, ID, or similar) that belongs to an offshore marine crew member already registered in the system.
Rules:
- Return only the requested JSON. No prose outside it.
- document_type_name should use the clearest name for what the document actually is (e.g. "Passport", "Seaman's Book", "BOSIET / HUET", "Medical Certificate") — prefer one of this company's configured names when it fits, otherwise the clearest industry-standard name.
- Never invent a value the document doesn't support; leave it null rather than guess.
- Dates must be ISO yyyy-mm-dd when the document states a full date; leave null if only partial or unclear.
- document_number is whatever the document itself labels as its own number/ID/reference (certificate number, passport number, visa number, etc.), not an unrelated reference on the page.
- If the file clearly isn't an identity or certification document, set document_type_name to null.`;

function classifyPrompt(documentTypeNames: string[], documentText: string | null, hasAttachedFile: boolean) {
  return [
    "TASK: Identify what this document is and extract its own number and validity dates.",
    `Document/certificate types already configured in this company (use one of these exact names when it fits): ${documentTypeNames.join("; ") || "(none)"}`,
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
  documentNumber: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  confidence: number;
  error: string | null;
};

export async function classifyDocumentFolder(crewId: string, formData: FormData): Promise<{ files: ClassifiedFile[] } | { error: string }> {
  const { supabase, orgId, userId } = await requireBulkDocumentAccess();

  const { data: crewRow } = await supabase.from("crew_profiles").select("id").eq("id", crewId).eq("org_id", orgId).maybeSingle();
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
      results.push({ filename: file.name, mapping: null, documentTypeName: null, documentNumber: null, issueDate: null, expiryDate: null, confidence: 0, error: "Doesn't look like a valid file of its type." });
      continue;
    }
    const prompt = classifyPrompt(documentTypeNames, extracted.text, extracted.needsModelVision);
    const fileParts = extracted.needsModelVision ? [{ type: "file" as const, data: extracted.bytes, mediaType: extracted.mediaType, filename: extracted.filename }] : [];
    const content: Exclude<ModelMessage, { role: "system" | "assistant" | "tool" }>["content"] = fileParts.length ? [{ type: "text", text: prompt }, ...fileParts] : prompt;
    const messages: ModelMessage[] = [{ role: "user", content }];

    const result = await runStructured(supabase, ctx, {
      task: "crew_intake",
      schema: crewIntakeDocumentSchema,
      system: SYSTEM_CLASSIFY,
      messages,
      needsDocuments: extracted.needsModelVision,
      userId,
    });
    if ("error" in result) {
      results.push({ filename: file.name, mapping: null, documentTypeName: null, documentNumber: null, issueDate: null, expiryDate: null, confidence: 0, error: result.error });
      continue;
    }
    const p = result.object;
    const mapping = p.document_type_name ? mapName(p.document_type_name, "document_type", documentTypes, aliases) : null;
    results.push({
      filename: file.name,
      mapping,
      documentTypeName: p.document_type_name,
      documentNumber: p.document_number,
      issueDate: p.issue_date,
      expiryDate: p.expiry_date,
      confidence: p.confidence,
      error: null,
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
};

export type FolderCommitResult = { attached: number; errors: string[] };

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
  let attached = 0;

  for (const entry of manifest) {
    const file = filesByName.get(entry.filename);
    if (!file) {
      errors.push(`${entry.filename}: file missing from upload.`);
      continue;
    }
    try {
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

      let crewDocumentId = crewDocumentCache.get(documentTypeId);
      if (!crewDocumentId) {
        const { data: existingDoc } = await supabase
          .from("crew_documents")
          .select("id")
          .eq("org_id", orgId)
          .eq("crew_id", crewId)
          .eq("document_type_id", documentTypeId)
          .eq("is_active", true)
          .maybeSingle();
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
  return { result: { attached, errors } };
}
