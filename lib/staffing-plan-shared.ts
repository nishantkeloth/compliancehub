// Shared, plain (non-"use client") helpers for anything that renders a
// Staffing Plan-shaped view of crew-matrix data: the Staffing Plan tab
// itself (staffing-plan.tsx), the Excel export it triggers client-side,
// and the server-side Crew Matrix Sharing feature (share-actions.ts),
// which needs to build the exact same Excel file and the exact same
// document-status text server-side, from a snapshot rather than live
// props. Keeping this logic in one plain module — importable from both
// "use client" and server-only code — is what keeps all three call
// sites from drifting apart. See staffing-plan.tsx's own header comment
// for the on-screen behavior this backs.

import { computeDocumentStatus, type DocumentStatus } from "@/lib/document-status";

// Narrow, structural subsets of the real Line/DocTypeRef types
// (app/crew/matrices/[id]/lines-editor.tsx) — defined locally rather than
// imported from there so this module has no dependency on a specific
// route's types, and so a snapshot-shaped object (reconstructed from a
// database row rather than the live editor state) satisfies it too.
export type DocTypeRef = {
  id: string;
  name: string;
  category: string | null;
  warning_threshold_days: number | null;
  tracks_number: boolean;
};

export type LineLike = {
  id: string;
  line_number: number;
  job_role_id: string;
  job_role_name: string;
  required_headcount: number;
  documents: { document_type_id: string; is_mandatory: boolean }[];
};

export type StaffingCrew = {
  crew_id: string;
  full_name: string;
  nationality: string | null;
  job_role_id: string;
  availability_date?: string | null;
  documents: Record<string, { document_number: string | null; issue_date: string | null; expiry_date: string | null; custom_fields: Record<string, unknown> | null }>;
};

export type FieldDef = { id: string; label: string; field_key: string; applies_to_document_type_id: string | null };

// Light, low-contrast pastel fills for category header bands — assigned per
// category (see buildCategoryColorMap) so the same category always gets the
// same shade whichever rank's table it appears in.
export const CATEGORY_BAND_COLORS = ["#eef2ff", "#ecfdf5", "#fff7ed", "#fdf2f8", "#f0f9ff", "#fefce8", "#f3f4f6"];
export const UNCATEGORIZED_KEY = "\u0000general";

// "certificate" -> "CERTIFICATES", "travel_document" -> "TRAVEL DOCUMENTS".
// Uncategorized document types are clubbed under a plain "GENERAL" band.
export function formatCategoryLabel(category: string | null): string {
  if (!category) return "GENERAL";
  const upper = category.replace(/[_-]+/g, " ").trim().toUpperCase();
  return /S$/.test(upper) ? upper : `${upper}S`;
}

export type CategoryGroup = { category: string | null; count: number };

// Groups a rank's own applicable columns into contiguous same-category runs
// (columns are pre-sorted by category, so same-category columns are always
// adjacent). Used for both the header band spans and the Excel export.
export function groupByCategory(cols: DocTypeRef[]): { groups: CategoryGroup[]; groupIndex: number[] } {
  const groups: CategoryGroup[] = [];
  const groupIndex: number[] = [];
  for (const col of cols) {
    const last = groups[groups.length - 1];
    if (last && last.category === col.category) {
      last.count += 1;
    } else {
      groups.push({ category: col.category, count: 1 });
    }
    groupIndex.push(groups.length - 1);
  }
  return { groups, groupIndex };
}

export function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// Single source of truth for what a document cell should say, shared by the
// on-screen table (DocCell in staffing-plan.tsx), the Excel export, and the
// crew-matrix-share snapshot/public page — so the three never drift.
export type CellInfo = { text: string; kind: "na" | "missing" | "empty" | "value"; status?: DocumentStatus };

