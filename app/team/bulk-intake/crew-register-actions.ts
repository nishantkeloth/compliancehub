"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveAccess, can } from "@/lib/rbac";
import { mapName, type Alias, type Mapping } from "@/lib/ai/mapping";

// Bulk Data Migration — Crew Register Import. Deterministic column-mapped
// parse of the workbook Nishant fills from crew-legacy-import-template.xlsx
// (two tabs: "Crew Profile", "Documents"), reusing the same
// extract→review→commit shape as the single-person AI intake
// (app/crew/profiles/intake-actions.ts) and the same name-matching engine
// (lib/ai/mapping.ts) — but no AI call, since the columns are already
// known. Gated on crew.bulk_intake.manage (0027_bulk_intake_permission.sql,
// company_admin only) in addition to the usual crew.manage /
// crew.documents.manage that crew_profiles/crew_documents RLS requires.

const EMPLOYMENT_STATUSES = new Set(["candidate", "active", "inactive"]);
const EMPLOYMENT_TYPES = new Set(["permanent", "temporary", "subcontractor", "freelancer"]);
const MAX_ROWS = 5000;

async function requireBulkIntakeAccess() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "crew.bulk_intake.manage")) throw new Error("Bulk Data Migration is restricted to company admins.");
  if (!can(access, "crew.manage")) throw new Error("You don't have permission to manage crew profiles.");
  if (!access.orgId) throw new Error("No company context.");
  return { supabase, access, userId: user.id, orgId: access.orgId };
}

/* ================= parsing helpers ================= */

function normHeader(h: unknown): string {
  return String(h ?? "")
    .replace(/\*/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function cellStr(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return null; // callers that expect text shouldn't see a Date here
  const s = String(v).trim();
  return s.length ? s : null;
}

function cellDate(v: unknown): { value: string | null; invalid: boolean } {
  if (v == null || v === "") return { value: null, invalid: false };
  if (v instanceof Date) {
    // XLSX (cellDates: true) builds this Date from the serial's UTC y/m/d —
    // read it back with the UTC getters or a real Excel date shifts by the
    // server's local offset.
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, "0");
    const d = String(v.getUTCDate()).padStart(2, "0");
    return { value: `${y}-${m}-${d}`, invalid: false };
  }
  const s = String(v).trim();
  if (!s) return { value: null, invalid: false };
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { value: s, invalid: false };
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getUTCFullYear();
    const m = String(parsed.getUTCMonth() + 1).padStart(2, "0");
    const d = String(parsed.getUTCDate()).padStart(2, "0");
    return { value: `${y}-${m}-${d}`, invalid: false };
  }
  return { value: null, invalid: true };
}

function cellNumber(v: unknown): { value: number | null; invalid: boolean } {
  if (v == null || v === "") return { value: null, invalid: false };
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (Number.isNaN(n)) return { value: null, invalid: true };
  return { value: n, invalid: false };
}

