import { z } from "zod";

// Bulk Data Migration — AI-assisted column mapping for a crew register
// workbook that doesn't match the fixed "Crew Profile" + "Documents"
// template (e.g. a client-provided master crew chart with its own
// layout). Runs once per upload purely to identify which existing
// column holds which field — the model sees only a small excerpt of
// the sheet and never writes anything itself: the deterministic
// row-parsing/validation pipeline in crew-register-actions.ts (same
// review-before-import flow as the template path) does the real work
// once this mapping is resolved. Reuses the "crew_intake" AI task
// (same "make sense of crew onboarding data" class of job) rather
// than adding a new task key + admin AI-settings wiring for what is,
// from the model-routing side, an identical kind of call.

export const BULK_MAPPING_PROMPT_VERSION = "2026-09-v1";

const nullableHeader = z.string().nullable().default(null);

export const crewBulkMappingSchema = z.object({
  headerRowIndex: z.number().int().min(0),
  profileColumns: z.object({
    employeeCode: nullableHeader,
    fullName: nullableHeader,
    jobRole: nullableHeader,
    employmentStatus: nullableHeader,
    employmentType: nullableHeader,
    nationality: nullableHeader,
    dateOfBirth: nullableHeader,
    gender: nullableHeader,
    phone: nullableHeader,
    email: nullableHeader,
    homeCountry: nullableHeader,
    currentLocation: nullableHeader,
    nearestAirport: nullableHeader,
    joiningDate: nullableHeader,
    noticePeriodDays: nullableHeader,
    availabilityDate: nullableHeader,
    emergencyContactName: nullableHeader,
    emergencyContactPhone: nullableHeader,
    dayRate: nullableHeader,
    currency: nullableHeader,
    dietaryMedicalNotes: nullableHeader,
    notes: nullableHeader,
  }),
  documentColumns: z
    .array(
      z.object({
        documentTypeName: z.string().min(1),
        numberColumn: nullableHeader,
        issueDateColumn: nullableHeader,
        expiryDateColumn: nullableHeader,
      })
    )
    .default([]),
  assumptions: z.array(z.string()).default([]),
});
export type CrewBulkMapping = z.infer<typeof crewBulkMappingSchema>;

export const SYSTEM_BULK_MAPPING = `You are a data-migration analyst mapping an offshore marine crew roster spreadsheet (an unknown, client-specific layout) onto a fixed target schema so it can be imported.
Rules:
- Return only the requested JSON. No prose outside it.
- headerRowIndex is the 0-based index (within the numbered excerpt provided) of the row that actually contains column headers — not a title row, not a blank row, not a data row.
- Every "*Column" value you return must be copied EXACTLY (verbatim, same case/spacing/punctuation) from a real header cell in that header row, or null if this file has no column for that field. Never invent a column name.
- One row of the sheet = one crew member. Do not map a column that holds document data (numbers, dates) to a profile field, and do not map a profile field's column as a document column.
- documentColumns: find every certificate/ID/visa/vaccination the sheet tracks per person. Wide crew-chart layouts commonly pair a "<Document> No" column with a "<Document> Expiry"/"<Document> Valid Till" column (e.g. "Passport No" + "Passport Expiry", "STCW No" + "STCW Exp Date") — pair these correctly per document type. A document type can have a number column, an expiry column, both, or (rarely) an issue-date column too — leave the ones that don't exist null.
- documentTypeName should use the clearest name for the certificate — prefer an exact match from the company's configured document types list below when the meaning matches, otherwise use the sheet's own label for it.
- If you are not confident a column matches a field, leave it null rather than guessing. A missed column is reviewed and fixed by a person afterward; a wrongly-guessed column silently imports the wrong data into the wrong field.
- Employee Code is frequently absent in client-provided files — leave it null rather than reusing a different identifier column (never substitute a rank, vessel name, or a document/ID number for Employee Code).`;

export function bulkMappingPrompt(args: { sheetName: string; excerpt: string; documentTypeNames: string[] }) {
  return [
    "TASK: Identify which column (by exact header text) holds each of the following crew-register fields, and which column pairs hold each document type's number/expiry, in the spreadsheet excerpt below.",
    "",
    `Sheet name: ${args.sheetName}`,
    `Document/certificate types already configured in this company (prefer these exact names when a document column's meaning matches one): ${args.documentTypeNames.join("; ") || "(none configured yet)"}`,
    "",
    'SHEET EXCERPT (rows numbered from 0; cells separated by " | "; blank cells shown as empty):',
    '"""',
    args.excerpt,
    '"""',
  ].join("\n");
}