export function cellInfo(
  required: boolean,
  docType: DocTypeRef,
  doc: StaffingCrew["documents"][string] | undefined,
  fieldDefs: FieldDef[]
): CellInfo {
  if (!required) return { text: "N/A", kind: "na" };
  if (!doc) return { text: "Missing", kind: "missing" };

  const parts: string[] = [];
  let status: DocumentStatus | undefined;

  if (docType.tracks_number && doc.document_number) parts.push(doc.document_number);

  // Travel documents (passport, seaman's book, offshore ID, etc.) carry
  // both an issue date and an expiry date — show both, labeled, rather
  // than just the expiry. Other categories keep the unlabeled single-date
  // format they've always had.
  const showsBothDates = docType.category === "travel_document" && !!doc.issue_date && !!doc.expiry_date;
  if (showsBothDates) {
    parts.push(`Iss ${formatDate(doc.issue_date) ?? doc.issue_date}`);
  }

  if (doc.expiry_date) {
    const r = computeDocumentStatus(doc.expiry_date, docType.warning_threshold_days, docType.category);
    status = r.status;
    const expiryText = formatDate(doc.expiry_date) ?? doc.expiry_date;
    parts.push(showsBothDates ? `Exp ${expiryText}` : expiryText);
  } else if (doc.issue_date) {
    // One-time attendance records (e.g. MOSI, Project HSE Induction) carry
    // no expiry — show the date it was completed, unstyled.
    parts.push(formatDate(doc.issue_date) ?? doc.issue_date);
  }

  for (const f of fieldDefs) {
    const value = doc.custom_fields?.[f.field_key];
    if (value !== undefined && value !== null && value !== "") parts.push(`${f.label}: ${value}`);
  }

  if (parts.length === 0) return { text: "On file, no date/number set", kind: "empty" };
  return { text: parts.join(" · "), kind: "value", status };
}

// Canonical, matrix-wide document-type column order: by category, then
// alphabetically within it, uncategorized last. Both the Staffing Plan
// screen and the share/export builders derive their per-rank column subset
// by filtering this same order, so category grouping and left-to-right
// order always agree everywhere this data is rendered.
export function orderDocumentColumns(documentTypes: DocTypeRef[], usedDocTypeIds: Set<string>): DocTypeRef[] {
  return documentTypes
    .filter((d) => usedDocTypeIds.has(d.id))
    .sort((a, b) => {
      const catA = a.category ?? "￿";
      const catB = b.category ?? "￿";
      if (catA !== catB) return catA.localeCompare(catB);
      return a.name.localeCompare(b.name);
    });
}

export function buildCategoryColorMap(columns: DocTypeRef[]): Map<string, string> {
  const map = new Map<string, string>();
  const { groups } = groupByCategory(columns);
  groups.forEach((g, i) => {
    map.set(g.category ?? UNCATEGORIZED_KEY, CATEGORY_BAND_COLORS[i % CATEGORY_BAND_COLORS.length]);
  });
  return map;
}

