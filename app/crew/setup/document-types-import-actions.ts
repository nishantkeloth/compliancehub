"use server";

// Excel bulk import for Document Types (Crew Setup → Document Types), for
// loading/replacing the reference list in one pass instead of one-by-one
// through "+ Add document type" — same two-step parse/commit shape as the
// Crew Register import (../bulk-intake/crew-register-actions.ts), but much
// simpler: document_types is a flat table with no AI matching to do, so
// parsing and validation both happen server-side in one call.
//
// Matching an uploaded row to an existing document type is by name only,
// case-insensitive — this org's document_types.name has no unique
// constraint, so a name that matches more than one existing row is treated
// as ambiguous and flagged rather than guessed at.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveAccess, can } from "@/lib/rbac";

async function requireCrewManage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "crew.manage")) throw new Error("You don't have permission to manage crew setup data.");
  if (!access.orgId) throw new Error("No company context.");
  return { supabase, orgId: access.orgId, userId: user.id };
}

const CATEGORY_VALUES = ["visa", "travel_document", "certificate", "vaccination"] as const;
type CategoryValue = (typeof CATEGORY_VALUES)[number];
const CATEGORY_ALIASES: Record<string, CategoryValue> = {
  visa: "visa",
  "travel document": "travel_document",
  travel_document: "travel_document",
  traveldocument: "travel_document",
  certificate: "certificate",
  vaccination: "vaccination",
};

export type DocumentTypeImportRow = {
  rowNumber: number;
  name: string;
  category: CategoryValue | null;
  defaultValidityMonths: number | null;
  warningThresholdDays: number | null;
  tracksNumber: boolean;
  isActive: boolean;
  action: "create" | "update";
  matchedId: string | null;
  errors: string[];
  warnings: string[];
};

export type DocumentTypesImportPreview = {
  rows: DocumentTypeImportRow[];
  existingCount: number;
  unmatchedExisting: { id: string; name: string }[];
};

