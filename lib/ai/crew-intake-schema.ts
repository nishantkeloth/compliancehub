import { z } from "zod";

// Phase 12 — the structured contract a crew-intake model call must
// satisfy. Extracts identity + certificate data from a CV/passport/ID
// scan for onboarding a new crew member. Names, not ids: mapping to
// this company's document_types/job_roles happens in the app
// afterwards (lib/ai/mapping.ts), same pattern as matrix generation
// (lib/ai/schema.ts).
//
// Unlike matrix generation, this task sends real personal documents to
// the model — deliberately, per the user's explicit choice (see
// claude/phase9-ai-crew-matrix-requirement.md's "AI proposes, people
// approve" principle: every field here is reviewed and editable before
// anything is saved, same as the matrix-generation flow).

export const INTAKE_PROMPT_VERSION = "2026-09-v1";

export const crewIntakeDocumentSchema = z.object({
  document_type_name: z.string().min(1),
  document_number: z.string().nullable().default(null),
  issue_date: z.string().nullable().default(null), // ISO yyyy-mm-dd when determinable
  expiry_date: z.string().nullable().default(null),
  confidence: z.number().min(0).max(1).default(0.5),
  source_excerpt: z.string().nullable().default(null),
});

export const crewIntakeSchema = z.object({
  full_name: z.string().nullable().default(null),
  date_of_birth: z.string().nullable().default(null),
  nationality: z.string().nullable().default(null),
  gender: z.string().nullable().default(null),
  phone: z.string().nullable().default(null),
  email: z.string().nullable().default(null),
  home_country: z.string().nullable().default(null),
  job_role_name: z.string().nullable().default(null),
  documents: z.array(crewIntakeDocumentSchema).default([]),
  name_mismatch_warning: z.string().nullable().default(null),
  assumptions: z.array(z.string()).default([]),
});
export type CrewIntakeProposal = z.infer<typeof crewIntakeSchema>;
export type CrewIntakeDocumentProposal = z.infer<typeof crewIntakeDocumentSchema>;

export const SYSTEM_INTAKE = `You are an onboarding clerk for an offshore marine catering contractor, extracting structured data from crew identity and certification documents (CV, passport, national ID, seaman's book, medical or competency certificates) so a new crew member can be registered.
Rules:
- Return only the requested JSON. No prose outside it.
- Never invent a field value that is not supported by the documents; leave it null and note the gap in assumptions instead.
- Dates must be ISO yyyy-mm-dd when the document states a full date; leave null if only partial or unclear (note the raw text in assumptions).
- Every entry in documents must carry source_excerpt = the text/label in the source that justifies it.
- document_type_name should use the clearest industry-standard name for the certificate/ID (e.g. "Passport", "Seaman's Book", "STCW Basic Safety Training", "Medical Certificate", "Yellow Fever Vaccination Certificate").
- If the documents show more than one name for the same person (e.g. CV vs passport spelling, or a different name entirely), set name_mismatch_warning describing the discrepancy in one sentence; otherwise leave it null.
- job_role_name is the person's rank/position as stated on the CV (e.g. "Camp Boss", "Chief Steward") — leave null if not stated.`;

export function intakePrompt(args: { masterData: { documentTypeNames: string[]; jobRoleNames: string[] }; documentText: string | null; hasAttachedFiles: boolean }) {
  const { masterData, documentText, hasAttachedFiles } = args;
  return [
    "TASK: Extract this person's identity details and every certificate/ID shown into the crew intake schema.",
    "",
    `Document/certificate types already configured in this company (prefer these exact names when they fit): ${masterData.documentTypeNames.join("; ") || "(none)"}`,
    `Job roles configured in this company (prefer these exact names when they fit): ${masterData.jobRoleNames.join("; ") || "(none)"}`,
    "",
    hasAttachedFiles ? "The source document(s) are attached as file(s)." : "",
    documentText ? `SOURCE DOCUMENT TEXT:\n"""\n${documentText}\n"""` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
