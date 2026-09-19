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
// Actions (Assigned/Available candidates rows) — all gated behind
// permission props from the parent (see canManage/canAssignCrew below):
// - Assign (Available candidates only): a direct, no-approval
//   crew_assignments write — see staffing-actions.ts for why this
//   skips the emergency-override path used elsewhere in the app.
// - Unassign (Assigned only): the direct counterpart — deletes that
//   assignment outright rather than a formal sign-off.
// - Share link (Assigned only, per row and per rank-card header): a
//   token-based public URL a client can open without a ComplianceHub
//   account to see one candidate's status for that rank. The header
//   version generates one for every currently-assigned person on that
//   rank and drafts a mailto: email listing them — using the visitor's
//   own configured mail client (mailto:), not sending anything from
//   the server.
//
// This is still a pivot of THIS matrix's Required Document Types config,
// now joined to real crew_profiles/crew_documents rather than showing the
// abstract Mandatory/Optional/N-A structure only — see
// claude/phase10-client-crew-reports-requirement.md in the project for the
// separate, larger "client crew report" feature (multi-client templates,
// email delivery) this does not attempt to replace.

import { useState } from "react";
import type { Line, DocTypeRef } from "./lines-editor";
import { DOCUMENT_STATUS_COLORS } from "@/lib/document-status";
import { assignCandidateToMatrix, unassignCandidateFromMatrix, createResourceProfileLink } from "./staffing-actions";
import {
  cellInfoPart,
  formatCategoryLabel,
  formatDate,
  groupByCategory,
  groupByDocType,
  expandColumns,
  orderDocumentColumns,
  buildCategoryColorMap,
  buildStaffingPlanWorkbook,
  UNCATEGORIZED_KEY,
  CATEGORY_BAND_COLORS,
  type CategoryGroup,
  type DisplayColumn,
  type StaffingCrew,
  type FieldDef,
} from "@/lib/staffing-plan-shared";
import SendMatrixWizard from "./send-matrix-wizard";
import SharingHistoryPanel from "./sharing-history-panel";

// Re-exported for existing callers (matrix-detail.tsx) that import these
// types from this file — the actual definitions now live in
// lib/staffing-plan-shared.ts so server-side code (share-actions.ts) can
// use them too without importing a "use client" module.
export type { StaffingCrew, FieldDef };

const cardCls = "bg-white border rounded-xl";
const cardStyle = { borderColor: "var(--ch-line)" };