// Builds the same styled ExcelJS workbook used by the Staffing Plan tab's
// own "Export to Excel" button — one worksheet per rank that has at least
// one person in `crewList`, category-band header rows (merged + colored +
// centered), a mandatory "*", and one row per person. Used both by that
// on-screen button (client-side, triggers a download) and by the Crew
// Matrix Sharing feature (server-side, attached to the share email) so the
// two attachments can never look different from one another.
//
// Takes an already-constructed ExcelJS module (the caller dynamic-imports
// it) rather than importing it itself, since the right way to load it
// differs between a browser bundle and a server action.
export async function buildStaffingPlanWorkbook(
  ExcelJS: typeof import("exceljs"),
  orderedLines: LineLike[],
  crewList: StaffingCrew[],
  documentTypes: DocTypeRef[],
  customFieldDefinitions: FieldDef[]
): Promise<InstanceType<typeof ExcelJS.Workbook>> {
  const usedDocTypeIds = new Set<string>();
  for (const line of orderedLines) {
    for (const doc of line.documents) usedDocTypeIds.add(doc.document_type_id);
  }
  const columns = orderDocumentColumns(documentTypes, usedDocTypeIds);
  const categoryColorMap = buildCategoryColorMap(columns);
  const colorForCategory = (category: string | null) => categoryColorMap.get(category ?? UNCATEGORIZED_KEY) ?? CATEGORY_BAND_COLORS[0];

  const wb = new ExcelJS.Workbook();
  const usedSheetNames = new Set<string>();
  const HEADER_BORDER = { style: "thin" as const, color: { argb: "FFD0D5DD" } };
  const GROUP_DIVIDER = { style: "thin" as const, color: { argb: "FF9CA3AF" } };

  for (const line of orderedLines) {
    const crewForLine = crewList.filter((c) => c.job_role_id === line.job_role_id).sort((a, b) => a.full_name.localeCompare(b.full_name));
    if (crewForLine.length === 0) continue;

    const requiredDocTypeIds = new Set(line.documents.map((d) => d.document_type_id));
    const mandatoryDocTypeIds = new Set(line.documents.filter((d) => d.is_mandatory).map((d) => d.document_type_id));
    const lineColumns = columns.filter((col) => requiredDocTypeIds.has(col.id));
    const { groups: lineGroups } = groupByCategory(lineColumns);

    let sheetName = line.job_role_name.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || "Rank";
    let suffix = 2;
    while (usedSheetNames.has(sheetName)) {
      sheetName = `${sheetName.slice(0, 28)} (${suffix++})`;
    }
    usedSheetNames.add(sheetName);

    const ws = wb.addWorksheet(sheetName, { views: [{ state: "frozen", ySplit: 2 }] });

    ws.addRow(["Name", "Nationality", ...lineGroups.flatMap((g) => [formatCategoryLabel(g.category), ...Array(g.count - 1).fill("")])]);
    ws.addRow(["", "", ...lineColumns.map((col) => (mandatoryDocTypeIds.has(col.id) ? `${col.name} *` : col.name))]);

    ws.mergeCells(1, 1, 2, 1);
    ws.mergeCells(1, 2, 2, 2);

    let colIdx = 3;
    lineGroups.forEach((g) => {
      if (g.count > 1) ws.mergeCells(1, colIdx, 1, colIdx + g.count - 1);
      const argb = `FF${colorForCategory(g.category).replace("#", "").toUpperCase()}`;
      for (let c = colIdx; c < colIdx + g.count; c++) {
        for (const rowNum of [1, 2]) {
          ws.getCell(rowNum, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
        }
      }
      colIdx += g.count;
    });

    for (const rowNum of [1, 2]) {
      const row = ws.getRow(rowNum);
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cell.font = { bold: true };
        cell.alignment = { horizontal: colNumber <= 2 ? "left" : "center", vertical: "middle", wrapText: true };
        const isGroupStart = colNumber > 2 && lineColumns[colNumber - 3] && (colNumber === 3 || lineColumns[colNumber - 4]?.category !== lineColumns[colNumber - 3]?.category);
        cell.border = { bottom: HEADER_BORDER, ...(isGroupStart ? { left: GROUP_DIVIDER } : {}) };
      });
    }

    for (const person of crewForLine) {
      ws.addRow([
        person.full_name,
        person.nationality ?? "",
        ...lineColumns.map((col) =>
          cellInfo(
            true,
            col,
            person.documents[col.id],
            customFieldDefinitions.filter((f) => f.applies_to_document_type_id === col.id || f.applies_to_document_type_id === null)
          ).text
        ),
      ]);
    }

    for (let c = 1; c <= lineColumns.length + 2; c++) {
      const header = c === 1 ? "Name" : c === 2 ? "Nationality" : lineColumns[c - 3]?.name ?? "";
      ws.getColumn(c).width = Math.max(12, Math.min(26, header.length + 4));
    }
  }

  if (usedSheetNames.size === 0) {
    wb.addWorksheet("Staffing Plan").addRow(["No crew to include."]);
  }

  return wb;
}
