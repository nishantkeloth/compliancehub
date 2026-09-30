import crypto from "crypto";

// Shared validation/duplicate-detection helpers used by every path that
// creates or updates a crew_documents / crew_document_versions row:
// app/crew/profiles/actions.ts (manual/AI upload), upload-link-actions.ts
// (crew self-upload), app/team/bulk-intake/document-intake-actions.ts
// (Bulk Document Intake), app/team/bulk-intake/crew-register-actions.ts
// (Crew Register Import's Documents tab), and intake-actions.ts (single-
// person AI intake). None of those callers share a request-scoped
// Supabase client type — actions.ts uses the session client, upload-
// link-actions.ts's public flow uses the service-role admin client — so
// `Supa = any` here deliberately mirrors the same pattern already used
// for this reason in lib/ai/router.ts.
type Supa = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export function sha256Hex(bytes: Uint8Array): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export type DuplicateFileMatch = {
  versionId: string;
  fileName: string | null;
  uploadedAt: string;
  documentTypeName: string | null;
};

// The exact same file (by content hash, not filename) already sitting on
// this crew member's record — almost always an accidental re-upload of
// the same scan. Scoped to the crew member rather than the whole org:
// the same photo reused for two different people is a different, more
// serious problem, which checkDuplicateDocumentNumber below is aimed at
// once the document's own number has been read/entered.
export async function checkDuplicateFile(supabase: Supa, orgId: string, crewId: string, fileHash: string): Promise<DuplicateFileMatch | null> {
  if (!fileHash) return null;
  const { data } = await supabase
    .from("crew_document_versions")
    .select("id, file_name, created_at, crew_documents(document_types(name))")
    .eq("org_id", orgId)
    .eq("crew_id", crewId)
    .eq("file_hash", fileHash)
    .order("created_at", { ascending: false })
    .limit(1);
  const row = data?.[0];
  if (!row) return null;
  const docRow = Array.isArray(row.crew_documents) ? row.crew_documents[0] : row.crew_documents;
  const dtRow = docRow ? (Array.isArray(docRow.document_types) ? docRow.document_types[0] : docRow.document_types) : null;
  return {
    versionId: row.id as string,
    fileName: (row.file_name as string | null) ?? null,
    uploadedAt: row.created_at as string,
    documentTypeName: (dtRow?.name as string | undefined) ?? null,
  };
}

export type DuplicateNumberMatch = { crewId: string; fullName: string; employeeCode: string | null };

// Same document number (passport no., certificate no., ...) already on
// file for a DIFFERENT crew member of the same document type — either a
// data-entry mistake or one physical document attached to two people by
// accident. Compared case-insensitively in JS rather than with .ilike()
// so a document number containing "%" or "_" (rare, but not impossible)
// can't be misread as a wildcard.
export async function checkDuplicateDocumentNumber(
  supabase: Supa,
  orgId: string,
  documentTypeId: string,
  documentNumber: string,
  // null when the caller has no crew id yet (e.g. a new-profile intake
  // that hasn't been saved) — every existing row is a candidate then.
  excludeCrewId: string | null
): Promise<DuplicateNumberMatch | null> {
  const key = documentNumber.trim().toLowerCase();
  if (!key) return null;
  let query = supabase
    .from("crew_documents")
    .select("crew_id, document_number, crew_profiles(full_name, employee_code)")
    .eq("org_id", orgId)
    .eq("document_type_id", documentTypeId)
    .eq("is_active", true);
  if (excludeCrewId) query = query.neq("crew_id", excludeCrewId);
  const { data } = await query;
  const row = (data ?? []).find((r: { document_number: string | null }) => (r.document_number ?? "").trim().toLowerCase() === key);
  if (!row) return null;
  const crewRow = Array.isArray(row.crew_profiles) ? row.crew_profiles[0] : row.crew_profiles;
  return {
    crewId: row.crew_id as string,
    fullName: (crewRow?.full_name as string | undefined) ?? "Unknown",
    employeeCode: (crewRow?.employee_code as string | null | undefined) ?? null,
  };
}

// Pure date-logic checks — no DB access, safe to call for every row in a
// bulk batch. `errors` should block the row from saving; `warnings`
// should not.
export function validateDocumentDates(issueDate: string | null, expiryDate: string | null): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (issueDate && expiryDate) {
    const issue = new Date(issueDate);
    const expiry = new Date(expiryDate);
    if (!Number.isNaN(issue.getTime()) && !Number.isNaN(expiry.getTime()) && issue.getTime() > expiry.getTime()) {
      errors.push(`Issue date (${issueDate}) is after the expiry date (${expiryDate}) — check these two fields.`);
    }
  }

  if (expiryDate) {
    const expiry = new Date(expiryDate);
    if (!Number.isNaN(expiry.getTime())) {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      if (expiry.getTime() < today.getTime()) {
        warnings.push(`This document already expired on ${expiryDate} — saved as-is, but check whether a renewed copy should be uploaded instead.`);
      }
    }
  }

  return { errors, warnings };
}