function normalizeHeader(h: unknown): string {
  return String(h ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function findCol(headers: string[], candidates: string[]): number {
  for (const c of candidates) {
    const i = headers.indexOf(c);
    if (i !== -1) return i;
  }
  return -1;
}

function parseBool(v: unknown, defaultValue: boolean): boolean {
  if (v == null || v === "") return defaultValue;
  const s = String(v).trim().toLowerCase();
  if (["yes", "y", "true", "1"].includes(s)) return true;
  if (["no", "n", "false", "0"].includes(s)) return false;
  return defaultValue;
}

export async function parseDocumentTypesFile(formData: FormData): Promise<{ preview: DocumentTypesImportPreview } | { error: string }> {
  const { supabase, orgId } = await requireCrewManage();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose the filled-in document types workbook (.xlsx)." };
  if (file.size > 5 * 1024 * 1024) return { error: `"${file.name}" is larger than the 5 MB limit.` };

  const XLSX = await import("xlsx");
  let rows: unknown[][];
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const wb = XLSX.read(bytes, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as unknown[][];
  } catch {
    return { error: `Couldn't open "${file.name}" — make sure it's a valid .xlsx file and try again.` };
  }
  if (rows.length < 2) return { error: "That file has no data rows below the header." };

  const headers = (rows[0] ?? []).map(normalizeHeader);
  const nameCol = findCol(headers, ["document type name", "name", "document type"]);
  if (nameCol === -1) return { error: 'Couldn\'t find a "Document Type Name" column — use the template.' };
  const categoryCol = findCol(headers, ["category"]);
  const validityCol = findCol(headers, ["default validity (months)", "default validity months", "validity (months)", "validity months"]);
  const warningCol = findCol(headers, [
    "warning threshold (days before expiry)",
    "warning threshold (days)",
    "warning threshold days",
    "warning threshold",
  ]);
  const tracksNumberCol = findCol(headers, ["has document number (yes/no)", "has document number", "tracks number"]);
  const activeCol = findCol(headers, ["active (yes/no)", "active"]);

  const { data: existing, error: existingErr } = await supabase
    .from("document_types")
    .select("id, name")
    .eq("org_id", orgId);
  if (existingErr) return { error: existingErr.message };
  const existingByName = new Map<string, { id: string; name: string }[]>();
  for (const row of existing ?? []) {
    const key = String(row.name).trim().toLowerCase();
    const list = existingByName.get(key) ?? [];
    list.push({ id: row.id as string, name: row.name as string });
    existingByName.set(key, list);
  }

  const parsed: DocumentTypeImportRow[] = [];
  const matchedIds = new Set<string>();
  for (let i = 1; i < rows.length; i++) {
    const raw = rows[i];
    if (!raw || raw.every((c) => c == null || String(c).trim() === "")) continue;
    const rowNumber = i + 1;
    const errors: string[] = [];
    const warnings: string[] = [];

    const name = String(raw[nameCol] ?? "").trim();
    if (!name) errors.push("Document type name is required.");

    let category: CategoryValue | null = null;
    if (categoryCol !== -1) {
      const raw_cat = String(raw[categoryCol] ?? "").trim();
      if (raw_cat) {
        const key = raw_cat.toLowerCase().replace(/\s+/g, " ");
        category = CATEGORY_ALIASES[key] ?? null;
        if (!category) warnings.push(`Category "${raw_cat}" not recognized — left blank (Certificate/Visa/Travel document/Vaccination).`);
      }
    }

    let defaultValidityMonths: number | null = null;
    if (validityCol !== -1) {
      const raw_v = raw[validityCol];
      if (raw_v != null && String(raw_v).trim() !== "") {
        const n = Number(raw_v);
        if (Number.isFinite(n) && n > 0) defaultValidityMonths = Math.round(n);
        else warnings.push(`Default validity "${raw_v}" isn't a valid number of months — left blank.`);
      }
    }

    let warningThresholdDays: number | null = null;
    if (warningCol !== -1) {
      const raw_w = raw[warningCol];
      if (raw_w != null && String(raw_w).trim() !== "") {
        const n = Number(raw_w);
        if (Number.isFinite(n) && n > 0) warningThresholdDays = Math.round(n);
        else warnings.push(`Warning threshold "${raw_w}" isn't a valid number of days — left blank.`);
      }
    }

    const tracksNumber = parseBool(tracksNumberCol !== -1 ? raw[tracksNumberCol] : null, true);
    const isActive = parseBool(activeCol !== -1 ? raw[activeCol] : null, true);

    const matches = name ? existingByName.get(name.toLowerCase()) ?? [] : [];
    let action: "create" | "update" = "create";
    let matchedId: string | null = null;
    if (matches.length === 1) {
      action = "update";
      matchedId = matches[0].id;
      matchedIds.add(matchedId);
    } else if (matches.length > 1) {
      errors.push(`"${name}" matches ${matches.length} existing document types — rename one so the match is unambiguous, or handle it manually.`);
    }

    parsed.push({ rowNumber, name, category, defaultValidityMonths, warningThresholdDays, tracksNumber, isActive, action, matchedId, errors, warnings });
  }

  const unmatchedExisting = (existing ?? [])
    .filter((e) => !matchedIds.has(e.id as string))
    .map((e) => ({ id: e.id as string, name: e.name as string }));

  return { preview: { rows: parsed, existingCount: existing?.length ?? 0, unmatchedExisting } };
}

type CommitPayload = {
  rows: DocumentTypeImportRow[];
  deleteUnmatched: boolean;
};

export type DocumentTypesImportResult = {
  created: number;
  updated: number;
  deleted: number;
  deleteSkipped: { name: string; reason: string }[];
};

export async function commitDocumentTypesImport(payloadJson: string): Promise<{ result: DocumentTypesImportResult } | { error: string }> {
  const { supabase, orgId, userId } = await requireCrewManage();
  let payload: CommitPayload;
  try {
    payload = JSON.parse(payloadJson);
  } catch {
    return { error: "Malformed import payload." };
  }

  let created = 0;
  let updated = 0;
  for (const row of payload.rows) {
    if (row.errors.length || !row.name) continue;
    const values = {
      name: row.name,
      category: row.category,
      default_validity_months: row.defaultValidityMonths,
      warning_threshold_days: row.warningThresholdDays,
      tracks_number: row.tracksNumber,
      is_active: row.isActive,
    };
    if (row.action === "update" && row.matchedId) {
      const { error } = await supabase.from("document_types").update(values).eq("id", row.matchedId);
      if (error) return { error: `Couldn't update "${row.name}": ${error.message}` };
      updated++;
    } else {
      const { error } = await supabase.from("document_types").insert({ org_id: orgId, created_by: userId, ...values });
      if (error) return { error: `Couldn't create "${row.name}": ${error.message}` };
      created++;
    }
  }

  let deleted = 0;
  const deleteSkipped: { name: string; reason: string }[] = [];
  if (payload.deleteUnmatched) {
    // Anything not matched by a row in the file, re-checked against the
    // live set (not the pre-import preview) so a row imported just above
    // that also happens to be an update is never accidentally caught here.
    const matchedNow = new Set(payload.rows.filter((r) => r.action === "update" && r.matchedId && !r.errors.length).map((r) => r.matchedId as string));
    const { data: current, error: currentErr } = await supabase.from("document_types").select("id, name").eq("org_id", orgId);
    if (currentErr) return { error: currentErr.message };
    for (const row of current ?? []) {
      const id = row.id as string;
      if (matchedNow.has(id)) continue;
      const { error } = await supabase.from("document_types").delete().eq("id", id);
      if (error) {
        // Almost always a foreign-key block from crew_documents still
        // referencing this type — skip it and say so rather than failing
        // the whole import over one row still in use.
        deleteSkipped.push({ name: row.name as string, reason: "still in use by existing crew documents" });
        continue;
      }
      deleted++;
    }
  }

  revalidatePath("/crew/setup");
  return { result: { created, updated, deleted, deleteSkipped } };
}
