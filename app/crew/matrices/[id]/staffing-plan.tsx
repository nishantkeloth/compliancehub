"use client";

// Staffing Plan — rank-led, real crew data, sourced from the same Required
// Document Types configured under the Lines tab.
//
// Two views, toggled client-side (no extra fetch — both lists are server-
// fetched up front by the page):
//
// - "Assigned" (original behavior): crew currently assigned to the
//   matrix's site whose primary job role matches the line.
// - "Available candidates" (new): crew whose primary job role matches the
//   line, who hold NO active assignment anywhere in the company, and whose
//   availability_date is today or earlier — i.e. free to staff this matrix
//   right now, before any Mobilization Request exists. This is a lighter
//   preview than the Phase 3 candidate/readiness engine (no skills,
//   experience, nationality, or reservation checks) — it exists purely to
//   answer "do we have enough free people for this rank" while planning,
//   not to replace the gated mobilization workflow. Reserving/mobilizing
//   still happens only through Mobilizations → New mobilization request.
//
// For each rank (crew matrix line), only the document types actually
// required for THAT rank are shown as columns — a Camp Boss row doesn't
// carry a column for a deck-only cert like a DP certificate at all (rather
// than showing N/A for it), mirroring the client's own crew matrix
// template. "Missing" (in the expired/critical color) means the rank
// requires the document but no crew_documents record exists yet for that
// person.
//
// This is still a pivot of THIS matrix's Required Document Types config,
// now joined to real crew_profiles/crew_documents rather than showing the
// abstract Mandatory/Optional/N-A structure only — see
// claude/phase10-client-crew-reports-requirement.md in the project for the
// separate, larger "client crew report" feature (multi-client templates,
// email delivery) this does not attempt to replace.

import { useState } from "react";
import type { Line, DocTypeRef } from "./lines-editor";
import { computeDocumentStatus, DOCUMENT_STATUS_COLORS, type DocumentStatus } from "@/lib/document-status";
import { assignCandidateToMatrix, createResourceProfileLink } from "./staffing-actions";

export type StaffingCrew = {
  crew_id: string;
  full_name: string;
  nationality: string | null;
  job_role_id: string;
  availability_date?: string | null;
  documents: Record<string, { document_number: string | null; issue_date: string | null; expiry_date: string | null; custom_fields: Record<string, unknown> | null }>;
};

export type FieldDef = { id: string; label: string; field_key: string; applies_to_document_type_id: string | null };

const cardCls = "bg-white border rounded-xl";
const cardStyle = { borderColor: "var(--ch-line)" };

// Light, low-contrast pastel fills for category header bands — assigned per
// category (see buildCategoryColorMap) so the same category always gets the
// same shade whichever rank's table it appears in.
const CATEGORY_BAND_COLORS = ["#eef2ff", "#ecfdf5", "#fff7ed", "#fdf2f8", "#f0f9ff", "#fefce8", "#f3f4f6"];
const UNCATEGORIZED_KEY = "\u0000general";

// "certificate" -> "CERTIFICATES", "travel_document" -> "TRAVEL DOCUMENTS".
// Uncategorized document types are clubbed under a plain "GENERAL" band.
function formatCategoryLabel(category: string | null): string {
  if (!category) return "GENERAL";
  const upper = category.replace(/[_-]+/g, " ").trim().toUpperCase();
  return /S$/.test(upper) ? upper : `${upper}S`;
}

type CategoryGroup = { category: string | null; count: number };

