// Client Compliance Reports (Phase 10) — the actual .xlsx builder. One
// flat worksheet: an optional merged group-header band row, a column
// header row, then one row per crew member, with each document-expiry
// cell tinted using the same OK/warning/critical/expired palette as the
// Crew Documents screen (lib/document-status.ts) so a client reading
// the file sees the same traffic-light coloring ComplianceHub shows
// internally. Mirrors the styling idioms of buildStaffingPlanWorkbook
// (lib/staffing-plan-shared.ts) — merge/fill/border primitives are the
// same, just over a template-driven column list instead of a fixed
// document-type layout.

import { DOCUMENT_STATUS_COLORS } from "@/lib/document-status";
import { resolveColumn, type ReportColumn, type ReportCrewRow, type ReportDocTypeRef } from "./report-columns";

export async function buildClientReportWorkbook(
  ExcelJS: typeof import("exceljs"),
  siteName: string,
  columns: ReportColumn[],
  rows: ReportCrewRow[],
  docTypes: ReportDocTypeRef[],
  // Set on the review/preview screen only — never on the file that
  // actually gets emailed — so the person reviewing can't mistake a
  // draft preview for the real attachment. See send-report-actions'
  // generateClientReportPreview vs sendClientReport.
  previewWatermark?: string
): Promise<InstanceType<typeof ExcelJS.Workbook>> {
  const docTypesById = new Map(docTypes.map((d) => [d.id, d]));
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(siteName.slice(0, 31) || "Report");

  const totalCols = Math.max(columns.length, 1);
  const HEADER_BORDER = { style: "thin" as const, color: { argb: "FFD0D5DD" } };

  let cursor = 1;
  if (previewWatermark) {
    ws.addRow([previewWatermark]);
    ws.mergeCells(cursor, 1, cursor, totalCols);
    const cell = ws.getCell(cursor, 1);
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDC2626" } };
    ws.getRow(cursor).height = 20;
    cursor += 1;
  }

  const hasGroupHeaders = columns.some((c) => c.groupHeader);
  const groupRow = hasGroupHeaders ? cursor : null;
  const headerRow = hasGroupHeaders ? cursor + 1 : cursor;
  cursor = headerRow + 1;

  if (groupRow) {
    const groupCells: string[] = [];
    let i = 0;
    while (i < columns.length) {
      const label = columns[i].groupHeader ?? "";
      let span = 1;
      while (i + span < columns.length && (columns[i + span].groupHeader ?? "") === label) span++;
      groupCells.push(label, ...Array(span - 1).fill(""));
      i += span;
    }
    ws.addRow(groupCells);
    let colIdx = 1;
    i = 0;
    while (i < columns.length) {
      const label = columns[i].groupHeader ?? "";
      let span = 1;
      while (i + span < columns.length && (columns[i + span].groupHeader ?? "") === label) span++;
      if (span > 1) ws.mergeCells(groupRow, colIdx, groupRow, colIdx + span - 1);
      if (label) {
        for (let c = colIdx; c < colIdx + span; c++) {
          ws.getCell(groupRow, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
        }
      }
      colIdx += span;
      i += span;
    }
  }

  ws.addRow(columns.map((c) => c.header));
  const hRow = ws.getRow(headerRow);
  hRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { bold: true };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = { bottom: HEADER_BORDER };
  });
  ws.getRow(headerRow).height = 24;

  for (const row of rows) {
    const resolved = columns.map((col) => resolveColumn(col, row, docTypesById));
    const excelRow = ws.addRow(resolved.map((r) => r.text));
    resolved.forEach((r, idx) => {
      if (!r.status || r.status === "none" || r.status === "ok") return;
      const colors = DOCUMENT_STATUS_COLORS[r.status];
      excelRow.getCell(idx + 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${colors.bg.replace("#", "").toUpperCase()}` } };
      excelRow.getCell(idx + 1).font = { color: { argb: `FF${colors.fg.replace("#", "").toUpperCase()}` } };
    });
    cursor += 1;
  }

  columns.forEach((col, idx) => {
    ws.getColumn(idx + 1).width = Math.max(12, Math.min(28, col.header.length + 4));
  });

  return wb;
}