function isExampleRow(employeeCodeRaw: unknown): boolean {
  return /\(example/i.test(String(employeeCodeRaw ?? ""));
}

function findSheet(sheetNames: string[], wanted: string): string | null {
  const target = normHeader(wanted);
  return sheetNames.find((n) => normHeader(n) === target) ?? null;
}

/* ================= types ================= */

export type ParsedProfileRow = {
  rowNumber: number;
  employeeCode: string;
  fullName: string;
  jobRoleName: string | null;
  jobRoleMapping: Mapping | null;
  employmentStatus: string;
  employmentType: string | null;
  nationality: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  phone: string | null;
  email: string | null;
  homeCountry: string | null;
  currentLocation: string | null;
  nearestAirport: string | null;
  joiningDate: string | null;
  noticePeriodDays: number | null;
  availabilityDate: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  dayRate: number | null;
  currency: string | null;
  dietaryMedicalNotes: string | null;
  notes: string | null;
  errors: string[];
  warnings: string[];
  duplicateOf: { id: string; fullName: string; employeeCode: string | null } | null;
};

export type ParsedDocumentRow = {
  rowNumber: number;
  employeeCode: string;
  documentTypeName: string;
  mapping: Mapping | null;
  documentNumber: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  notes: string | null;
  errors: string[];
};

export type CrewRegisterPreview = {
  sourceFilename: string;
  profiles: ParsedProfileRow[];
  documents: ParsedDocumentRow[];
  unmatchedJobRoles: string[];
  unmatchedDocumentTypes: string[];
  masterData: { jobRoles: { id: string; name: string }[]; documentTypes: { id: string; name: string }[] };
};

/* ================= parse ================= */

export async function parseCrewRegisterFile(formData: FormData): Promise<{ preview: CrewRegisterPreview } | { error: string }> {
  const { supabase, orgId } = await requireBulkIntakeAccess();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose the filled-in crew register workbook (.xlsx)." };
  if (file.size > 15 * 1024 * 1024) return { error: `"${file.name}" is larger than the 15 MB limit.` };

  const XLSX = await import("xlsx");
  let wb: ReturnType<typeof XLSX.read>;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    wb = XLSX.read(bytes, { type: "array", cellDates: true });
  } catch {
    return { error: `Couldn't open "${file.name}" — make sure it's a valid .xlsx file and try again.` };
  }

  const profileSheetName = findSheet(wb.SheetNames, "Crew Profile");
  const documentsSheetName = findSheet(wb.SheetNames, "Documents");
  if (!profileSheetName || !documentsSheetName) {
    return {
      error: `Couldn't find the expected tabs. Found: ${wb.SheetNames.join(", ") || "(none)"}. This file needs tabs named exactly "Crew Profile" and "Documents" — download a fresh copy of the template if these were renamed.`,
    };
  }

  const profileRows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[profileSheetName], { header: 1, defval: null, raw: true }) as unknown[][];
  const documentRows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[documentsSheetName], { header: 1, defval: null, raw: true }) as unknown[][];
  if (profileRows.length + documentRows.length > MAX_ROWS) {
    return { error: `This file has more than ${MAX_ROWS} rows combined — split it into smaller batches.` };
  }

  const [jr, dt, al, existingCrew] = await Promise.all([
    supabase.from("job_roles").select("id, name").eq("org_id", orgId).eq("is_active", true).order("name"),
    supabase.from("document_types").select("id, name").eq("org_id", orgId).eq("is_active", true).order("name"),
    supabase.from("ai_name_aliases").select("entity_type, alias, target_id").eq("org_id", orgId),
    supabase.from("crew_profiles").select("id, full_name, employee_code").eq("org_id", orgId),
  ]);
  const jobRoles = jr.data ?? [];
  const documentTypes = dt.data ?? [];
  const aliases = (al.data ?? []) as Alias[];
  const existing = existingCrew.data ?? [];
  const existingByCode = new Map(existing.filter((c) => c.employee_code).map((c) => [String(c.employee_code).trim().toLowerCase(), c]));
  const existingByName = new Map(existing.map((c) => [String(c.full_name).trim().toLowerCase(), c]));

  // ---- Crew Profile tab ----
  const pHeader = (profileRows[0] ?? []).map(normHeader);
  const pIdx = (label: string) => pHeader.indexOf(normHeader(label));
  const col = {
    employeeCode: pIdx("Employee Code"),
    fullName: pIdx("Full Name"),
    jobRole: pIdx("Job Role"),
    employmentStatus: pIdx("Employment Status"),
    employmentType: pIdx("Employment Type"),
    nationality: pIdx("Nationality"),
    dateOfBirth: pIdx("Date of Birth"),
    gender: pIdx("Gender"),
    phone: pIdx("Phone"),
    email: pIdx("Email"),
    homeCountry: pIdx("Home Country"),
    currentLocation: pIdx("Current Location"),
    nearestAirport: pIdx("Nearest Airport"),
    joiningDate: pIdx("Joining Date"),
    noticePeriodDays: pIdx("Notice Period Days"),
    availabilityDate: pIdx("Availability Date"),
    emergencyContactName: pIdx("Emergency Contact Name"),
    emergencyContactPhone: pIdx("Emergency Contact Phone"),
    dayRate: pIdx("Day Rate"),
    currency: pIdx("Currency"),
    dietaryMedicalNotes: pIdx("Dietary Medical Notes"),
    notes: pIdx("Notes"),
  };
  if (col.employeeCode < 0 || col.fullName < 0) {
    return { error: `The "Crew Profile" tab is missing the Employee Code or Full Name column — download a fresh copy of the template.` };
  }

  const seenCodes = new Map<string, number>(); // code(lower) -> first row number seen
  const jobRoleMappingCache = new Map<string, Mapping>();
  const profiles: ParsedProfileRow[] = [];

  for (let r = 1; r < profileRows.length; r++) {
    const row = profileRows[r] ?? [];
    const employeeCodeRaw = row[col.employeeCode];
    const fullNameRaw = row[col.fullName];
    if (isExampleRow(employeeCodeRaw)) continue;
    const employeeCode = cellStr(employeeCodeRaw);
    const fullName = cellStr(fullNameRaw);
    // A fully blank row (common trailing spreadsheet rows) is silently skipped.
    if (!employeeCode && !fullName && row.every((c) => c == null || String(c).trim() === "")) continue;

    const rowNumber = r + 1; // 1-based, matches what the user sees in Excel
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!employeeCode) errors.push("Employee Code is required.");
    if (!fullName) errors.push("Full Name is required.");

    const codeKey = employeeCode?.toLowerCase() ?? "";
    if (employeeCode) {
      const firstRow = seenCodes.get(codeKey);
      if (firstRow) errors.push(`Duplicate Employee Code — already used on row ${firstRow}.`);
      else seenCodes.set(codeKey, rowNumber);
    }

    const jobRoleNameRaw = cellStr(row[col.jobRole]);
    let jobRoleMapping: Mapping | null = null;
    if (jobRoleNameRaw) {
      const key = jobRoleNameRaw.trim().toLowerCase();
      jobRoleMapping = jobRoleMappingCache.get(key) ?? mapName(jobRoleNameRaw, "job_role", jobRoles, aliases);
      jobRoleMappingCache.set(key, jobRoleMapping);
      if (!jobRoleMapping.targetId) warnings.push(`Job Role "${jobRoleNameRaw}" doesn't match anything in Crew Setup — resolve it below.`);
    }

    const statusRaw = cellStr(row[col.employmentStatus]);
    let employmentStatus = "active";
    if (statusRaw) {
      const s = statusRaw.toLowerCase();
      if (EMPLOYMENT_STATUSES.has(s)) employmentStatus = s;
      else errors.push(`Employment Status "${statusRaw}" isn't one of candidate, active, inactive.`);
    }
    const typeRaw = cellStr(row[col.employmentType]);
    let employmentType: string | null = null;
    if (typeRaw) {
      const t = typeRaw.toLowerCase();
      if (EMPLOYMENT_TYPES.has(t)) employmentType = t;
      else errors.push(`Employment Type "${typeRaw}" isn't one of permanent, temporary, subcontractor, freelancer.`);
    }

    const dob = cellDate(row[col.dateOfBirth]);
    if (dob.invalid) errors.push("Date of Birth isn't a recognizable date.");
    const joining = cellDate(row[col.joiningDate]);
    if (joining.invalid) errors.push("Joining Date isn't a recognizable date.");
    const availability = cellDate(row[col.availabilityDate]);
    if (availability.invalid) errors.push("Availability Date isn't a recognizable date.");
    const notice = cellNumber(row[col.noticePeriodDays]);
    if (notice.invalid) errors.push("Notice Period Days isn't a number.");
    const dayRate = cellNumber(row[col.dayRate]);
    if (dayRate.invalid) errors.push("Day Rate isn't a number.");

    let duplicateOf: ParsedProfileRow["duplicateOf"] = null;
    if (employeeCode && existingByCode.has(codeKey)) {
      const m = existingByCode.get(codeKey)!;
      duplicateOf = { id: m.id as string, fullName: m.full_name as string, employeeCode: (m.employee_code as string | null) ?? null };
      warnings.push(`Employee Code already exists in ComplianceHub (${m.full_name}) — this row would create a second profile.`);
    } else if (fullName && existingByName.has(fullName.trim().toLowerCase())) {
      const m = existingByName.get(fullName.trim().toLowerCase())!;
      duplicateOf = { id: m.id as string, fullName: m.full_name as string, employeeCode: (m.employee_code as string | null) ?? null };
      warnings.push(`A crew member named "${fullName}" already exists in ComplianceHub — check this isn't the same person.`);
    }

    profiles.push({
      rowNumber,
      employeeCode: employeeCode ?? "",
      fullName: fullName ?? "",
      jobRoleName: jobRoleNameRaw,
      jobRoleMapping,
      employmentStatus,
      employmentType,
      nationality: cellStr(row[col.nationality]),
      dateOfBirth: dob.value,
      gender: cellStr(row[col.gender]),
      phone: cellStr(row[col.phone]),
      email: cellStr(row[col.email]),
      homeCountry: cellStr(row[col.homeCountry]),
      currentLocation: cellStr(row[col.currentLocation]),
      nearestAirport: cellStr(row[col.nearestAirport]),
      joiningDate: joining.value,
      noticePeriodDays: notice.value,
      availabilityDate: availability.value,
      emergencyContactName: cellStr(row[col.emergencyContactName]),
      emergencyContactPhone: cellStr(row[col.emergencyContactPhone]),
      dayRate: dayRate.value,
      currency: cellStr(row[col.currency]),
      dietaryMedicalNotes: cellStr(row[col.dietaryMedicalNotes]),
      notes: cellStr(row[col.notes]),
      errors,
      warnings,
      duplicateOf,
    });
  }

  // ---- Documents tab ----
  const dHeader = (documentRows[0] ?? []).map(normHeader);
  const dIdx = (label: string) => dHeader.indexOf(normHeader(label));
  const dcol = {
    employeeCode: dIdx("Employee Code"),
    documentType: dIdx("Document Type"),
    documentNumber: dIdx("Document Number"),
    issueDate: dIdx("Issue Date"),
    expiryDate: dIdx("Expiry Date"),
    notes: dIdx("Notes"),
  };
  if (dcol.employeeCode < 0 || dcol.documentType < 0) {
    return { error: `The "Documents" tab is missing the Employee Code or Document Type column — download a fresh copy of the template.` };
  }

  const validProfileCodes = new Set(profiles.filter((p) => p.errors.length === 0).map((p) => p.employeeCode.toLowerCase()));
  const docTypeMappingCache = new Map<string, Mapping>();
  const documents: ParsedDocumentRow[] = [];

  for (let r = 1; r < documentRows.length; r++) {
    const row = documentRows[r] ?? [];
    const employeeCodeRaw = row[dcol.employeeCode];
    if (isExampleRow(employeeCodeRaw)) continue;
    const employeeCode = cellStr(employeeCodeRaw);
    const documentTypeName = cellStr(row[dcol.documentType]);
    if (!employeeCode && !documentTypeName && row.every((c) => c == null || String(c).trim() === "")) continue;

    const rowNumber = r + 1;
    const errors: string[] = [];
    if (!employeeCode) errors.push("Employee Code is required.");
    else if (!validProfileCodes.has(employeeCode.toLowerCase())) errors.push(`Employee Code "${employeeCode}" wasn't found on the Crew Profile tab (or that row has errors).`);
    if (!documentTypeName) errors.push("Document Type is required.");

    let mapping: Mapping | null = null;
    if (documentTypeName) {
      const key = documentTypeName.trim().toLowerCase();
      mapping = docTypeMappingCache.get(key) ?? mapName(documentTypeName, "document_type", documentTypes, aliases);
      docTypeMappingCache.set(key, mapping);
    }

    const issue = cellDate(row[dcol.issueDate]);
    if (issue.invalid) errors.push("Issue Date isn't a recognizable date.");
    const expiry = cellDate(row[dcol.expiryDate]);
    if (expiry.invalid) errors.push("Expiry Date isn't a recognizable date.");

    documents.push({
      rowNumber,
      employeeCode: employeeCode ?? "",
      documentTypeName: documentTypeName ?? "",
      mapping,
      documentNumber: cellStr(row[dcol.documentNumber]),
      issueDate: issue.value,
      expiryDate: expiry.value,
      notes: cellStr(row[dcol.notes]),
      errors,
    });
  }

  const unmatchedJobRoles = [...jobRoleMappingCache.entries()].filter(([, m]) => !m.targetId).map(([, m]) => m.name);
  const unmatchedDocumentTypes = [...docTypeMappingCache.entries()].filter(([, m]) => !m.targetId).map(([, m]) => m.name);

  return {
    preview: {
      sourceFilename: file.name,
      profiles,
      documents,
      unmatchedJobRoles,
      unmatchedDocumentTypes,
      masterData: { jobRoles, documentTypes },
    },
  };
}