// Groups a rank's own applicable columns into contiguous same-category runs
// (columns are pre-sorted by category, so same-category columns are always
// adjacent). Used for both the header band spans and the Excel export.
function groupByCategory(cols: DocTypeRef[]): { groups: CategoryGroup[]; groupIndex: number[] } {
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

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// Single source of truth for what a document cell should say, shared by the
// on-screen table (DocCell) and the Excel export so the two never drift.
// Every column shown on a rank's table is already required for that rank
// (see lineColumns below), so this only ever renders "missing"/"empty"/
// "value" in practice — "na" stays as a defensive fallback.
type CellInfo = { text: string; kind: "na" | "missing" | "empty" | "value"; status?: DocumentStatus };

function cellInfo(
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

  if (doc.expiry_date) {
    const r = computeDocumentStatus(doc.expiry_date, docType.warning_threshold_days, docType.category);
    status = r.status;
    parts.push(formatDate(doc.expiry_date) ?? doc.expiry_date);
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

export default function StaffingPlanView({
  crewMatrixId,
  lines,
  documentTypes,
  crew,
  candidateCrew,
  customFieldDefinitions,
  canManage = false,
  canAssignCrew = false,
  onAssigned,
}: {
  crewMatrixId: string;
  lines: Line[];
  documentTypes: DocTypeRef[];
  crew: StaffingCrew[];
  candidateCrew?: StaffingCrew[];
  customFieldDefinitions: FieldDef[];
  // Both default to false so this component still works if a caller (e.g.
  // an older test/story) doesn't pass them — the Actions column just stays
  // hidden, same as no permissions.
  canManage?: boolean;
  canAssignCrew?: boolean;
  onAssigned?: () => void;
}) {
  const [view, setView] = useState<"assigned" | "available">("assigned");
  const [exporting, setExporting] = useState(false);
  const orderedLines = [...lines].sort((a, b) => a.line_number - b.line_number);

  const usedDocTypeIds = new Set<string>();
  for (const line of orderedLines) {
    for (const doc of line.documents) usedDocTypeIds.add(doc.document_type_id);
  }
  // Canonical ordering for every document type used anywhere on this
  // matrix: by category (Vaccination / Certificate / Trainings / etc., set
  // on the document type under Team → Document Types), uncategorized last,
  // then alphabetically within a category. Each rank's table below filters
  // this down to just the columns that rank actually requires, so the
  // per-rank ordering and category grouping stay consistent across ranks.
  const columns = documentTypes
    .filter((d) => usedDocTypeIds.has(d.id))
    .sort((a, b) => {
      const catA = a.category ?? "￿";
      const catB = b.category ?? "￿";
      if (catA !== catB) return catA.localeCompare(catB);
      return a.name.localeCompare(b.name);
    });

  // Stable category -> color assignment (by first appearance in the
  // canonical order above), so e.g. "Certificates" is always the same
  // shade whether it's the first or third band on a given rank's table.
  const categoryColorMap = new Map<string, string>();
  {
    const { groups } = groupByCategory(columns);
    groups.forEach((g, i) => {
      categoryColorMap.set(g.category ?? UNCATEGORIZED_KEY, CATEGORY_BAND_COLORS[i % CATEGORY_BAND_COLORS.length]);
    });
  }
  const colorForCategory = (category: string | null) => categoryColorMap.get(category ?? UNCATEGORIZED_KEY) ?? CATEGORY_BAND_COLORS[0];

  if (orderedLines.length === 0) {
    return <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No lines yet — add lines under the Lines tab first.</div>;
  }

  if (columns.length === 0) {
    return (
      <div className="text-sm" style={{ color: "var(--ch-sub)" }}>
        No rank has any Required Document Types configured yet. Add them under the Lines tab — every document required
        for at least one rank becomes a column here.
      </div>
    );
  }

  const activeCrew = view === "assigned" ? crew : candidateCrew ?? [];

  const exportExcel = async () => {
    setExporting(true);
    try {
      // xlsx (SheetJS Community Edition, used elsewhere in the app) doesn't
      // write cell styles/fills — ExcelJS does, which is what we need here
      // to actually color the category bands and center them in the file,
      // not just on screen.
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      const usedSheetNames = new Set<string>();
      const HEADER_BORDER = { style: "thin" as const, color: { argb: "FFD0D5DD" } };
      const GROUP_DIVIDER = { style: "thin" as const, color: { argb: "FF9CA3AF" } };

      for (const line of orderedLines) {
        const crewForLine = activeCrew.filter((c) => c.job_role_id === line.job_role_id).sort((a, b) => a.full_name.localeCompare(b.full_name));
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

        // Row 1: "Name"/"Nationality" (vertically merged into row 2 below)
        // plus one cell per category band, merged horizontally across the
        // columns it covers. Row 2: blank under Name/Nationality, then the
        // individual document-type column names (with a mandatory "*").
        ws.addRow(["Name", "Nationality", ...lineGroups.flatMap((g) => [formatCategoryLabel(g.category), ...Array(g.count - 1).fill("")])]);
        ws.addRow(["", "", ...lineColumns.map((col) => (mandatoryDocTypeIds.has(col.id) ? `${col.name} *` : col.name))]);

        ws.mergeCells(1, 1, 2, 1);
        ws.mergeCells(1, 2, 2, 2);

        let colIdx = 3; // 1-indexed; col 1 = Name, col 2 = Nationality
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
        wb.addWorksheet("Staffing Plan").addRow(["No crew to export for the current view."]);
      }

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `staffing-plan-${view}-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div className="text-xs" style={{ color: "var(--ch-sub)" }}>
          {view === "assigned"
            ? <>One row per crew member currently assigned to this site, grouped by rank.</>
            : <>One row per crew member who matches the rank, holds no active assignment anywhere, and is free today — a preview for staffing before any mobilization request exists.</>}
          {" "}Each rank only shows the document types required for that rank, grouped by category —{" "}
          &quot;Missing&quot; means it&apos;s required and no record exists yet, and{" "}
          <span className="font-semibold" style={{ color: "var(--ch-fail)" }}>*</span> marks a document that&apos;s mandatory for that rank.
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={exportExcel}
            disabled={exporting}
            className="text-xs font-semibold rounded-lg px-3 py-1.5 border disabled:opacity-50"
            style={{ borderColor: "var(--ch-line)", color: "var(--ch-sub)" }}
          >
            {exporting ? "Exporting…" : "Export to Excel"}
          </button>
          {candidateCrew !== undefined && (
            <div className="inline-flex rounded-lg border p-0.5" style={{ borderColor: "var(--ch-line)" }}>
              {(["assigned", "available"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className="text-xs font-semibold rounded-md px-3 py-1.5"
                  style={
                    view === v
                      ? { background: "var(--ch-navy)", color: "#fff" }
                      : { color: "var(--ch-sub)" }
                  }
                >
                  {v === "assigned" ? "Assigned" : "Available candidates"}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="space-y-4">
        {orderedLines.map((line) => {
          const crewForLine = activeCrew.filter((c) => c.job_role_id === line.job_role_id).sort((a, b) => a.full_name.localeCompare(b.full_name));
          const requiredDocTypeIds = new Set(line.documents.map((d) => d.document_type_id));
          const mandatoryDocTypeIds = new Set(line.documents.filter((d) => d.is_mandatory).map((d) => d.document_type_id));
          // Only the document types this rank actually requires — an
          // inapplicable (N/A) document type isn't shown as a column at
          // all on this rank's table.
          const lineColumns = columns.filter((col) => requiredDocTypeIds.has(col.id));
          const { groups: lineGroups, groupIndex: lineGroupIndex } = groupByCategory(lineColumns);
          // "Assign" only makes sense from Available candidates (an
          // Assigned person is already assigned); "Share link" is useful
          // from either view, so a manager can send a client a link for
          // someone already onboard too.
          const showAssignCol = view === "available" && canAssignCrew;
          const showShareCol = canManage;
          const showActionsCol = showAssignCol || showShareCol;

          return (
            <div key={line.id} className={`${cardCls} overflow-hidden`} style={cardStyle}>
              <div className="px-3 py-2 flex items-center gap-3 flex-wrap" style={{ background: "var(--ch-navy-soft)" }}>
                <span className="text-sm font-semibold" style={{ color: "var(--ch-navy)" }}>{line.job_role_name}</span>
                <span className="text-xs" style={{ color: "var(--ch-sub)" }}>
                  Headcount required {line.required_headcount} · {crewForLine.length} {view === "assigned" ? "assigned" : "available"}
                </span>
              </div>
              {crewForLine.length === 0 ? (
                <div className="px-3 py-3 text-sm" style={{ color: "var(--ch-sub)" }}>
                  {view === "assigned"
                    ? "No crew currently assigned to this rank at this site."
                    : "No unassigned, available crew match this rank right now."}
                </div>
              ) : lineColumns.length === 0 ? (
                <div className="px-3 py-3 text-sm" style={{ color: "var(--ch-sub)" }}>
                  No document types are required for this rank yet — add them under the Lines tab.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="text-xs border-collapse w-full">
                    <thead>
                      <tr>
                        <th rowSpan={2} className="text-left font-semibold px-3 py-2 whitespace-nowrap align-bottom" style={{ color: "var(--ch-sub)", background: "var(--ch-paper)" }}>Name</th>
                        <th rowSpan={2} className="text-left font-semibold px-3 py-2 whitespace-nowrap align-bottom" style={{ color: "var(--ch-sub)", background: "var(--ch-paper)" }}>Nationality</th>
                        {lineGroups.map((g, i) => (
                          <th
                            key={`${g.category ?? "general"}-${i}`}
                            colSpan={g.count}
                            className="text-center font-semibold px-3 py-1 whitespace-nowrap border-b border-l"
                            style={{ color: "var(--ch-ink)", borderColor: "var(--ch-line)", background: colorForCategory(g.category) }}
                          >
                            {formatCategoryLabel(g.category)}
                          </th>
                        ))}
                        {showActionsCol && (
                          <th rowSpan={2} className="text-left font-semibold px-3 py-2 whitespace-nowrap align-bottom border-l" style={{ color: "var(--ch-sub)", borderColor: "var(--ch-line)", background: "var(--ch-paper)" }}>
                            Actions
                          </th>
                        )}
                      </tr>
                      <tr>
                        {lineColumns.map((col, i) => (
                          <th
                            key={col.id}
                            className={`text-left font-semibold px-3 py-2 whitespace-nowrap${i === 0 || lineColumns[i - 1].category !== col.category ? " border-l" : ""}`}
                            style={{ color: "var(--ch-sub)", borderColor: "var(--ch-line)", background: colorForCategory(lineGroups[lineGroupIndex[i]]?.category ?? null) }}
                          >
                            {col.name}
                            {mandatoryDocTypeIds.has(col.id) && (
                              <span className="ml-0.5 font-semibold" style={{ color: "var(--ch-fail)" }} title="Mandatory">*</span>
                            )}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {crewForLine.map((person) => (
                        <tr key={person.crew_id} className="border-t" style={{ borderColor: "var(--ch-line)" }}>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <div className="font-semibold" style={{ color: "var(--ch-ink)" }}>{person.full_name}</div>
                            {view === "available" && person.availability_date && (
                              <div className="text-[10px]" style={{ color: "var(--ch-sub)" }}>Free since {formatDate(person.availability_date)}</div>
                            )}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--ch-ink)" }}>{person.nationality ?? "—"}</td>
                          {lineColumns.map((col) => (
                            <DocCell
                              key={col.id}
                              docType={col}
                              doc={person.documents[col.id]}
                              fieldDefs={customFieldDefinitions.filter((f) => f.applies_to_document_type_id === col.id || f.applies_to_document_type_id === null)}
                            />
                          ))}
                          {showActionsCol && (
                            <RowActions
                              crewId={person.crew_id}
                              crewMatrixId={crewMatrixId}
                              lineId={line.id}
                              showAssign={showAssignCol}
                              showShare={showShareCol}
                              onAssigned={onAssigned}
                            />
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RowActions({
  crewId,
  crewMatrixId,
  lineId,
  showAssign,
  showShare,
  onAssigned,
}: {
  crewId: string;
  crewMatrixId: string;
  lineId: string;
  showAssign: boolean;
  showShare: boolean;
  onAssigned?: () => void;
}) {
  const [busy, setBusy] = useState<"assign" | "share" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const doAssign = async () => {
    setError(null);
    setBusy("assign");
    const res = await assignCandidateToMatrix(crewId, crewMatrixId);
    setBusy(null);
    if (res?.error) {
      setError(res.error);
      return;
    }
    onAssigned?.();
  };

  const doShare = async () => {
    setError(null);
    setCopied(false);
    setBusy("share");
    const res = await createResourceProfileLink(crewId, lineId);
    setBusy(null);
    if (res?.error) {
      setError(res.error);
      return;
    }
    if (res?.url) setLink(res.url);
  };

  const copyLink = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // Clipboard permission blocked — the link is already shown in the
      // read-only field below for the user to select and copy manually.
    }
  };

  return (
    <td className="px-3 py-2 border-l" style={{ borderColor: "var(--ch-line)" }}>
      <div className="flex items-center gap-1.5 whitespace-nowrap">
        {showAssign && (
          <button
            onClick={doAssign}
            disabled={busy !== null}
            className="text-[11px] font-semibold rounded px-2 py-1 border disabled:opacity-50"
            style={{ borderColor: "var(--ch-line)", color: "var(--ch-navy)" }}
          >
            {busy === "assign" ? "Assigning…" : "Assign"}
          </button>
        )}
        {showShare && (
          <button
            onClick={doShare}
            disabled={busy !== null}
            className="text-[11px] font-semibold rounded px-2 py-1 border disabled:opacity-50"
            style={{ borderColor: "var(--ch-line)", color: "var(--ch-sub)" }}
          >
            {busy === "share" ? "Generating…" : link ? "New link" : "Share link"}
          </button>
        )}
      </div>
      {error && <div className="text-[10px] mt-1" style={{ color: "var(--ch-fail)" }}>{error}</div>}
      {link && (
        <div className="mt-1 flex items-center gap-1">
          <input
            readOnly
            value={link}
            onFocus={(e) => e.currentTarget.select()}
            className="text-[10px] border rounded px-1 py-0.5 w-44"
            style={{ borderColor: "var(--ch-line)", color: "var(--ch-ink)" }}
          />
          <button
            onClick={copyLink}
            className="text-[10px] font-semibold rounded px-1.5 py-0.5 border shrink-0"
            style={{ borderColor: "var(--ch-line)", color: "var(--ch-sub)" }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
    </td>
  );
}

function DocCell({
  docType,
  doc,
  fieldDefs,
}: {
  docType: DocTypeRef;
  doc: StaffingCrew["documents"][string] | undefined;
  fieldDefs: FieldDef[];
}) {
  // Every column reaching this component is already required for the rank
  // it's rendered under (see lineColumns) — required is always true here.
  const info = cellInfo(true, docType, doc, fieldDefs);

  if (info.kind === "missing") {
    const colors = DOCUMENT_STATUS_COLORS.expired;
    return (
      <td className="px-3 py-2 whitespace-nowrap">
        <span className="rounded px-1.5 py-0.5 font-semibold" style={{ background: colors.bg, color: colors.fg }}>
          Missing
        </span>
      </td>
    );
  }

  if (info.kind === "empty") {
    const colors = DOCUMENT_STATUS_COLORS.none;
    return (
      <td className="px-3 py-2 whitespace-nowrap">
        <span className="rounded px-1.5 py-0.5" style={{ background: colors.bg, color: colors.fg }}>
          On file, no date/number set
        </span>
      </td>
    );
  }

  const colors = info.status ? DOCUMENT_STATUS_COLORS[info.status] : null;
  return (
    <td className="px-3 py-2 whitespace-nowrap">
      <span className={colors ? "rounded px-1.5 py-0.5" : ""} style={colors ? { background: colors.bg, color: colors.fg } : { color: "var(--ch-ink)" }}>
        {info.text}
      </span>
    </td>
  );
}
