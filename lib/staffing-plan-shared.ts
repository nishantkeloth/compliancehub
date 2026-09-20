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
  // Phase 16 — the same free-text region string as offshore_sites/projects'
  // operating_region (see REGIONS in lib/regions.ts), used to sort/group
  // Available Candidates by whether they're based where the matrix's site
  // actually is.
  current_location?: string | null;
  documents: Record<string, { document_number: string | null; issue_date: string | null; expiry_date: string | null; custom_fields: Record<string, unknown> | null }>;
};

// Phase 16 — "how much of this rank's required documentation does this
// person already have", as a 0-100 percentage: a required document type
// counts as complete when a crew_documents record exists for it AND (if it
// carries an expiry date) that date hasn't already passed — matching
// exactly what DocCell would render as anything other than "Missing" or
// "Expired". A rank with no required documents at all reads as 100% (there
// is nothing to be missing). Used to sort Available Candidates by
// readiness instead of alphabetically.
export function computeCompleteness(requiredDocs: { document_type_id: string; is_mandatory: boolean }[], documentTypes: DocTypeRef[], docs: StaffingCrew["documents"]): number {
  if (requiredDocs.length === 0) return 100;
  let complete = 0;
  for (const req of requiredDocs) {
    const doc = docs[req.document_type_id];
    if (!doc) continue;
    const docType = documentTypes.find((d) => d.id === req.document_type_id);
    const { status } = computeDocumentStatus(doc.expiry_date, docType?.warning_threshold_days ?? null, docType?.category ?? null);
    if (status !== "expired") complete += 1;
  }
  return Math.round((complete / requiredDocs.length) * 100);
}

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
// Generic over anything carrying a `category` field so it works on both raw
// DocTypeRef columns and the expanded DisplayColumn list below (a travel
// document counts as two adjacent columns here, same category, so the band
// still spans over both without any special-casing).
export function groupByCategory<T extends { category: string | null }>(cols: T[]): { groups: CategoryGroup[]; groupIndex: number[] } {
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

// A document type that carries its own number and/or dates is broken out
// into its own columns instead of one combined "number · date" cell, so
// each field can be scanned/sorted independently:
//  - travel_document (passport, seaman's book, offshore ID, ...): Number
//    (if tracked) + Issued + Expiry — three columns.
//  - any other category that tracks a number (most certificates): Number +
//    Date — two columns.
//  - anything else (no number, e.g. a one-time attendance record): stays a
//    single column, unchanged.
// This is the one place that decides the split, so the on-screen table and
// the Excel export can't disagree about which document types get which
// columns.
export type DisplayColumnPart = "single" | "number" | "issued" | "expiry" | "date";
export type DisplayColumn = { key: string; docType: DocTypeRef; part: DisplayColumnPart; category: string | null };

export function expandColumns(columns: DocTypeRef[]): DisplayColumn[] {
  const out: DisplayColumn[] = [];
  for (const col of columns) {
    if (col.category === "travel_document") {
      if (col.tracks_number) out.push({ key: `${col.id}:number`, docType: col, part: "number", category: col.category });
      out.push({ key: `${col.id}:issued`, docType: col, part: "issued", category: col.category });
      out.push({ key: `${col.id}:expiry`, docType: col, part: "expiry", category: col.category });
    } else if (col.tracks_number) {
      out.push({ key: `${col.id}:number`, docType: col, part: "number", category: col.category });
      out.push({ key: `${col.id}:date`, docType: col, part: "date", category: col.category });
    } else {
      out.push({ key: col.id, docType: col, part: "single", category: col.category });
    }
  }
  return out;
}

// Groups an expanded display-column list back into contiguous runs that
// belong to the same document type (a split travel document's Issued+Expiry
// pair, or a lone single-part column) — used to span the document-name
// header cell over its own sub-columns.
export function groupByDocType(cols: DisplayColumn[]): { docType: DocTypeRef; count: number }[] {
  const groups: { docType: DocTypeRef; count: number }[] = [];
  for (const col of cols) {
    const last = groups[groups.length - 1];
    if (last && last.docType.id === col.docType.id) {
      last.count += 1;
    } else {
      groups.push({ docType: col.docType, count: 1 });
    }
  }
  return groups;
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

// Same source data as cellInfo(), but returns just one column's worth of a
// split document-type column (see expandColumns()): "number" is the
// document number on its own, "issued"/"expiry" are a travel document's two
// dates (expiry drives the status color), "date" is the single date column
// for a non-travel document type that tracks a number (expiry when there is
// one, else the issue/completion date, unstyled). "single" delegates
// straight to cellInfo() so a document type with nothing to split (no
// number, not a travel document) is completely unaffected.
export function cellInfoPart(
  required: boolean,
  docType: DocTypeRef,
  doc: StaffingCrew["documents"][string] | undefined,
  fieldDefs: FieldDef[],
  part: DisplayColumnPart
): CellInfo {
  if (part === "single") return cellInfo(required, docType, doc, fieldDefs);
  if (!required) return { text: "N/A", kind: "na" };
  if (!doc) return { text: "Missing", kind: "missing" };

  if (part === "number") {
    if (!doc.document_number) return { text: "—", kind: "empty" };
    return { text: doc.document_number, kind: "value" };
  }

  if (part === "issued") {
    const parts: string[] = [];
    if (doc.issue_date) parts.push(formatDate(doc.issue_date) ?? doc.issue_date);
    for (const f of fieldDefs) {
      const value = doc.custom_fields?.[f.field_key];
      if (value !== undefined && value !== null && value !== "") parts.push(`${f.label}: ${value}`);
    }
    if (parts.length === 0) return { text: "—", kind: "empty" };
    return { text: parts.join(" · "), kind: "value" };
  }

  if (part === "expiry") {
    if (!doc.expiry_date) return { text: "—", kind: "empty" };
    const r = computeDocumentStatus(doc.expiry_date, docType.warning_threshold_days, docType.category);
    return { text: formatDate(doc.expiry_date) ?? doc.expiry_date, kind: "value", status: r.status };
  }

  // part === "date" — the single date column for a non-travel document
  // type that tracks a number (its Number is a separate column).
  const parts: string[] = [];
  let status: DocumentStatus | undefined;
  if (doc.expiry_date) {
    const r = computeDocumentStatus(doc.expiry_date, docType.warning_threshold_days, docType.category);
    status = r.status;
    parts.push(formatDate(doc.expiry_date) ?? doc.expiry_date);
  } else if (doc.issue_date) {
    parts.push(formatDate(doc.issue_date) ?? doc.issue_date);
  }
  for (const f of fieldDefs) {
    const value = doc.custom_fields?.[f.field_key];
    if (value !== undefined && value !== null && value !== "") parts.push(`${f.label}: ${value}`);
  }
  if (parts.length === 0) return { text: "—", kind: "empty" };
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

// Sub-column header label for a split-out part — shared by the on-screen
// table and the Excel export so they never disagree on wording.
export function partLabel(part: DisplayColumnPart): string {
  switch (part) {
    case "number":
      return "Number";
    case "issued":
      return "Issued";
    case "expiry":
      return "Expiry";
    case "date":
      return "Date";
    default:
      return "";
  }
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
// own "Export to Excel" button — a single worksheet with one section per
// rank that has at least one person in `crewList` (a bold rank-title band,
// then that rank's own category-band header rows — merged + colored +
// centered, a mandatory "*" — then one row per person), stacked vertically
// rather than split across separate tabs, per AHM's own practice ("we have
// all in one only single sheet"). Used both by that on-screen button
// (client-side, triggers a download) and by the Crew Matrix Sharing
// feature (server-side, attached to the share email) so the two
// attachments can never look different from one another.
//
// Each rank keeps its own document columns (a Cook's required documents
// aren't a Steward's), so column layout still varies section to section —
// only the worksheet is shared, not a single flat column set.
//
// Takes an already-constructed ExcelJS module (the caller dynamic-imports
// it) rather than importing it itself, since the right way to load it
// differs between a browser bundle and a server action.
export async function buildStaffingPlanWorkbook(
  ExcelJS: typeof import("exceljs"),
  orderedLines: LineLike[],
  crewList: StaffingCrew[],
  documentTypes: DocTypeRef[],
  customFieldDefinitions: FieldDef[],
  // When set, one banner row at the very top of the sheet carries this
  // text, bold white-on-red. Used by Crew Matrix Sharing when a matrix
  // hasn't been approved yet (Nishant: "even in draft stage it can be sent
  // to the client") — the recipient still needs to see plainly that what
  // they're looking at isn't final. The regular on-screen "Export to
  // Excel" button never passes this, so its output is unchanged.
  draftWatermark?: string
): Promise<InstanceType<typeof ExcelJS.Workbook>> {
  const usedDocTypeIds = new Set<string>();
  for (const line of orderedLines) {
    for (const doc of line.documents) usedDocTypeIds.add(doc.document_type_id);
  }
  const columns = orderDocumentColumns(documentTypes, usedDocTypeIds);
  const categoryColorMap = buildCategoryColorMap(columns);
  const colorForCategory = (category: string | null) => categoryColorMap.get(category ?? UNCATEGORIZED_KEY) ?? CATEGORY_BAND_COLORS[0];

  const wb = new ExcelJS.Workbook();
  const HEADER_BORDER = { style: "thin" as const, color: { argb: "FFD0D5DD" } };
  const GROUP_DIVIDER = { style: "thin" as const, color: { argb: "FF9CA3AF" } };

  // Pre-compute each rank's own column layout first, so ranks with nobody
  // assigned are skipped and we know the widest section up front (needed
  // to size the top watermark band and the shared column widths).
  const blocks = orderedLines
    .map((line) => {
      const crewForLine = crewList.filter((c) => c.job_role_id === line.job_role_id).sort((a, b) => a.full_name.localeCompare(b.full_name));
      if (crewForLine.length === 0) return null;

      const requiredDocTypeIds = new Set(line.documents.map((d) => d.document_type_id));
      const mandatoryDocTypeIds = new Set(line.documents.filter((d) => d.is_mandatory).map((d) => d.document_type_id));
      const lineColumns = columns.filter((col) => requiredDocTypeIds.has(col.id));
      // A document type that carries a number and/or dates expands into
      // its own adjacent display columns (see expandColumns()) so each
      // field sorts and reads independently instead of being crammed into
      // one cell. A document type with nothing to split stays a single
      // column.
      const displayColumns = expandColumns(lineColumns);
      const { groups: lineGroups } = groupByCategory(displayColumns);
      const docTypeGroups = groupByDocType(displayColumns);
      const totalCols = displayColumns.length + 2;
      return { line, crewForLine, mandatoryDocTypeIds, displayColumns, lineGroups, docTypeGroups, totalCols };
    })
    .filter((b): b is NonNullable<typeof b> => b !== null);

  if (blocks.length === 0) {
    wb.addWorksheet("Staffing Plan").addRow(["No crew to include."]);
    return wb;
  }

  const maxTotalCols = Math.max(...blocks.map((b) => b.totalCols));
  const ws = wb.addWorksheet("Staffing Plan");
  const colWidths = new Map<number, number>();
  const noteWidth = (c: number, header: string) => colWidths.set(c, Math.max(colWidths.get(c) ?? 0, Math.max(12, Math.min(26, header.length + 4))));

  let cursor = 1;
  if (draftWatermark) {
    ws.addRow([draftWatermark]);
    ws.mergeCells(1, 1, 1, maxTotalCols);
    const cell = ws.getCell(1, 1);
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDC2626" } };
    ws.getRow(1).height = 20;
    cursor = 2;
  }

  for (const block of blocks) {
    const { line, crewForLine, mandatoryDocTypeIds, displayColumns, lineGroups, docTypeGroups, totalCols } = block;

    // Rank-title band — a plain bold section header naming the rank and
    // headcount, so scrolling down one continuous sheet still makes clear
    // which section you're in (the old per-tab sheet name did this job
    // before; now the tabs are gone).
    const titleRow = cursor;
    ws.addRow([`${line.job_role_name} (${crewForLine.length})`]);
    ws.mergeCells(titleRow, 1, titleRow, Math.max(totalCols, 2));
    const titleCell = ws.getCell(titleRow, 1);
    titleCell.font = { bold: true, size: 12 };
    titleCell.alignment = { horizontal: "left", vertical: "middle" };
    titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
    ws.getRow(titleRow).height = 20;
    cursor += 1;

    // Row 1: category band. Row 2: document name (spans its own split
    // sub-columns horizontally, or the full header height vertically when
    // it's a single column). Row 3: "Number"/"Issued"/"Expiry"/"Date"
    // sub-labels, blank under single-column document types.
    const headerRow1 = cursor;
    const headerRow2 = cursor + 1;
    const headerRow3 = cursor + 2;
    cursor += 3;

    ws.addRow(["Name", "Nationality", ...lineGroups.flatMap((g) => [formatCategoryLabel(g.category), ...Array(g.count - 1).fill("")])]);
    ws.addRow([
      "",
      "",
      ...docTypeGroups.flatMap((g) => [mandatoryDocTypeIds.has(g.docType.id) ? `${g.docType.name} *` : g.docType.name, ...Array(g.count - 1).fill("")]),
    ]);
    ws.addRow(["", "", ...displayColumns.map((dc) => partLabel(dc.part))]);

    ws.mergeCells(headerRow1, 1, headerRow3, 1);
    ws.mergeCells(headerRow1, 2, headerRow3, 2);
    noteWidth(1, "Name");
    noteWidth(2, "Nationality");

    let colIdx = 3;
    lineGroups.forEach((g) => {
      if (g.count > 1) ws.mergeCells(headerRow1, colIdx, headerRow1, colIdx + g.count - 1);
      const argb = `FF${colorForCategory(g.category).replace("#", "").toUpperCase()}`;
      for (let c = colIdx; c < colIdx + g.count; c++) {
        for (const rowNum of [headerRow1, headerRow2, headerRow3]) {
          ws.getCell(rowNum, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
        }
      }
      colIdx += g.count;
    });

    colIdx = 3;
    docTypeGroups.forEach((g) => {
      if (g.count > 1) {
        ws.mergeCells(headerRow2, colIdx, headerRow2, colIdx + g.count - 1);
      } else {
        ws.mergeCells(headerRow2, colIdx, headerRow3, colIdx);
      }
      colIdx += g.count;
    });

    for (const rowNum of [headerRow1, headerRow2, headerRow3]) {
      const row = ws.getRow(rowNum);
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cell.font = { bold: true };
        cell.alignment = { horizontal: colNumber <= 2 ? "left" : "center", vertical: "middle", wrapText: true };
        const isGroupStart = colNumber > 2 && displayColumns[colNumber - 3] && (colNumber === 3 || displayColumns[colNumber - 4]?.category !== displayColumns[colNumber - 3]?.category);
        cell.border = { bottom: HEADER_BORDER, ...(isGroupStart ? { left: GROUP_DIVIDER } : {}) };
      });
    }

    for (const person of crewForLine) {
      ws.addRow([
        person.full_name,
        person.nationality ?? "",
        ...displayColumns.map(
          (dc) =>
            cellInfoPart(
              true,
              dc.docType,
              person.documents[dc.docType.id],
              customFieldDefinitions.filter((f) => f.applies_to_document_type_id === dc.docType.id || f.applies_to_document_type_id === null),
              dc.part
            ).text
        ),
      ]);
      cursor += 1;
    }

    for (let c = 3; c <= totalCols; c++) {
      const dc = displayColumns[c - 3];
      const header = dc && dc.part !== "single" ? partLabel(dc.part) : dc?.docType.name ?? "";
      noteWidth(c, header);
    }

    // Blank divider row between this rank's block and the next.
    ws.addRow([]);
    cursor += 1;
  }

  for (const [c, width] of colWidths) {
    ws.getColumn(c).width = width;
  }

  return wb;
}