export default function StaffingPlanView({
  crewMatrixId,
  matrixTitle,
  matrixNumber,
  matrixVersion,
  matrixStatus,
  lines,
  documentTypes,
  crew,
  candidateCrew,
  customFieldDefinitions,
  canManage = false,
  canAssignCrew = false,
  canShareMatrix = false,
  onChanged,
}: {
  crewMatrixId: string;
  matrixTitle?: string;
  matrixNumber?: string | null;
  matrixVersion?: number;
  matrixStatus?: string;
  lines: Line[];
  documentTypes: DocTypeRef[];
  crew: StaffingCrew[];
  candidateCrew?: StaffingCrew[];
  customFieldDefinitions: FieldDef[];
  // All default to false so this component still works if a caller (e.g.
  // an older test/story) doesn't pass them — the Actions column just stays
  // hidden, same as no permissions.
  canManage?: boolean;
  canAssignCrew?: boolean;
  canShareMatrix?: boolean;
  onChanged?: () => void;
}) {
  const [view, setView] = useState<"assigned" | "available">("assigned");
  const [exporting, setExporting] = useState(false);
  const [shareModal, setShareModal] = useState<"send" | "history" | null>(null);
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
  const columns = orderDocumentColumns(documentTypes, usedDocTypeIds);

  // Stable category -> color assignment (by first appearance in the
  // canonical order above), so e.g. "Certificates" is always the same
  // shade whether it's the first or third band on a given rank's table.
  const categoryColorMap = buildCategoryColorMap(columns);
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
      // not just on screen. buildStaffingPlanWorkbook is shared with the
      // Crew Matrix Sharing feature's emailed attachment so the two files
      // can never look different from one another.
      const ExcelJS = (await import("exceljs")).default;
      const wb = await buildStaffingPlanWorkbook(ExcelJS, orderedLines, activeCrew, documentTypes, customFieldDefinitions);
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
          {canShareMatrix && (
            <>
              <button
                onClick={() => setShareModal("send")}
                className="text-xs font-semibold rounded-lg px-3 py-1.5 border"
                style={{ borderColor: "var(--ch-navy)", color: "var(--ch-navy)" }}
              >
                Send Matrix to Client
              </button>
              <button
                onClick={() => setShareModal("history")}
                className="text-xs font-semibold rounded-lg px-3 py-1.5 border"
                style={{ borderColor: "var(--ch-line)", color: "var(--ch-sub)" }}
              >
                Sharing History
              </button>
            </>
          )}
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
          // Travel documents (Passport, Seaman's Book, ...) expand into two
          // adjacent display columns — Issued / Expiry — everything else
          // stays a single column. lineGroups (category bands) and
          // lineDocTypeGroups (document-name spans) are both derived from
          // this same expanded list so the header tiers always agree.
          const lineDisplayColumns = expandColumns(lineColumns);
          const { groups: lineGroups, groupIndex: lineGroupIndex } = groupByCategory(lineDisplayColumns);
          const lineDocTypeGroups = groupByDocType(lineDisplayColumns);

          return (
            <StaffingLineCard
              key={line.id}
              line={line}
              view={view}
              crewForLine={crewForLine}
              lineDisplayColumns={lineDisplayColumns}
              lineDocTypeGroups={lineDocTypeGroups}
              lineGroups={lineGroups}
              lineGroupIndex={lineGroupIndex}
              colorForCategory={colorForCategory}
              mandatoryDocTypeIds={mandatoryDocTypeIds}
              crewMatrixId={crewMatrixId}
              matrixTitle={matrixTitle}
              canManage={canManage}
              canAssignCrew={canAssignCrew}
              onChanged={onChanged}
              customFieldDefinitions={customFieldDefinitions}
            />
          );
        })}
      </div>

      {shareModal === "send" && (
        <SendMatrixWizard
          crewMatrixId={crewMatrixId}
          matrixTitle={matrixTitle}
          matrixNumber={matrixNumber}
          matrixVersion={matrixVersion}
          matrixStatus={matrixStatus}
          lines={orderedLines}
          assignedCrew={crew}
          documentTypes={documentTypes}
          customFieldDefinitions={customFieldDefinitions}
          onClose={() => setShareModal(null)}
        />
      )}
      {shareModal === "history" && (
        <SharingHistoryPanel crewMatrixId={crewMatrixId} onClose={() => setShareModal(null)} />
      )}
    </div>
  );
}

