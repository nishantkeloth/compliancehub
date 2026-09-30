// Builds the downloadable "Crew Register Import" workbook (Bulk Data
// Migration → Crew Register Import) from the org's LIVE document types and
// custom field definitions, instead of shipping a static .xlsx that
// drifts out of date every time someone adds/renames a document type in
// Crew Setup. Used by app/api/crew/register-template/route.ts (the
// in-app download link) — kept plain (no "use server"/"use client") so it
// can also be driven from a one-off script for support purposes.
//
// Mirrors the ExcelJS styling conventions already established in
// lib/staffing-plan-shared.ts (buildStaffingPlanWorkbook) rather than
// inventing a new look, and keeps the previous static template's visual
// language (navy header text, amber = required column, light-blue =
// optional column, gray italic example rows) so returning users see a
// familiar sheet.

const NAVY = "FF16273F";
const AMBER = "FFFDE9C8";
const LIGHT_BLUE = "FFEEF1F6";
const EXAMPLE_GRAY = "FF6B7280";
const WHITE = "FFFFFFFF";

export type TemplateDocType = { id: string; name: string; category: string | null };
export type TemplateCustomFieldDef = {
  id: string;
  label: string;
  field_key: string;
  applies_to_document_type_id: string | null;
};

function styleHeaderCell(cell: import("exceljs").Cell, required: boolean) {
  cell.font = { bold: true, color: { argb: NAVY } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: required ? AMBER : LIGHT_BLUE } };
  cell.alignment = { vertical: "middle", wrapText: true };
}

function styleExampleRow(row: import("exceljs").Row) {
  row.eachCell({ includeEmpty: false }, (cell) => {
    cell.font = { italic: true, color: { argb: EXAMPLE_GRAY } };
  });
}

function addInstructionsSheet(wb: import("exceljs").Workbook, documentTypes: TemplateDocType[]) {
  const ws = wb.addWorksheet("Instructions");
  ws.getColumn(1).width = 95;
  ws.getColumn(1).alignment = { wrapText: true, vertical: "top" };

  const byCategory = new Map<string, string[]>();
  for (const dt of documentTypes) {
    const cat = dt.category?.trim() || "Other";
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(dt.name);
  }

  const lines: { text: string; bold?: boolean; size?: number }[] = [
    { text: "Crew Register Import — how to fill this in", bold: true, size: 14 },
    { text: "" },
    { text: "This workbook has two tabs you fill in, plus one hidden reference tab used for the Document Type dropdown — leave that one alone." },
    { text: "" },
    { text: "1. Crew Profile tab", bold: true },
    { text: "One row per crew member. Employee Code and Full Name (marked *) are required — every other column is optional and can be left blank." },
    { text: "If an Employee Code (or, failing that, a Full Name) already matches someone in ComplianceHub, that row UPDATES their existing profile instead of creating a duplicate." },
    { text: "" },
    { text: "2. Documents tab", bold: true },
    { text: "One row per document. Employee Code and Document Type (marked *) are required, and Employee Code must match a row on the Crew Profile tab." },
    { text: "Document Type must be one of the values currently configured in Crew Setup → Document Types for this company (pick from the dropdown on that column) — see the full list below." },
    { text: "Dates go in YYYY-MM-DD format (or a real Excel date cell)." },
    { text: "" },
    { text: "Document Type reference — current values for this company", bold: true },
    { text: "This list always matches what's configured in Crew Setup → Document Types at the moment you download this file. If you add or rename a document type there, re-download the template to pick up the change." },
  ];
  for (const [cat, names] of [...byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push({ text: `${cat}: ${names.slice().sort((a, b) => a.localeCompare(b)).join(", ")}` });
  }
  lines.push({ text: "" });
  lines.push({ text: "Extra columns on the Documents tab", bold: true });
  lines.push({
    text:
      "Some document types have their own extra field configured in Crew Setup → Custom Fields (for example, \"Oil Field\" on CICPA Pass). Those show up as their own column on the Documents tab — fill it in only for rows using that document type; leave it blank for every other document type.",
  });

  lines.forEach((l, i) => {
    const row = ws.getRow(i + 1);
    row.getCell(1).value = l.text;
    if (l.bold || l.size) row.getCell(1).font = { bold: !!l.bold, size: l.size ?? 11, color: { argb: NAVY } };
    row.getCell(1).alignment = { wrapText: true, vertical: "top" };
  });
}

function addCrewProfileSheet(wb: import("exceljs").Workbook) {
  const ws = wb.addWorksheet("Crew Profile");
  const columns: { header: string; required: boolean; width: number }[] = [
    { header: "Employee Code*", required: true, width: 16 },
    { header: "Full Name*", required: true, width: 24 },
    { header: "Job Role", required: false, width: 20 },
    { header: "Employment Status", required: false, width: 16 },
    { header: "Employment Type", required: false, width: 16 },
    { header: "Nationality", required: false, width: 16 },
    { header: "Date of Birth", required: false, width: 14 },
    { header: "Gender", required: false, width: 10 },
    { header: "Phone", required: false, width: 16 },
    { header: "Email", required: false, width: 22 },
    { header: "Home Country", required: false, width: 16 },
    { header: "Current Location", required: false, width: 18 },
    { header: "Nearest Airport", required: false, width: 16 },
    { header: "Joining Date", required: false, width: 14 },
    { header: "Notice Period Days", required: false, width: 14 },
    { header: "Availability Date", required: false, width: 14 },
    { header: "Emergency Contact Name", required: false, width: 22 },
    { header: "Emergency Contact Phone", required: false, width: 18 },
    { header: "Day Rate", required: false, width: 12 },
    { header: "Currency", required: false, width: 10 },
    { header: "Dietary Medical Notes", required: false, width: 24 },
    { header: "Notes", required: false, width: 28 },
  ];
  ws.columns = columns.map((c) => ({ width: c.width }));
  const headerRow = ws.getRow(1);
  columns.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = c.header;
    styleHeaderCell(cell, c.required);
  });
  headerRow.height = 20;

  const example = [
    "EMP-0001 (example — delete this row)",
    "Jane Seafarer",
    "Able Seaman",
    "active",
    "permanent",
    "Filipino",
    "1990-05-14",
    "female",
    "+971500000000",
    "jane@example.com",
    "Philippines",
    "Abu Dhabi, UAE",
    "AUH",
    "2024-01-10",
    30,
    "",
    "John Seafarer",
    "+971500000001",
    250,
    "USD",
    "",
    "Sample row — delete before uploading.",
  ];
  const exRow = ws.addRow(example);
  styleExampleRow(exRow);
  ws.views = [{ state: "frozen", ySplit: 2 }];
}

