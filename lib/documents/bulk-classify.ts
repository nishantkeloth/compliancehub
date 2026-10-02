import "server-only";
import type { ModelMessage } from "ai";
import { z } from "zod";
import { loadAiContext, runStructured, type AiContext } from "@/lib/ai/router";
import { extractDocument } from "@/lib/ai/extract";
import { mapName, type Alias, type Mapping } from "@/lib/ai/mapping";
import { sha256Hex, checkDuplicateFile, checkDuplicateDocumentNumber, validateDocumentDates } from "@/lib/documents/checks";

// Phase 16d — the single-file classify step pulled out of
// app/team/bulk-intake/document-intake-actions.ts's classifyDocumentFolder
// so both that (still used for the synchronous path) and the new
// background worker route (app/api/bulk-intake/process-job/route.ts) run
// the exact same logic against a File, whichever supplied the bytes —
// the browser's own upload for the synchronous path, or bytes downloaded
// back out of the bulk-intake-staging bucket for the worker. Keeping two
// copies of this was the thing to avoid: Phase 16c's pre-commit checks
// (duplicate file/number, expiring-soon, identity cross-check) are exactly
// the kind of logic that quietly drifts apart if it's ever edited in only
// one place.

type Supa = any; // eslint-disable-line @typescript-eslint/no-explicit-any

// Deliberately NOT the shared crewIntakeDocumentSchema from
// lib/ai/crew-intake-schema.ts (used by the single-document Auto-read
// button) — see the original note in document-intake-actions.ts: that
// flow already has a document type pre-selected by the person uploading;
// bulk intake has no pre-selection, so document_type_name here is
// nullable and must be either an exact configured name or null, never an
// invented one.
export const bulkClassifySchema = z.object({
  document_type_name: z.string().nullable().default(null),
  document_number: z.string().nullable().default(null),
  issue_date: z.string().nullable().default(null),
  expiry_date: z.string().nullable().default(null),
  confidence: z.number().min(0).max(1).default(0.5),
  source_excerpt: z.string().nullable().default(null),
  document_full_name: z.string().nullable().default(null),
  document_nationality: z.string().nullable().default(null),
  document_date_of_birth: z.string().nullable().default(null),
});

export const SYSTEM_CLASSIFY = `You are identifying a single scanned document (a certificate, ID, or similar) that may or may not belong to an offshore marine crew member's compliance record.
Rules:
- Return only the requested JSON. No prose outside it.
- document_type_name must be EXACTLY one of the configured type names given to you (copy it verbatim, do not paraphrase or invent a variant) — or null.
- Set document_type_name to null whenever: the document isn't an identity or certification document at all (payroll slips, remittance advices, invoices, letters, personal correspondence, etc.), OR it is a certificate/ID but doesn't clearly match any of the configured names given to you. Do NOT invent a new type name in either case — null is the correct answer, not a guess.
- Never invent a value the document doesn't support; leave a field null rather than guess.
- Dates must be ISO yyyy-mm-dd when the document states a full date; leave null if only partial or unclear.
- document_number is whatever the document itself labels as its own number/ID/reference (certificate number, passport number, visa number, etc.), not an unrelated reference on the page.
- document_full_name/document_nationality/document_date_of_birth: fill these in ONLY when the document itself is a personal identity document (passport, seaman's book, visa, national ID, or similar) and actually shows that field printed on it. Leave all three null for anything else (a training certificate, a course letter, a form with no photo-ID-style personal details) — do not guess a name from context like a filename or folder.`;

export function classifyPrompt(documentTypeNames: string[], documentText: string | null, hasAttachedFile: boolean) {
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
  notApplicable: boolean;
  documentNumber: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  confidence: number;
  error: string | null;
  warnings: string[];
};

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

export type ClassifyCrewRow = { full_name: string; nationality: string | null; date_of_birth: string | null };
export type ClassifyDocType = { id: string; name: string };

export async function classifyOneFile(
  supabase: Supa,
  ctx: AiContext,
  orgId: string,
  userId: string,
  crewId: string,
  crewRow: ClassifyCrewRow,
  documentTypes: ClassifyDocType[],
  documentTypeNames: string[],
  aliases: Alias[],
  file: File
): Promise<ClassifiedFile> {
  const extracted = await extractDocument(file);
  if (extracted.unreadable) {
    return { filename: file.name, mapping: null, documentTypeName: null, notApplicable: false, documentNumber: null, issueDate: null, expiryDate: null, confidence: 0, error: "Doesn't look like a valid file of its type.", warnings: [] };
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
    return { filename: file.name, mapping: null, documentTypeName: null, notApplicable: false, documentNumber: null, issueDate: null, expiryDate: null, confidence: 0, error: result.error, warnings: [] };
  }
  const p = result.object;
  const mapping = p.document_type_name ? mapName(p.document_type_name, "document_type", documentTypes, aliases) : null;

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

  return {
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
  };
}

// Small shared loader — both classifyDocumentFolder (synchronous path)
// and the background worker need the same "what are this org's document
// types and learned aliases, is AI even enabled" bundle before they can
// classify anything.
export async function loadClassifyContext(supabase: Supa, orgId: string) {
  const ctx = await loadAiContext(supabase, orgId);
  const [dt, al] = await Promise.all([
    supabase.from("document_types").select("id, name").eq("org_id", orgId).eq("is_active", true).order("name"),
    supabase.from("ai_name_aliases").select("entity_type, alias, target_id").eq("org_id", orgId),
  ]);
  const documentTypes: ClassifyDocType[] = dt.data ?? [];
  const aliases = (al.data ?? []) as Alias[];
  return { ctx, documentTypes, documentTypeNames: documentTypes.map((d) => d.name), aliases };
}
