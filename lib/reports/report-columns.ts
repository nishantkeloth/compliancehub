// Client Compliance Reports (Phase 10) — the column-source catalog and
// value resolver shared between the template builder UI
// (app/reports/template-editor.tsx, via the catalog), the preview screen,
// and the real workbook builder (build-report-workbook.ts). Keeping the
// catalog and the resolver in the same plain (non-"use client", no
// Supabase import) module is what keeps the "columns you can pick in the
// UI" list and "columns actually resolved at generate time" list from
// drifting apart — the same lesson as lib/staffing-plan-shared.ts.

import { computeDocumentStatus, type DocumentStatus } from "@/lib/document-status";

export type ReportColumn = {
  source: string; // see parseSource() below for the encoding
  header: string;
  groupHeader?: string | null;
  // "date" formats an ISO date as DD-MMM-YYYY; "number" is passed through
  // as-is. Only meaningful for sources that can return either shape
  // (custom fields); profile/document/computed sources already know
  // their own shape.
  dateFormat?: "date" | "text" | null;
};

export type ReportDocTypeRef = {
  id: string;
  name: string;
  category: string | null;
  warning_threshold_days: number | null;
};

export type ReportCustomFieldDef = {
  id: string;
  label: string;
  field_key: string;
  field_type: string;
  applies_to_document_type_id: string;
};

// One row of input data the resolver works against — assembled by
// app/reports/actions.ts from crew_profiles + crew_assignments +
// crew_documents (live, at generate/preview time) or read back verbatim
// from a report_send_packages.rows_snapshot (frozen, at history-view
// time) — same shape either way.
export type ReportCrewRow = {
  crew_id: string;
  full_name: string;
  nationality: string | null;
  employee_code: string | null;
  crew_code: string | null;
  job_role_name: string;
  is_key_officer: boolean;
  assignment_start_date: string | null; // crew_assignments.actual_start_date ?? start_date
  documents: Record<
    string,
    { document_number: string | null; issue_date: string | null; expiry_date: string | null; custom_fields: Record<string, unknown> | null }
  >;
};

export type ResolvedCell = { text: string; status: DocumentStatus | null };

type ParsedSource =
  | { kind: "profile"; field: "full_name" | "nationality" | "employee_code" | "crew_code" | "job_role_name" }
  | { kind: "document"; documentTypeId: string; field: "expiry" | "number" | "issue_date" }
  | { kind: "document_custom"; documentTypeId: string; fieldKey: string }
  | { kind: "computed"; field: "days_onboard_officer" | "days_onboard_rating" }
  | { kind: "static_blank" };

export function parseSource(source: string): ParsedSource {
  if (source === "profile.full_name") return { kind: "profile", field: "full_name" };
  if (source === "profile.nationality") return { kind: "profile", field: "nationality" };
  if (source === "profile.employee_code") return { kind: "profile", field: "employee_code" };
  if (source === "profile.crew_code") return { kind: "profile", field: "crew_code" };
  if (source === "profile.job_role_name") return { kind: "profile", field: "job_role_name" };
  if (source === "computed.days_onboard_officer") return { kind: "computed", field: "days_onboard_officer" };
  if (source === "computed.days_onboard_rating") return { kind: "computed", field: "days_onboard_rating" };
  if (source === "static.blank") return { kind: "static_blank" };

  let m = source.match(/^document\.([0-9a-f-]+)\.(expiry|number|issue_date)$/);
  if (m) return { kind: "document", documentTypeId: m[1], field: m[2] as "expiry" | "number" | "issue_date" };

  m = source.match(/^document\.([0-9a-f-]+)\.custom\.(.+)$/);
  if (m) return { kind: "document_custom", documentTypeId: m[1], fieldKey: m[2] };

  return { kind: "static_blank" };
}