function addDocumentsSheet(wb: import("exceljs").Workbook, documentTypes: TemplateDocType[], customFieldDefs: TemplateCustomFieldDef[]) {
  const ws = wb.addWorksheet("Documents");

  // One column per distinct custom-field LABEL (a label can be shared by
  // several per-document-type definitions — e.g. a future org could reuse
  // "Batch Number" on two different certificate types — so this is one
  // template column that any of those definitions can fill, not one
  // column per definition).
  const labelOrder: string[] = [];
  const defsByLabel = new Map<string, TemplateCustomFieldDef[]>();
  for (const def of customFieldDefs) {
    if (!defsByLabel.has(def.label)) {
      defsByLabel.set(def.label, []);
      labelOrder.push(def.label);
    }
    defsByLabel.get(def.label)!.push(def);
  }

  const fixedColumns: { header: string; required: boolean; width: number }[] = [
    { header: "Employee Code*", required: true, width: 22 },
    { header: "Document Type*", required: true, width: 26 },
    { header: "Document Number", required: false, width: 20 },
    { header: "Issue Date", required: false, width: 14 },
    { header: "Expiry Date", required: false, width: 14 },
  ];
  const customColumns = labelOrder.map((label) => {
    const scopedNames = defsByLabel
      .get(label)!
      .map((d) => documentTypes.find((dt) => dt.id === d.applies_to_document_type_id)?.name)
      .filter((n): n is string => !!n);
    return { header: label, required: false, width: Math.max(16, label.length + 4), scopedNames };
  });
  const notesColumn = { header: "Notes", required: false, width: 30 };
  const allColumns = [...fixedColumns, ...customColumns.map((c) => ({ header: c.header, required: c.required, width: c.width })), notesColumn];

  ws.columns = allColumns.map((c) => ({ width: c.width }));
  const headerRow = ws.getRow(1);
  allColumns.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = c.header;
    styleHeaderCell(cell, c.required);
  });
  headerRow.height = 20;

  // A custom-field column applies to specific document types (or to all,
  // when the definition's applies_to_document_type_id is null) — note that
  // scope right on the header cell so it's visible without opening the
  // Instructions tab.
  customColumns.forEach((c, i) => {
    const colIdx = fixedColumns.length + i + 1;
    const cell = headerRow.getCell(colIdx);
    const anyGlobal = defsByLabel.get(c.header)!.some((d) => !d.applies_to_document_type_id);
    const note = anyGlobal ? "Applies to: all document types" : `Applies to: ${c.scopedNames.join(", ") || "—"}`;
    cell.note = { texts: [{ text: note }] };
  });

  // Two example rows: one plain document, one exercising a custom-field
  // column so its purpose is obvious at a glance rather than just named in
  // a header comment. Falls back gracefully to a generic pair when the org
  // has neither a matching document type nor any custom fields yet. These
  // MUST be added (ws.addRow) before anything below touches cells further
  // down the sheet via ws.getCell — ExcelJS's addRow() appends after the
  // highest row index touched so far, so building the data-validation
  // range first would silently push these two rows past row 1000.
  const exampleDocType = documentTypes[0]?.name ?? "Passport";
  const exRow1Values = ["EMP-0001 (example — delete this row)", exampleDocType, "A1234567", "2023-01-15", "2028-01-14", ...customColumns.map(() => ""), "Sample row — delete before uploading."];
  const exRow1 = ws.addRow(exRow1Values);
  styleExampleRow(exRow1);

  if (customColumns.length) {
    const firstCustom = customColumns[0];
    const scopedDef = defsByLabel.get(firstCustom.header)!.find((d) => d.applies_to_document_type_id);
    const scopedTypeName = scopedDef ? documentTypes.find((dt) => dt.id === scopedDef.applies_to_document_type_id)?.name : null;
    const exRow2Values = [
      "EMP-0001 (example — delete this row)",
      scopedTypeName ?? exampleDocType,
      "SAMPLE-0002",
      "2024-03-01",
      "2026-03-01",
      ...customColumns.map((c) => (c.header === firstCustom.header ? "Sample value" : "")),
      `Sample row showing the "${firstCustom.header}" column — delete before uploading.`,
    ];
    const exRow2 = ws.addRow(exRow2Values);
    styleExampleRow(exRow2);
  }

  // Data validation dropdown on Document Type, sourced from a hidden
  // reference tab so it's never limited by Excel's ~255-char inline-list
  // cap and always reflects the exact live names (case, punctuation, etc).
  // Applied last, and starting right after the header (row 2) so it also
  // covers the two example rows above.
  const lookupWs = wb.addWorksheet("Lookups");
  lookupWs.state = "veryHidden";
  lookupWs.getCell(1, 1).value = "Document Type";
  const sortedTypes = documentTypes.slice().sort((a, b) => a.name.localeCompare(b.name));
  sortedTypes.forEach((dt, i) => {
    lookupWs.getCell(i + 2, 1).value = dt.name;
  });
  const lastRow = Math.max(2, sortedTypes.length + 1);
  const docTypeColLetter = "B"; // fixedColumns[1] === Document Type
  for (let r = 2; r <= 1002; r++) {
    ws.getCell(`${docTypeColLetter}${r}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`Lookups!$A$2:$A$${lastRow}`],
      showErrorMessage: true,
      errorStyle: "warning",
      errorTitle: "Not a configured document type",
      error: "This isn't one of the document types currently configured in Crew Setup — the row can still be imported, but the document type won't auto-match. Pick from the dropdown to avoid that.",
    };
  }

  headerRow.commit?.();
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

export function buildCrewRegisterTemplateWorkbook(
  ExcelJSNS: typeof import("exceljs"),
  documentTypes: TemplateDocType[],
  customFieldDefs: TemplateCustomFieldDef[]
) {
  const wb = new ExcelJSNS.Workbook();
  wb.creator = "ComplianceHub";
  wb.created = new Date();
  addInstructionsSheet(wb, documentTypes);
  addCrewProfileSheet(wb);
  addDocumentsSheet(wb, documentTypes, customFieldDefs);
  return wb;
}
