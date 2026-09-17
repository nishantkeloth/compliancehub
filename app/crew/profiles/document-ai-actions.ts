"use server";

import type { ModelMessage } from "ai";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveAccess, can } from "@/lib/rbac";
import { loadAiContext, runStructured } from "@/lib/ai/router";
import { crewIntakeDocumentSchema, type CrewIntakeDocumentProposal } from "@/lib/ai/crew-intake-schema";
import { extractDocument } from "@/lib/ai/extract";

// Phase 13 follow-up — "auto-read" on the document Upload panel
// (crew-editor.tsx). Reuses crewIntakeDocumentSchema (lib/ai/crew-intake-schema.ts)
// and the same "crew_intake" task/model chain as the CV/ID onboarding
// intake, since this is the exact same kind of reading — a single
// identity/certification document instead of a whole batch, with the
// document type already known (picked from this company's document
// types) rather than something the model has to guess. Every proposed
// value lands in the upload form's fields for the person to confirm or
// correct before anything is saved — same "AI proposes, people approve"
// principle as intake and the AI crew matrix.

async function requireDocumentsManage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "crew.documents.manage")) {
    throw new Error("You don't have permission to manage crew documents.");
  }
  if (!access.orgId) throw new Error("No company context.");
  return { supabase, orgId: access.orgId, userId: user.id };
}

// Loose token-overlap check, same idea as the duplicate-name check in
// intake-actions.ts — not exported from lib/ai/mapping.ts, and small
// enough not to be worth widening that module's exports for this one
// "does the model's guess roughly match the type you picked" nudge.
function looseMatch(a: string, b: string) {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return true;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  const ta = new Set(na.split(" ").filter((t) => t.length > 2));
  const tb = new Set(nb.split(" ").filter((t) => t.length > 2));
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap++;
  return overlap / Math.max(ta.size, tb.size, 1) >= 0.4;
}

function documentReadPrompt(typeName: string, documentText: string | null, hasAttachedFile: boolean) {
  return [
    `TASK: Read this single document and extract its document number, issue date and expiry date.`,
    `It is expected to be: "${typeName}". Set document_type_name to what the document itself actually appears to be (usually the same, but flag it if it clearly isn't).`,
    documentText
      ? `--- Extracted text ---\n${documentText}`
      : hasAttachedFile
        ? "(The document is attached below as an image/file — read it directly.)"
        : "(No readable text could be extracted from this file.)",
  ].join("\n\n");
}

const SYSTEM_DOCUMENT_READ = `You are reading one identity or certification document for an offshore marine crew member, to extract just its number and validity dates.
Rules:
- Return only the requested JSON. No prose outside it.
- Never invent a value the document doesn't support; leave it null rather than guess.
- Dates must be ISO yyyy-mm-dd when the document states a full date; leave null if only partial or unclear, and say why in source_excerpt.
- document_number is whatever the document itself labels as its own number/ID/reference (its certificate number, passport number, visa number, etc. — whichever applies to THIS document), not an unrelated person/company reference that happens to appear on the page.
- source_excerpt should quote the specific text you read the number and dates from.`;

export type DocumentReadResult = CrewIntakeDocumentProposal & { typeMismatch: boolean; modelLabel: string };

export async function extractCrewDocumentFields(
  typeName: string,
  formData: FormData
): Promise<{ result: DocumentReadResult } | { error: string }> {
  const { supabase, orgId, userId } = await requireDocumentsManage();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file first." };

  const ctx = await loadAiContext(supabase, orgId);
  if (!ctx.settings.ai_enabled) return { error: "AI reading isn't enabled for this company (Administration → AI Settings) — enter the number and expiry manually." };
  const maxBytes = ctx.settings.max_upload_mb * 1024 * 1024;
  if (file.size > maxBytes) return { error: `File is larger than the ${ctx.settings.max_upload_mb} MB limit AI reading allows — enter the details manually.` };

  const extracted = await extractDocument(file);
  if (extracted.unreadable) return { error: `"${extracted.filename}" doesn't look like a valid file — check it opens correctly and re-upload it.` };

  const prompt = documentReadPrompt(typeName, extracted.text, extracted.needsModelVision);
  const fileParts = extracted.needsModelVision
    ? [{ type: "file" as const, data: extracted.bytes, mediaType: extracted.mediaType, filename: extracted.filename }]
    : [];
  const content: Exclude<ModelMessage, { role: "system" | "assistant" | "tool" }>["content"] = fileParts.length
    ? [{ type: "text", text: prompt }, ...fileParts]
    : prompt;
  const messages: ModelMessage[] = [{ role: "user", content }];

  const result = await runStructured(supabase, ctx, {
    task: "crew_intake",
    schema: crewIntakeDocumentSchema,
    system: SYSTEM_DOCUMENT_READ,
    messages,
    needsDocuments: extracted.needsModelVision,
    userId,
  });
  if ("error" in result) return { error: result.error };

  const proposal = result.object;
  return {
    result: {
      ...proposal,
      typeMismatch: !looseMatch(proposal.document_type_name, typeName),
      modelLabel: result.model.display_name,
    },
  };
}
