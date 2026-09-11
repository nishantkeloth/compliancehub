import { z } from "zod";

// Phase 9 — the structured contract every matrix-generation model call
// must satisfy. Names, not IDs: mapping to this company's master data
// happens in the app afterwards (lib/ai/mapping.ts).

export const PROMPT_VERSION = "2026-09-v1";

export const requiredDocumentSchema = z.object({
  name: z.string().min(1),
  is_mandatory: z.boolean().default(true),
  waiver_permitted: z.boolean().default(false),
  minimum_remaining_validity_days: z.number().int().min(0).nullable().default(null),
});

export const matrixLineSchema = z.object({
  job_role_name: z.string().min(1),
  required_headcount: z.number().int().min(1),
  day_shift_quantity: z.number().int().min(0).nullable().default(null),
  night_shift_quantity: z.number().int().min(0).nullable().default(null),
  other_shift_quantity: z.number().int().min(0).nullable().default(null),
  rotation_name: z.string().nullable().default(null),
  employment_type_preference: z.string().nullable().default(null),
  nationality_preference: z.string().nullable().default(null),
  language_requirement: z.string().nullable().default(null),
  minimum_experience_years: z.number().min(0).nullable().default(null),
  mobilization_lead_days: z.number().int().min(0).nullable().default(null),
  client_approval_required: z.boolean().default(false),
  remarks: z.string().nullable().default(null),
  required_documents: z.array(requiredDocumentSchema).default([]),
  required_skills: z.array(z.string()).default([]),
  competencies: z.array(z.object({ name: z.string().min(1), minimum_grade: z.string().nullable().default(null) })).default([]),
  client_requirements: z.array(z.object({ text: z.string().min(1), is_mandatory: z.boolean().default(true) })).default([]),
  confidence: z.number().min(0).max(1).default(0.5),
  source_excerpt: z.string().nullable().default(null),
  norm_applied: z.string().nullable().default(null),
});

export const matrixProposalSchema = z.object({
  title: z.string().nullable().default(null),
  expected_pob: z.number().int().min(0).nullable().default(null),
  lines: z.array(matrixLineSchema),
  assumptions: z.array(z.string()).default([]),
  open_questions: z.array(z.string()).default([]),
});
export type MatrixProposal = z.infer<typeof matrixProposalSchema>;
export type MatrixLineProposal = z.infer<typeof matrixLineSchema>;

export const reviewFindingSchema = z.object({
  severity: z.enum(["high", "medium", "low"]),
  line_job_role_name: z.string().nullable().default(null),
  finding: z.string().min(1),
  suggestion: z.string().min(1),
  norm_applied: z.string().nullable().default(null),
});
export const reviewSchema = z.object({
  summary: z.string(),
  findings: z.array(reviewFindingSchema),
});
export type MatrixReview = z.infer<typeof reviewSchema>;

/* ================= Prompts ================= */

export type MasterDataNames = {
  jobRoles: string[];
  skills: string[];
  documentTypes: string[];
  rotationTemplates: string[];
};

export type ProjectContext = {
  projectName: string;
  contractTitle: string | null;
  services: string[];
  siteName: string;
  siteType: string | null;
  expectedPob: number | null;
  country: string | null;
  region: string | null;
  plannedStart: string | null;
  plannedEnd: string | null;
  notes: string | null;
};

function masterDataText(md: MasterDataNames) {
  return [
    `Job roles configured in this company: ${md.jobRoles.join("; ") || "(none)"}`,
    `Skills configured: ${md.skills.join("; ") || "(none)"}`,
    `Document / certificate types configured: ${md.documentTypes.join("; ") || "(none)"}`,
    `Rotation templates configured: ${md.rotationTemplates.join("; ") || "(none)"}`,
    "Prefer these exact names when they fit; otherwise use the clearest industry-standard name.",
  ].join("\n");
}