function StaffingLineCard({
  line,
  view,
  crewForLine,
  lineDisplayColumns,
  lineDocTypeGroups,
  lineGroups,
  lineGroupIndex,
  colorForCategory,
  mandatoryDocTypeIds,
  crewMatrixId,
  matrixTitle,
  canManage,
  canAssignCrew,
  onChanged,
  customFieldDefinitions,
}: {
  line: Line;
  view: "assigned" | "available";
  crewForLine: StaffingCrew[];
  lineDisplayColumns: DisplayColumn[];
  lineDocTypeGroups: { docType: DocTypeRef; count: number }[];
  lineGroups: CategoryGroup[];
  lineGroupIndex: number[];
  colorForCategory: (category: string | null) => string;
  mandatoryDocTypeIds: Set<string>;
  crewMatrixId: string;
  matrixTitle?: string;
  canManage: boolean;
  canAssignCrew: boolean;
  onChanged?: () => void;
  customFieldDefinitions: FieldDef[];
}) {
  const [mailBusy, setMailBusy] = useState(false);
  const [mailError, setMailError] = useState<string | null>(null);

  // Assign only makes sense from Available candidates; Unassign only from
  // Assigned. Share (per row and per rank header) is Assigned-only — a
  // candidate who isn't assigned yet has nothing worth sending a client.
  const showAssignCol = view === "available" && canAssignCrew;
  const showUnassignCol = view === "assigned" && canAssignCrew;
  const showShareCol = view === "assigned" && canManage;
  const showActionsCol = showAssignCol || showUnassignCol || showShareCol;
  const showHeaderShare = showShareCol && crewForLine.length > 0;

  const emailAllLinks = async () => {
    setMailError(null);
    setMailBusy(true);
    try {
      const results = await Promise.all(
        crewForLine.map(async (person) => {
          const res = await createResourceProfileLink(person.crew_id, line.id);
          return { name: person.full_name, url: res?.url as string | undefined, error: res?.error as string | undefined };
        })
      );
      const withLinks = results.filter((r) => r.url);
      if (withLinks.length === 0) {
        setMailError(results[0]?.error ?? "Could not generate any links.");
        return;
      }
      const subject = `Candidate profiles — ${line.job_role_name}${matrixTitle ? ` — ${matrixTitle}` : ""}`;
      const body = results.map((r) => (r.url ? `${r.name}: ${r.url}` : `${r.name}: (couldn't generate a link — ${r.error ?? "unknown error"})`)).join("\n");
      // mailto: opens whatever mail app is configured on this machine
      // (Outlook, Mail, Gmail-as-default, etc.) with the message drafted
      // and ready to review/send — nothing is sent from the server.
      window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    } finally {
      setMailBusy(false);
    }
  };

  return (
    <div className={`${cardCls} overflow-hidden`} style={cardStyle}>
      <div className="px-3 py-2 flex items-center justify-between gap-3 flex-wrap" style={{ background: "var(--ch-navy-soft)" }}>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm font-semibold" style={{ color: "var(--ch-navy)" }}>{line.job_role_name}</span>
          <span className="text-xs" style={{ color: "var(--ch-sub)" }}>
            Headcount required {line.required_headcount} · {crewForLine.length} {view === "assigned" ? "assigned" : "available"}
          </span>
        </div>
        {showHeaderShare && (
          <button
            onClick={emailAllLinks}
            disabled={mailBusy}
            className="text-xs font-semibold rounded-lg px-3 py-1.5 border disabled:opacity-50"
            style={{ borderColor: "var(--ch-line)", color: "var(--ch-navy)", background: "#fff" }}
            title="Generates a profile link for everyone assigned to this rank and opens your mail app with them drafted into an email"
          >
            {mailBusy ? "Preparing…" : "✉ Email profile links"}
          </button>
        )}
      </div>
      {mailError && (
        <div className="px-3 py-1.5 text-xs" style={{ color: "var(--ch-fail)" }}>{mailError}</div>
      )}
      {crewForLine.length === 0 ? (
        <div className="px-3 py-3 text-sm" style={{ color: "var(--ch-sub)" }}>
          {view === "assigned"
            ? "No crew currently assigned to this rank at this site."
            : "No unassigned, available crew match this rank right now."}
        </div>
      ) : lineDisplayColumns.length === 0 ? (
        <div className="px-3 py-3 text-sm" style={{ color: "var(--ch-sub)" }}>
          No document types are required for this rank yet — add them under the Lines tab.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-xs border-collapse w-full">
            <thead>
              <tr>
                <th rowSpan={3} className="text-left font-semibold px-3 py-2 whitespace-nowrap align-bottom" style={{ color: "var(--ch-sub)", background: "var(--ch-paper)" }}>Name</th>
                <th rowSpan={3} className="text-left font-semibold px-3 py-2 whitespace-nowrap align-bottom" style={{ color: "var(--ch-sub)", background: "var(--ch-paper)" }}>Nationality</th>
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
                  <th rowSpan={3} className="text-left font-semibold px-3 py-2 whitespace-nowrap align-bottom border-l" style={{ color: "var(--ch-sub)", borderColor: "var(--ch-line)", background: "var(--ch-paper)" }}>
                    Actions
                  </th>
                )}
              </tr>
              <tr>
                {(() => {
                  let idx = 0;
                  return lineDocTypeGroups.map((g) => {
                    const startIdx = idx;
                    idx += g.count;
                    const isGroupStart = startIdx === 0 || lineGroupIndex[startIdx - 1] !== lineGroupIndex[startIdx];
                    return (
                      <th
                        key={g.docType.id}
                        colSpan={g.count}
                        rowSpan={g.count > 1 ? 1 : 2}
                        className={`text-left font-semibold px-3 py-2 whitespace-nowrap${isGroupStart ? " border-l" : ""}${g.count > 1 ? "" : " align-bottom"}`}
                        style={{ color: "var(--ch-sub)", borderColor: "var(--ch-line)", background: colorForCategory(lineGroups[lineGroupIndex[startIdx]]?.category ?? null) }}
                      >
                        {g.docType.name}
                        {mandatoryDocTypeIds.has(g.docType.id) && (
                          <span className="ml-0.5 font-semibold" style={{ color: "var(--ch-fail)" }} title="Mandatory">*</span>
                        )}
                      </th>
                    );
                  });
                })()}
              </tr>
              <tr>
                {lineDisplayColumns.map((dc, i) =>
                  dc.part === "single" ? null : (
                    <th
                      key={dc.key}
                      className={`text-left font-normal px-3 py-1.5 whitespace-nowrap${dc.part === "issued" ? " border-l" : ""}`}
                      style={{ color: "var(--ch-sub)", borderColor: "var(--ch-line)", background: colorForCategory(lineGroups[lineGroupIndex[i]]?.category ?? null) }}
                    >
                      {dc.part === "issued" ? "Issued" : "Expiry"}
                    </th>
                  )
                )}
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
                  {lineDisplayColumns.map((dc) => (
                    <DocCell
                      key={dc.key}
                      docType={dc.docType}
                      part={dc.part}
                      doc={person.documents[dc.docType.id]}
                      fieldDefs={customFieldDefinitions.filter((f) => f.applies_to_document_type_id === dc.docType.id || f.applies_to_document_type_id === null)}
                    />
                  ))}
                  {showActionsCol && (
                    <RowActions
                      crewId={person.crew_id}
                      crewMatrixId={crewMatrixId}
                      lineId={line.id}
                      personName={person.full_name}
                      showAssign={showAssignCol}
                      showUnassign={showUnassignCol}
                      showShare={showShareCol}
                      onChanged={onChanged}
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
}

function RowActions({
  crewId,
  crewMatrixId,
  lineId,
  personName,
  showAssign,
  showUnassign,
  showShare,
  onChanged,
}: {
  crewId: string;
  crewMatrixId: string;
  lineId: string;
  personName: string;
  showAssign: boolean;
  showUnassign: boolean;
  showShare: boolean;
  onChanged?: () => void;
}) {
  const [busy, setBusy] = useState<"assign" | "unassign" | "share" | null>(null);
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
    onChanged?.();
  };

  const doUnassign = async () => {
    if (!window.confirm(`Unassign ${personName} from this rank?`)) return;
    setError(null);
    setBusy("unassign");
    const res = await unassignCandidateFromMatrix(crewId, crewMatrixId);
    setBusy(null);
    if (res?.error) {
      setError(res.error);
      return;
    }
    onChanged?.();
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
        {showUnassign && (
          <button
            onClick={doUnassign}
            disabled={busy !== null}
            className="text-[11px] font-semibold rounded px-2 py-1 border disabled:opacity-50"
            style={{ borderColor: "var(--ch-line)", color: "var(--ch-fail)" }}
          >
            {busy === "unassign" ? "Unassigning…" : "Unassign"}
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
  part = "single",
}: {
  docType: DocTypeRef;
  doc: StaffingCrew["documents"][string] | undefined;
  fieldDefs: FieldDef[];
  part?: "single" | "issued" | "expiry";
}) {
  // Every column reaching this component is already required for the rank
  // it's rendered under (see lineDisplayColumns) — required is always true
  // here. `part` picks which half of a split travel-document column this
  // cell renders; "single" (the default) is every other document type,
  // completely unchanged from before the split existed.
  const info = cellInfoPart(true, docType, doc, fieldDefs, part);

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
          {info.text}
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
