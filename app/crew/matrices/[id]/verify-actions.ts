"use server";

// Send-time document verification — server actions behind the "Verify
// documents" step of the Send Matrix to Client wizard. The wizard asks for
// a plan (the documents that would go out, with any cached readings
// already compared), then reads the uncached files a few at a time so the
// step can show live progress without one long request. Readings are
// cached per stored file version (see 0041), so re-opening the step, or
// re-checking after fixing a record, doesn't spend another AI call.

import crypto from "crypto";
import type { ModelMessage } from "ai";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveAccess, can } from "@/lib/rbac";
import { loadAiContext, runStructured } from "@/lib/ai/router";
import { extractDocument } from "@/lib/ai/extract";
import { documentVerifyReadSchema, SYSTEM_DOCUMENT_VERIFY } from "@/lib/ai/document-verify-schema";
import { loadVerifyItems, loadReads, type ServerVerifyItem } from "@/lib/matrix-verify-load";
import { outcomeFor, type VerifyItem, type VerifyOutcome, type DocRead } from "@/lib/matrix-verify";

const MAX_AI_FILE_BYTES = 4 * 1024 * 1024; // same Server Action body ceiling the upload auto-read honours

async function requireShare() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "crew.matrix.share")) throw new Error("You don't have permission to share crew matrices with clients.");
  if (!access.orgId) throw new Error("No company context.");
  return { supabase, orgId: access.orgId as string, userId: user.id };
}

function publicItem(i: ServerVerifyItem): VerifyItem {
  // Storage paths stay on the server.
  const { filePath: _filePath, contentType: _contentType, fileSize: _fileSize, ...rest } = i;
  void _filePath;
  void _contentType;
  void _fileSize;
  return rest;
}

export async function getVerificationPlan(crewMatrixId: string): Promise<{ items: VerifyItem[]; outcomes: VerifyOutcome[]; aiEnabled: boolean } | { error: string }> {
  const { supabase, orgId } = await requireShare();
  const loaded = await loadVerifyItems(supabase, orgId, crewMatrixId);
  if ("error" in loaded) return { error: loaded.error };
  const reads = await loadReads(supabase, orgId, loaded.items.map((i) => i.versionId).filter((v): v is string => !!v));
  const ctx = await loadAiContext(supabase, orgId);
  return {
    items: loaded.items.map(publicItem),
    outcomes: loaded.items.map((i) => outcomeFor(i, i.versionId ? reads.get(i.versionId) : null)),
    aiEnabled: !!ctx.settings.ai_enabled,
  };
}

// Reads one document file (or returns the cached reading) and compares it
// with the record. Never throws for a bad file — an unreadable file is an
// outcome, not an error.
export async function verifyDocumentItem(crewMatrixId: string, key: string): Promise<{ outcome: VerifyOutcome } | { error: string }> {
  const { supabase, orgId, userId } = await requireShare();
  const loaded = await loadVerifyItems(supabase, orgId, crewMatrixId);
  if ("error" in loaded) return { error: loaded.error };
  const item = loaded.items.find((i) => i.key === key);
  if (!item) return { error: "That document is no longer part of this matrix." };
  if (!item.versionId || !item.filePath) return { outcome: outcomeFor(item, null) };

  const cached = (await loadReads(supabase, orgId, [item.versionId])).get(item.versionId);
  if (cached && cached.read_ok) return { outcome: outcomeFor(item, cached) };

  const save = async (row: { read_ok: boolean; read_json: DocRead | null; read_error: string | null; file_hash: string | null; model_label: string | null }) => {
    await supabase.from("crew_document_verification_reads").upsert(
      {
        org_id: orgId,
        crew_document_version_id: item.versionId,
        crew_id: item.crewId,
        file_hash: row.file_hash,
        read_ok: row.read_ok,
        read_json: row.read_json,
        read_error: row.read_error,
        model_label: row.model_label,
        read_by: userId,
        read_at: new Date().toISOString(),
      },
      { onConflict: "crew_document_version_id" }
    );
    return { outcome: outcomeFor(item, { read_ok: row.read_ok, read_json: row.read_json, read_error: row.read_error }) };
  };

  const { data: blob, error: dlErr } = await supabase.storage.from("crew-documents").download(item.filePath);
  if (dlErr || !blob) return save({ read_ok: false, read_json: null, read_error: `The stored file could not be opened (${dlErr?.message ?? "not found"}).`, file_hash: null, model_label: null });
  const buf = await blob.arrayBuffer();
  const fileHash = crypto.createHash("sha256").update(Buffer.from(buf)).digest("hex");

  if (buf.byteLength > MAX_AI_FILE_BYTES) {
    return save({ read_ok: false, read_json: null, read_error: `The file is larger than ${MAX_AI_FILE_BYTES / 1024 / 1024} MB, too big to read automatically.`, file_hash: fileHash, model_label: null });
  }

  const ctx = await loadAiContext(supabase, orgId);
  if (!ctx.settings.ai_enabled) {
    // Not cached: turning AI on later should let the same file be read.
    return { outcome: { key: item.key, overall: "unread", checks: [], error: "AI reading is switched off for this company (Administration → AI Settings)." } };
  }

  const file = new File([buf], item.fileName ?? "document", { type: item.contentType ?? blob.type });
  const extracted = await extractDocument(file);
  if (extracted.unreadable) {
    return save({ read_ok: false, read_json: null, read_error: "The file does not open as a valid document (corrupt, empty or not a real PDF).", file_hash: fileHash, model_label: null });
  }

  const prompt = [
    `TASK: Read this document and report who it was issued to, what kind of document it is, its number, and its issue and expiry dates.`,
    `It is expected to be: "${item.docTypeName}".`,
    extracted.text ? `--- Extracted text ---\n${extracted.text}` : extracted.needsModelVision ? "(The document is attached as an image/file — read it directly.)" : "(No readable text could be extracted from this file.)",
  ].join("\n\n");
  const content: Exclude<ModelMessage, { role: "system" | "assistant" | "tool" }>["content"] = extracted.needsModelVision
    ? [{ type: "text", text: prompt }, { type: "file", data: extracted.bytes, mediaType: extracted.mediaType, filename: extracted.filename }]
    : prompt;

  const result = await runStructured(supabase, ctx, {
    task: "crew_intake",
    schema: documentVerifyReadSchema,
    system: SYSTEM_DOCUMENT_VERIFY,
    messages: [{ role: "user", content }],
    needsDocuments: extracted.needsModelVision,
    userId,
    crewMatrixId,
  });
  if ("error" in result) {
    // Provider hiccup or quota: don't cache, so a retry can succeed.
    return { outcome: { key: item.key, overall: "unread", checks: [], error: result.error } };
  }
  return save({ read_ok: true, read_json: result.object as DocRead, read_error: null, file_hash: fileHash, model_label: result.model.display_name });
}