export const SYSTEM_BASE = `You are an offshore catering manning planner for a marine catering contractor. You produce crew matrices: the roles, headcounts, shift split, rotation, and per-role requirements (certificates/documents, skills, competencies, nationality/language preferences, minimum experience, client approval) needed to run catering, housekeeping and laundry services on an offshore vessel or installation.
Rules:
- Return only the requested JSON. No prose outside it.
- Never invent client requirements that are not supported by the input; put guesses under assumptions and set confidence accordingly.
- Headcounts are per rotation (people onboard at one time), not including relievers.
- Use one line per job role; use day/night/other shift quantities that sum to the required headcount when shifts are known.`;

export function documentModePrompt(args: { context: ProjectContext; masterData: MasterDataNames; documentText: string | null; hasAttachedFile: boolean }) {
  const { context, masterData, documentText, hasAttachedFile } = args;
  return [
    "TASK: Extract the client's manning requirement into a crew matrix.",
    "Every line must carry source_excerpt = the sentence(s) or table row(s) in the source that justify it. If the document is silent on a field, leave it null; do not fill from general knowledge (use assumptions for anything inferred).",
    "",
    `Project: ${context.projectName}${context.contractTitle ? ` · Contract: ${context.contractTitle}` : ""}`,
    `Site: ${context.siteName}${context.siteType ? ` (${context.siteType})` : ""} · Expected POB: ${context.expectedPob ?? "unknown"} · Services in contract: ${context.services.join(", ") || "unknown"}`,
    "",
    masterDataText(masterData),
    "",
    hasAttachedFile ? "The source document is attached as a file." : "",
    documentText ? `SOURCE DOCUMENT TEXT:\n"""\n${documentText}\n"""` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function contextModePrompt(args: { context: ProjectContext; masterData: MasterDataNames; normsText: string; historyText: string }) {
  const { context, masterData, normsText, historyText } = args;
  return [
    "TASK: Propose a crew matrix for this project and site with no client document. Base it on the services in scope, the expected POB, the catering norms below (cite the norm key in norm_applied for each headcount), and this company's own history for similar sites. Where history and norms disagree, prefer history and say so in assumptions.",
    "",
    `Project: ${context.projectName}${context.contractTitle ? ` · Contract: ${context.contractTitle}` : ""}`,
    `Site: ${context.siteName}${context.siteType ? ` (${context.siteType})` : ""} · Expected POB: ${context.expectedPob ?? "unknown"} · Country/region: ${[context.country, context.region].filter(Boolean).join(" / ") || "unknown"}`,
    `Services in contract: ${context.services.join(", ") || "catering (assume)"}`,
    `Planned dates: ${context.plannedStart ?? "?"} to ${context.plannedEnd ?? "?"}`,
    context.notes ? `Project notes: ${context.notes}` : "",
    "",
    "CATERING NORMS (company defaults, editable):",
    normsText,
    "",
    "COMPANY HISTORY (approved matrices for similar sites):",
    historyText || "(none yet)",
    "",
    masterDataText(masterData),
  ]
    .filter(Boolean)
    .join("\n");
}

export function reviewModePrompt(args: { context: ProjectContext; normsText: string; matrixText: string }) {
  return [
    "TASK: Review this draft crew matrix against the catering norms and general offshore practice. Return concrete, actionable findings only (missing mandatory certificates for a role, headcount below the norm for the POB, no night coverage where the site runs nights, missing rotation, duplicate roles, unrealistic shift split). Do not restate what is fine. Cite norm keys in norm_applied.",
    "",
    `Project: ${args.context.projectName} · Site: ${args.context.siteName}${args.context.siteType ? ` (${args.context.siteType})` : ""} · Expected POB: ${args.context.expectedPob ?? "unknown"} · Services: ${args.context.services.join(", ") || "unknown"}`,
    "",
    "CATERING NORMS:",
    args.normsText,
    "",
    "DRAFT MATRIX:",
    args.matrixText,
  ].join("\n");
}