function daysBetween(fromIso: string, toIso = new Date().toISOString().slice(0, 10)): number {
  const from = new Date(fromIso + "T00:00:00");
  const to = new Date(toIso + "T00:00:00");
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86400000));
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// Resolves one column for one row. Returns both the display text and,
// when the source is a document field, the computed status — so the
// workbook builder and the HTML preview can both color the cell without
// re-deriving the status themselves.
export function resolveColumn(column: ReportColumn, row: ReportCrewRow, docTypesById: Map<string, ReportDocTypeRef>): ResolvedCell {
  const parsed = parseSource(column.source);

  switch (parsed.kind) {
    case "profile": {
      switch (parsed.field) {
        case "full_name":
          return { text: row.full_name, status: null };
        case "nationality":
          return { text: row.nationality ?? "", status: null };
        case "employee_code":
          return { text: row.employee_code ?? "", status: null };
        case "crew_code":
          return { text: row.crew_code ?? "", status: null };
        case "job_role_name":
          return { text: row.job_role_name, status: null };
      }
      break;
    }
    case "computed": {
      if (!row.assignment_start_date) return { text: "", status: null };
      const isOfficerColumn = parsed.field === "days_onboard_officer";
      if (isOfficerColumn !== row.is_key_officer) return { text: "", status: null };
      return { text: String(daysBetween(row.assignment_start_date)), status: null };
    }
    case "document": {
      const doc = row.documents[parsed.documentTypeId];
      if (!doc) return { text: "", status: parsed.field === "expiry" ? "none" : null };
      if (parsed.field === "number") return { text: doc.document_number ?? "", status: null };
      if (parsed.field === "issue_date") return { text: formatDate(doc.issue_date), status: null };
      // expiry
      const docType = docTypesById.get(parsed.documentTypeId);
      const { status } = computeDocumentStatus(doc.expiry_date, docType?.warning_threshold_days ?? null, docType?.category ?? null);
      return { text: formatDate(doc.expiry_date), status };
    }
    case "document_custom": {
      const doc = row.documents[parsed.documentTypeId];
      const value = doc?.custom_fields?.[parsed.fieldKey];
      if (value === null || value === undefined) return { text: "", status: null };
      if (column.dateFormat === "date" && typeof value === "string") return { text: formatDate(value), status: null };
      return { text: String(value), status: null };
    }
    case "static_blank":
      return { text: "", status: null };
  }
  return { text: "", status: null };
}

// What the template-builder UI offers to add as a column — grouped the
// same way the sample client file groups its headers (Personnel Details
// / Mandatory Offshore Training / per-document custom fields), so an
// admin mapping a new client's layout picks from a list that already
// looks like the file they're matching.
export type ColumnCatalogEntry = { source: string; label: string; group: string; defaultDateFormat?: "date" | "text" | null };

export function buildColumnCatalog(docTypes: ReportDocTypeRef[], customFields: ReportCustomFieldDef[]): ColumnCatalogEntry[] {
  const catalog: ColumnCatalogEntry[] = [
    { source: "profile.full_name", label: "Full name", group: "Personnel Details" },
    { source: "profile.job_role_name", label: "Rank / role", group: "Personnel Details" },
    { source: "profile.nationality", label: "Nationality", group: "Personnel Details" },
    { source: "profile.employee_code", label: "Employee code", group: "Personnel Details" },
    { source: "profile.crew_code", label: "Crew code", group: "Personnel Details" },
    { source: "computed.days_onboard_officer", label: "Days onboard (Key Officer)", group: "Computed" },
    { source: "computed.days_onboard_rating", label: "Days onboard (Rating)", group: "Computed" },
    { source: "static.blank", label: "Blank column", group: "Other" },
  ];

  for (const dt of docTypes) {
    const group = `Document: ${dt.name}`;
    catalog.push({ source: `document.${dt.id}.expiry`, label: `${dt.name} — Expiry date`, group, defaultDateFormat: "date" });
    catalog.push({ source: `document.${dt.id}.number`, label: `${dt.name} — Document / card number`, group });
    catalog.push({ source: `document.${dt.id}.issue_date`, label: `${dt.name} — Issue date`, group, defaultDateFormat: "date" });
  }
  for (const cf of customFields) {
    const dt = docTypes.find((d) => d.id === cf.applies_to_document_type_id);
    const group = `Document: ${dt?.name ?? "Unknown"}`;
    catalog.push({
      source: `document.${cf.applies_to_document_type_id}.custom.${cf.field_key}`,
      label: `${dt?.name ?? "Unknown"} — ${cf.label}`,
      group,
      defaultDateFormat: cf.field_type === "date" ? "date" : "text",
    });
  }
  return catalog;
}