/* ================= commit ================= */

type CommitProfile = {
  employeeCode: string;
  fullName: string;
  jobRoleId: string | null;
  newJobRoleName: string | null;
  employmentStatus: string;
  employmentType: string | null;
  nationality: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  phone: string | null;
  email: string | null;
  homeCountry: string | null;
  currentLocation: string | null;
  nearestAirport: string | null;
  joiningDate: string | null;
  noticePeriodDays: number | null;
  availabilityDate: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  dayRate: number | null;
  currency: string | null;
  dietaryMedicalNotes: string | null;
  notes: string | null;
};
type CommitDocument = {
  employeeCode: string;
  documentTypeId: string | null;
  newDocumentTypeName: string | null;
  documentNumber: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  notes: string | null;
};
type CommitPayload = { profiles: CommitProfile[]; documents: CommitDocument[] };

export type CommitResult = {
  createdProfiles: number;
  createdDocuments: number;
  errors: string[];
};

export async function commitCrewRegisterImport(payloadJson: string): Promise<{ result: CommitResult } | { error: string }> {
  const { supabase, access, userId, orgId } = await requireBulkIntakeAccess();
  let payload: CommitPayload;
  try {
    payload = JSON.parse(payloadJson);
  } catch {
    return { error: "Invalid payload." };
  }
  if (!payload.profiles.length) return { error: "Nothing to import — every row was excluded." };

  const canDocuments = can(access, "crew.documents.manage");
  const roleCache = new Map<string, string>();
  const docTypeCache = new Map<string, string>();
  const ensure = async (table: "job_roles" | "document_types", name: string, cache: Map<string, string>, extra: Record<string, unknown> = {}): Promise<string> => {
    const key = name.trim().toLowerCase();
    if (cache.has(key)) return cache.get(key)!;
    const { data: found } = await supabase.from(table).select("id").eq("org_id", orgId).ilike("name", name.trim()).maybeSingle();
    if (found) {
      cache.set(key, found.id as string);
      return found.id as string;
    }
    const { data, error } = await supabase.from(table).insert({ org_id: orgId, name: name.trim(), ...extra }).select("id").single();
    if (error) throw new Error(`Could not create ${table.replace(/_/g, " ")} "${name}": ${error.message}`);
    cache.set(key, data!.id as string);
    return data!.id as string;
  };

  const errors: string[] = [];
  const crewIdByCode = new Map<string, string>();
  let createdProfiles = 0;
  let createdDocuments = 0;

  for (const p of payload.profiles) {
    try {
      const jobRoleId = p.jobRoleId ?? (p.newJobRoleName ? await ensure("job_roles", p.newJobRoleName, roleCache, { created_by: userId }) : null);
      const { data, error } = await supabase
        .from("crew_profiles")
        .insert({
          org_id: orgId,
          employee_code: p.employeeCode,
          full_name: p.fullName,
          primary_job_role_id: jobRoleId,
          employment_status: p.employmentStatus || "active",
          employment_type: p.employmentType,
          nationality: p.nationality,
          date_of_birth: p.dateOfBirth,
          gender: p.gender,
          phone: p.phone,
          email: p.email,
          home_country: p.homeCountry,
          current_location: p.currentLocation,
          nearest_airport: p.nearestAirport,
          joining_date: p.joiningDate,
          notice_period_days: p.noticePeriodDays,
          availability_date: p.availabilityDate,
          emergency_contact_name: p.emergencyContactName,
          emergency_contact_phone: p.emergencyContactPhone,
          day_rate: p.dayRate,
          currency: p.currency,
          dietary_medical_notes: p.dietaryMedicalNotes,
          notes: p.notes,
          created_by: userId,
          updated_by: userId,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      crewIdByCode.set(p.employeeCode.toLowerCase(), data!.id as string);
      createdProfiles++;
    } catch (e) {
      errors.push(`${p.employeeCode} (${p.fullName}): ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (payload.documents.length && !canDocuments) {
    errors.push(`${payload.documents.length} document row(s) were skipped — you don't have permission to manage crew documents.`);
  } else {
    for (const d of payload.documents) {
      const crewId = crewIdByCode.get(d.employeeCode.toLowerCase());
      if (!crewId) continue; // that profile row failed above; already reported
      try {
        const docTypeId = d.documentTypeId ?? (d.newDocumentTypeName ? await ensure("document_types", d.newDocumentTypeName, docTypeCache, { category: "certificate", tracks_number: true, created_by: userId }) : null);
        if (!docTypeId) {
          errors.push(`${d.employeeCode} / ${d.newDocumentTypeName ?? "document"}: no document type resolved — skipped.`);
          continue;
        }
        const { error } = await supabase.from("crew_documents").insert({
          org_id: orgId,
          crew_id: crewId,
          document_type_id: docTypeId,
          document_number: d.documentNumber,
          issue_date: d.issueDate,
          expiry_date: d.expiryDate,
          notes: d.notes,
          created_by: userId,
          updated_by: userId,
        });
        if (error) throw new Error(error.message);
        createdDocuments++;
      } catch (e) {
        errors.push(`${d.employeeCode} document: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  revalidatePath("/crew/profiles");
  revalidatePath("/crew/documents");
  return { result: { createdProfiles, createdDocuments, errors } };
}
