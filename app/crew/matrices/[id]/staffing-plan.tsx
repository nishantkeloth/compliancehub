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

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Line, DocTypeRef } from "./lines-editor";
import { DOCUMENT_STATUS_COLORS } from "@/lib/document-status";
import { assignCandidateToMatrix, unassignCandidateFromMatrix } from "./staffing-actions";
import { requestRosterChange } from "./roster-change-actions";
import { REASON_CODES } from "./roster-change-shared";
import {
  cellInfoPart,
  formatCategoryLabel,
  formatDate,
  groupByCategory,
  groupByDocType,
  expandColumns,
  partLabel,
  orderDocumentColumns,
  buildCategoryColorMap,
  buildStaffingPlanWorkbook,
  computeCompleteness,
  UNCATEGORIZED_KEY,
  CATEGORY_BAND_COLORS,
  type CategoryGroup,
  type DisplayColumn,
  type DisplayColumnPart,
  type StaffingCrew,
  type FieldDef,
} from "@/lib/staffing-plan-shared";
import RosterTimeline, { type HistoryRow } from "./roster-timeline";

// Re-exported for existing callers (matrix-detail.tsx) that import these
// types from this file — the actual definitions now live in
// lib/staffing-plan-shared.ts so server-side code (share-actions.ts) can
// use them too without importing a "use client" module.
export type { StaffingCrew, FieldDef };

const cardCls = "bg-white border rounded-xl";
const cardStyle = { borderColor: "var(--ch-line)" };

// Phase 16 — case-insensitive, whitespace-tolerant match between a crew
// member's current_location (constrained to lib/regions.ts) and a matrix's
// site/project operating_region (still free text) — see matrixRegion's
// comment in page.tsx for why these can't be guaranteed to line up exactly.
function sameRegion(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

type CrewRow = { person: StaffingCrew; completeness: number };

function completenessColors(pct: number): { bg: string; fg: string } {
  if (pct >= 80) return DOCUMENT_STATUS_COLORS.ok;
  if (pct >= 50) return DOCUMENT_STATUS_COLORS.warning;
  return DOCUMENT_STATUS_COLORS.expired;
}

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
  matrixRegion,
  customFieldDefinitions,
  canManage = false,
  canAssignCrew = false,
  canApproveInternal = false,
  statusHistory,
  matrixCreatedAt,
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
  // Phase 16 — the matrix's own site/project region (free text). When set,
  // Available Candidates splits into region-matched vs "Other region"
  // groups instead of one alphabetical list; both groups are then sorted
  // by document completeness (see computeCompleteness) so the
  // best-prepared, closest candidates surface first.
  matrixRegion?: string | null;
  customFieldDefinitions: FieldDef[];
  // All default to false so this component still works if a caller (e.g.
  // an older test/story) doesn't pass them — the Actions column just stays
  // hidden, same as no permissions.
  canManage?: boolean;
  canAssignCrew?: boolean;
  // Phase 17 — the roster change/approval timeline, shown inline at the
  // top of the Assigned view rather than as its own top-level tab (see
  // matrix-detail.tsx, which used to route this to a separate "Approval
  // History" tab — folded in here per the client's request to keep it
  // where the assign/unassign actions themselves live). Optional so this
  // component still renders fine without it (e.g. an older caller).
  canApproveInternal?: boolean;
  statusHistory?: HistoryRow[];
  matrixCreatedAt?: string | null;
  onChanged?: () => void;
}) {
  // Assign/Unassign trigger a router.refresh() (see MatrixDetail's
  // regenerateStaffingPlan) to re-fetch the crew/document snapshot, which
  // re-suspends this page and remounts the client tree — a plain
  // useState("assigned") would silently reset back to "Assigned" every
  // time, even when the action was "Assign" from Available candidates
  // (confirmed by testing: clicking Assign bounced the view back to
  // Assigned). Seeding from — and writing to — a `staffingView` URL param
  // means the remounted component reads the same view straight back out
  // of the URL instead of losing it, same pattern as MatrixDetail's own
  // `tab` param.
  const router = useRouter();
  const searchParams = useSearchParams();
  const viewFromUrl = searchParams.get("staffingView");
  const [view, setViewState] = useState<"assigned" | "available">(viewFromUrl === "available" ? "available" : "assigned");
  const setView = (v: "assigned" | "available") => {
    setViewState(v);
    const params = new URLSearchParams(searchParams.toString());
    if (v === "assigned") params.delete("staffingView");
    else params.set("staffingView", v);
    const qs = params.toString();
    router.replace(`/crew/matrices/${crewMatrixId}${qs ? `?${qs}` : ""}`, { scroll: false });
  };
  const [exporting, setExporting] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);

  // Assign/Unassign already succeeded on the server by the time these are
  // called (see RowActions) — the slow part was never that single insert/
  // delete, it's the subsequent full-page router.refresh() this component
  // still triggers afterwards (see onChanged below) so every other tab on
  // the page eventually sees fresh data too. Moving the row between these
  // local lists immediately, instead of waiting for that refresh to land,
  // is what makes Assign/Unassign feel instant — the background refresh
  // still runs, and resyncs local state (via the effects below) once it
  // resolves, so nothing is permanently out of step with the server.
  const [localCrew, setLocalCrew] = useState(crew);
  const [localCandidateCrew, setLocalCandidateCrew] = useState(candidateCrew ?? []);
  useEffect(() => setLocalCrew(crew), [crew]);
  useEffect(() => setLocalCandidateCrew(candidateCrew ?? []), [candidateCrew]);

  const moveToAssigned = (crewId: string, dates?: { assignment_start_date: string; assignment_planned_end_date: string | null }) => {
    setLocalCandidateCrew((prev) => {
      const person = prev.find((p) => p.crew_id === crewId);
      if (person) {
        const moved = dates ? { ...person, ...dates } : person;
        setLocalCrew((c) => (c.some((x) => x.crew_id === crewId) ? c : [...c, moved]));
      }
      return prev.filter((p) => p.crew_id !== crewId);
    });
  };
  const moveToAvailable = (crewId: string) => {
    setLocalCrew((prev) => {
      const person = prev.find((p) => p.crew_id === crewId);
      if (person) setLocalCandidateCrew((c) => (c.some((x) => x.crew_id === crewId) ? c : [...c, person]));
      return prev.filter((p) => p.crew_id !== crewId);
    });
  };

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

  const activeCrew = view === "assigned" ? localCrew : localCandidateCrew;

  // Phase 17 — once a matrix is Active (meaning it's a live, client-facing
  // roster rather than something still being composed), assign/replace/
  // unassign stop being instant writes and become roster change requests
  // that need internal sign-off first. See roster-change-actions.ts for
  // why: the whole point of the request+approval trail is to build the
  // expanding timeline on the History tab, and that only makes sense once
  // there's an activated matrix to hang it off. Draft/pending/approved
  // (not-yet-active) matrices keep today's direct-write behavior
  // unchanged — they haven't gone live yet, so there's nothing for an
  // approval step to protect.
  const requiresApproval = matrixStatus === "active";

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
      {/* Phase 17 — roster change/approval timeline, folded into the top
          of the Assigned view (collapsed by default, one row tall) rather
          than living on its own top-level tab — this is where the
          assign/replace/unassign actions themselves happen, so the
          client asked to see pending approvals and change history right
          here instead of navigating away to find them. */}
      {view === "assigned" && (
        <div className={`${cardCls} mb-3`} style={cardStyle}>
          <button
            onClick={() => setTimelineOpen((o) => !o)}
            className="w-full flex items-center justify-between px-3 py-2 text-left"
          >
            <span className="text-xs font-semibold" style={{ color: "var(--ch-navy)" }}>Roster Change History</span>
            <span className="text-xs" style={{ color: "var(--ch-sub)" }}>{timelineOpen ? "Hide ▲" : "Show ▼"}</span>
          </button>
          {timelineOpen && (
            <div className="px-3 pb-3 pt-1 border-t" style={{ borderColor: "var(--ch-line)" }}>
              <RosterTimeline
                crewMatrixId={crewMatrixId}
                history={statusHistory ?? []}
                matrixCreatedAt={matrixCreatedAt}
                canApproveInternal={canApproveInternal}
              />
            </div>
          )}
        </div>
      )}
      {/* Toolbar gets its own row, always left-aligned, regardless of how
          long the description below happens to be. The two used to share
          one `justify-between` flex row — fine while both fit on one line,
          but the "Available candidates" description is longer than the
          "Assigned" one, so switching views could force the toolbar to
          wrap onto its own line, where a lone flex item under
          `justify-between` collapses to the start (left) instead of
          staying pinned right. Splitting them into separate rows makes the
          toolbar's position (left) independent of the description's
          length entirely, so it can't shift between views anymore. */}
      <div className="flex items-center gap-2 flex-wrap mb-2">
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
      <div className="text-xs mb-3" style={{ color: "var(--ch-sub)" }}>
        {view === "assigned"
          ? <>One row per crew member currently assigned to this site, grouped by rank.</>
          : <>One row per crew member who matches the rank, holds no active assignment anywhere, and is free today — a preview for staffing before any mobilization request exists.</>}
        {" "}Each rank only shows the document types required for that rank, grouped by category —{" "}
        &quot;Missing&quot; means it&apos;s required and no record exists yet, and{" "}
        <span className="font-semibold" style={{ color: "var(--ch-fail)" }}>*</span> marks a document that&apos;s mandatory for that rank.
      </div>
      <div className="space-y-4">
        {orderedLines.map((line) => {
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

          // Phase 16 — completeness is computed for every row regardless of
          // view (cheap, and Assigned rows may still want it later); only
          // Available candidates actually sorts/splits by it, per the
          // requirement that closer, more-complete candidates surface
          // first for staffing decisions.
          const rowsForLine: CrewRow[] = activeCrew
            .filter((c) => c.job_role_id === line.job_role_id)
            .map((c) => ({ person: c, completeness: computeCompleteness(line.documents, documentTypes, c.documents) }));

          const splitByRegion = view === "available" && !!matrixRegion;
          let matchedRows: CrewRow[] = splitByRegion ? rowsForLine.filter((r) => sameRegion(r.person.current_location, matrixRegion)) : rowsForLine;
          let otherRows: CrewRow[] = splitByRegion ? rowsForLine.filter((r) => !sameRegion(r.person.current_location, matrixRegion)) : [];

          const sortRows = (rows: CrewRow[]) =>
            view === "available"
              ? [...rows].sort((a, b) => b.completeness - a.completeness || a.person.full_name.localeCompare(b.person.full_name))
              : [...rows].sort((a, b) => a.person.full_name.localeCompare(b.person.full_name));
          matchedRows = sortRows(matchedRows);
          otherRows = sortRows(otherRows);

          // For the Assigned view's "Replace" picker — who else already
          // matches this rank and is free, regardless of which view tab
          // happens to be open right now.
          const candidateOptions = localCandidateCrew
            .filter((c) => c.job_role_id === line.job_role_id)
            .map((c) => ({ crew_id: c.crew_id, full_name: c.full_name }))
            .sort((a, b) => a.full_name.localeCompare(b.full_name));

          return (
            <StaffingLineCard
              key={line.id}
              line={line}
              view={view}
              matchedRows={matchedRows}
              otherRows={otherRows}
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
              requiresApproval={requiresApproval}
              candidateOptions={candidateOptions}
              onChanged={onChanged}
              onAssigned={moveToAssigned}
              onUnassigned={moveToAvailable}
              customFieldDefinitions={customFieldDefinitions}
            />
          );
        })}
      </div>

    </div>
  );
}

function StaffingLineCard({
  line,
  view,
  matchedRows,
  otherRows,
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
  requiresApproval,
  candidateOptions,
  onChanged,
  onAssigned,
  onUnassigned,
  customFieldDefinitions,
}: {
  line: Line;
  view: "assigned" | "available";
  // Phase 16 — Available candidates splits into region-matched (matchedRows)
  // and "Other region" (otherRows, only ever non-empty when a matrixRegion
  // was set) groups, each already sorted by document completeness
  // descending. Assigned view (and Available with no matrixRegion) puts
  // everything in matchedRows, alphabetically, and otherRows stays empty —
  // so the "Other region" divider below only ever renders when it means
  // something.
  matchedRows: CrewRow[];
  otherRows: CrewRow[];
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
  requiresApproval: boolean;
  candidateOptions: { crew_id: string; full_name: string }[];
  onChanged?: () => void;
  onAssigned: (crewId: string, dates?: { assignment_start_date: string; assignment_planned_end_date: string | null }) => void;
  onUnassigned: (crewId: string) => void;
  customFieldDefinitions: FieldDef[];
}) {
  const allRows = matchedRows.length || otherRows.length ? [...matchedRows, ...otherRows] : [];

  // Assign only makes sense from Available candidates; Unassign only from
  // Assigned. The per-row/per-rank "Share link" / "Email profile links"
  // actions (candidate_resource_profile_links) were removed at the
  // client's request — not needed at either the crew or the rank level.
  const showAssignCol = view === "available" && canAssignCrew;
  const showUnassignCol = view === "assigned" && canAssignCrew;
  const showActionsCol = showAssignCol || showUnassignCol;

  return (
    <div className={`${cardCls} overflow-hidden`} style={cardStyle}>
      <div className="px-3 py-2 flex items-center justify-between gap-3 flex-wrap" style={{ background: "var(--ch-navy-soft)" }}>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm font-semibold" style={{ color: "var(--ch-navy)" }}>{line.job_role_name}</span>
          <span className="text-xs" style={{ color: "var(--ch-sub)" }}>
            Headcount required {line.required_headcount} · {allRows.length} {view === "assigned" ? "assigned" : "available"}
            {otherRows.length > 0 && ` (${matchedRows.length} in region)`}
          </span>
        </div>
      </div>
      {allRows.length === 0 ? (
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
                {view === "assigned" && (
                  <>
                    <th rowSpan={3} className="text-left font-semibold px-3 py-2 whitespace-nowrap align-bottom border-l" style={{ color: "var(--ch-sub)", borderColor: "var(--ch-line)", background: "var(--ch-paper)" }}>Start Date</th>
                    <th rowSpan={3} className="text-left font-semibold px-3 py-2 whitespace-nowrap align-bottom" style={{ color: "var(--ch-sub)", background: "var(--ch-paper)" }}>Roll Off Date</th>
                  </>
                )}
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
                        className={`text-center font-semibold px-3 py-2 whitespace-nowrap${isGroupStart ? " border-l" : ""}${g.count > 1 ? "" : " align-bottom"}`}
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
                {lineDisplayColumns.map((dc, i) => {
                  if (dc.part === "single") return null;
                  // First sub-column of its document type (Number, or
                  // Issued when a travel document doesn't track a number)
                  // gets the divider that separates it from the previous
                  // document type — not hardcoded to any one part, since a
                  // document type's leading sub-column now varies.
                  const isFirstSub = i === 0 || lineDisplayColumns[i - 1].docType.id !== dc.docType.id;
                  return (
                    <th
                      key={dc.key}
                      className={`text-center font-normal px-3 py-1.5 whitespace-nowrap${isFirstSub ? " border-l" : ""}`}
                      style={{ color: "var(--ch-sub)", borderColor: "var(--ch-line)", background: colorForCategory(lineGroups[lineGroupIndex[i]]?.category ?? null) }}
                    >
                      {partLabel(dc.part)}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {matchedRows.map(({ person, completeness }) => (
                <CandidateRow
                  key={person.crew_id}
                  person={person}
                  completeness={completeness}
                  view={view}
                  lineDisplayColumns={lineDisplayColumns}
                  customFieldDefinitions={customFieldDefinitions}
                  showActionsCol={showActionsCol}
                  crewMatrixId={crewMatrixId}
                  lineId={line.id}
                  showAssignCol={showAssignCol}
                  showUnassignCol={showUnassignCol}
                  requiresApproval={requiresApproval}
                  candidateOptions={candidateOptions}
                  onChanged={onChanged}
                  onAssigned={onAssigned}
                  onUnassigned={onUnassigned}
                />
              ))}
              {otherRows.length > 0 && (
                <tr>
                  <td
                    colSpan={2 + (view === "assigned" ? 2 : 0) + lineDisplayColumns.length + (showActionsCol ? 1 : 0)}
                    className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide border-t"
                    style={{ color: "var(--ch-sub)", borderColor: "var(--ch-line)", background: "var(--ch-paper)" }}
                  >
                    Other region ({otherRows.length})
                  </td>
                </tr>
              )}
              {otherRows.map(({ person, completeness }) => (
                <CandidateRow
                  key={person.crew_id}
                  person={person}
                  completeness={completeness}
                  view={view}
                  lineDisplayColumns={lineDisplayColumns}
                  customFieldDefinitions={customFieldDefinitions}
                  showActionsCol={showActionsCol}
                  crewMatrixId={crewMatrixId}
                  lineId={line.id}
                  showAssignCol={showAssignCol}
                  showUnassignCol={showUnassignCol}
                  requiresApproval={requiresApproval}
                  candidateOptions={candidateOptions}
                  onChanged={onChanged}
                  onAssigned={onAssigned}
                  onUnassigned={onUnassigned}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Phase 16 — one candidate row, factored out of StaffingLineCard so the
// same markup renders for both the region-matched and "Other region"
// groups without duplicating it. The completeness % badge sits first in
// the Name cell, ahead of the name itself, per the requirement that it be
// visible "at the beginning of the line" — Available candidates only, since
// it exists to rank candidates, not to describe someone already assigned.
function CandidateRow({
  person,
  completeness,
  view,
  lineDisplayColumns,
  customFieldDefinitions,
  showActionsCol,
  crewMatrixId,
  lineId,
  showAssignCol,
  showUnassignCol,
  requiresApproval,
  candidateOptions,
  onChanged,
  onAssigned,
  onUnassigned,
}: {
  person: StaffingCrew;
  completeness: number;
  view: "assigned" | "available";
  lineDisplayColumns: DisplayColumn[];
  customFieldDefinitions: FieldDef[];
  showActionsCol: boolean;
  crewMatrixId: string;
  lineId: string;
  showAssignCol: boolean;
  showUnassignCol: boolean;
  requiresApproval: boolean;
  candidateOptions: { crew_id: string; full_name: string }[];
  onChanged?: () => void;
  onAssigned: (crewId: string, dates?: { assignment_start_date: string; assignment_planned_end_date: string | null }) => void;
  onUnassigned: (crewId: string) => void;
}) {
  const badge = completenessColors(completeness);
  return (
    <tr className="border-t" style={{ borderColor: "var(--ch-line)" }}>
      <td className="px-3 py-2 whitespace-nowrap">
        <div className="flex items-center gap-1.5">
          {view === "available" && (
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-semibold shrink-0"
              style={{ background: badge.bg, color: badge.fg }}
              title="Share of this rank's required documents already on file and not expired"
            >
              {completeness}%
            </span>
          )}
          <span className="font-semibold" style={{ color: "var(--ch-ink)" }}>{person.full_name}</span>
        </div>
        {view === "available" && person.availability_date && (
          <div className="text-[10px]" style={{ color: "var(--ch-sub)" }}>Free since {formatDate(person.availability_date)}</div>
        )}
      </td>
      <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--ch-ink)" }}>{person.nationality ?? "—"}</td>
      {view === "assigned" && (
        <>
          <td className="px-3 py-2 whitespace-nowrap border-l" style={{ borderColor: "var(--ch-line)", color: "var(--ch-ink)" }}>
            {person.assignment_start_date ? formatDate(person.assignment_start_date) : "—"}
          </td>
          <td className="px-3 py-2 whitespace-nowrap" style={{ color: person.assignment_planned_end_date ? "var(--ch-ink)" : "var(--ch-sub)" }}>
            {person.assignment_planned_end_date ? formatDate(person.assignment_planned_end_date) : "Not set"}
          </td>
        </>
      )}
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
          lineId={lineId}
          personName={person.full_name}
          showAssign={showAssignCol}
          showUnassign={showUnassignCol}
          requiresApproval={requiresApproval}
          candidateOptions={candidateOptions}
          onChanged={onChanged}
          onAssigned={onAssigned}
          onUnassigned={onUnassigned}
        />
      )}
    </tr>
  );
}

function RowActions({
  crewId,
  crewMatrixId,
  lineId,
  personName,
  showAssign,
  showUnassign,
  requiresApproval,
  candidateOptions,
  onChanged,
  onAssigned,
  onUnassigned,
}: {
  crewId: string;
  crewMatrixId: string;
  lineId: string;
  personName: string;
  showAssign: boolean;
  showUnassign: boolean;
  requiresApproval: boolean;
  candidateOptions: { crew_id: string; full_name: string }[];
  onChanged?: () => void;
  onAssigned: (crewId: string, dates?: { assignment_start_date: string; assignment_planned_end_date: string | null }) => void;
  onUnassigned: (crewId: string) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [busy, setBusy] = useState<"assign" | "unassign" | "request" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Assign/unassign date inputs default to today but stay editable — AHM
  // calculates on-board day counts and payroll from these dates, so they
  // need to be caller-chosen, not silently stamped to "now". Planned end
  // date is optional (left blank by default) — it's shown on the Assigned
  // tab once set, but nothing requires it.
  const [assignDate, setAssignDate] = useState(today);
  const [plannedEndDate, setPlannedEndDate] = useState("");
  const [unassignDate, setUnassignDate] = useState(today);

  // Phase 17 — once the matrix is Active, the instant assign/unassign
  // forms above are replaced by this request form: pick what kind of
  // change (Replace only makes sense from the Assigned side, where
  // there's someone to replace), a mandatory reason, optional notes, and
  // an effective date. Submitting raises a roster_change_request and
  // stops there — nothing on screen moves until an approver with
  // crew.matrix.approve_internal confirms it (see the History tab's
  // timeline, or roster-change-actions.ts).
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestKind, setRequestKind] = useState<"replace" | "unassign_only">("replace");
  const [incomingCrewId, setIncomingCrewId] = useState("");
  const [reasonCode, setReasonCode] = useState("");
  const [reasonNotes, setReasonNotes] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(today);
  const [requestSent, setRequestSent] = useState(false);

  const doAssign = async () => {
    setError(null);
    setBusy("assign");
    const res = await assignCandidateToMatrix(crewId, crewMatrixId, assignDate, plannedEndDate || undefined);
    setBusy(null);
    if (res?.error) {
      setError(res.error);
      return;
    }
    // The insert already succeeded server-side — move this row over
    // immediately, with the dates just entered, rather than waiting on the
    // slower full-page refresh below to land before the UI reflects it.
    onAssigned(crewId, { assignment_start_date: assignDate, assignment_planned_end_date: plannedEndDate || null });
    onChanged?.();
  };

  const doUnassign = async () => {
    if (!window.confirm(`Unassign ${personName} from this rank as of ${unassignDate}?`)) return;
    setError(null);
    setBusy("unassign");
    const res = await unassignCandidateFromMatrix(crewId, crewMatrixId, unassignDate);
    setBusy(null);
    if (res?.error) {
      setError(res.error);
      return;
    }
    onUnassigned(crewId);
    onChanged?.();
  };

  const doRequestChange = async () => {
    if (!reasonCode) {
      setError("Please choose a reason.");
      return;
    }
    if (requestKind === "replace" && !incomingCrewId) {
      setError("Pick who's replacing them, or switch to “Unassign only”.");
      return;
    }
    setError(null);
    setBusy("request");
    const res = await requestRosterChange({
      crewMatrixId,
      crewMatrixLineId: lineId,
      changeType: showAssign ? "assign" : requestKind === "replace" ? "replace" : "unassign",
      outgoingCrewId: showAssign ? undefined : crewId,
      incomingCrewId: showAssign ? crewId : requestKind === "replace" ? incomingCrewId : undefined,
      effectiveDate,
      reasonCode,
      reasonNotes: reasonNotes || undefined,
    });
    setBusy(null);
    if (res?.error) {
      setError(res.error);
      return;
    }
    setRequestSent(true);
    setRequestOpen(false);
    onChanged?.();
  };

  const showRequestFlow = requiresApproval && (showAssign || showUnassign);

  return (
    <td className="px-3 py-2 border-l" style={{ borderColor: "var(--ch-line)" }}>
      <div className="flex items-center gap-1.5 whitespace-nowrap">
        {showRequestFlow ? (
          <>
            {requestSent ? (
              <span className="text-[11px] font-semibold rounded px-2 py-1" style={{ background: "#fff7ed", color: "#b45309" }}>
                Requested — pending approval
              </span>
            ) : (
              <button
                onClick={() => setRequestOpen((o) => !o)}
                className="text-[11px] font-semibold rounded px-2 py-1 border"
                style={{ borderColor: "var(--ch-line)", color: showAssign ? "var(--ch-navy)" : "#9d174d" }}
              >
                {showAssign ? "Request Assign" : "Request Change"}
              </button>
            )}
          </>
        ) : (
          <>
            {showAssign && (
              <>
                <input
                  type="date"
                  value={assignDate}
                  onChange={(e) => setAssignDate(e.target.value)}
                  disabled={busy !== null}
                  title="Start date"
                  className="text-[11px] rounded px-1 py-1 border disabled:opacity-50"
                  style={{ borderColor: "var(--ch-line)", color: "var(--ch-ink)", width: "8.5rem" }}
                />
                <input
                  type="date"
                  value={plannedEndDate}
                  onChange={(e) => setPlannedEndDate(e.target.value)}
                  min={assignDate}
                  disabled={busy !== null}
                  title="Planned end date (optional)"
                  placeholder="End date"
                  className="text-[11px] rounded px-1 py-1 border disabled:opacity-50"
                  style={{ borderColor: "var(--ch-line)", color: "var(--ch-ink)", width: "8.5rem" }}
                />
                <button
                  onClick={doAssign}
                  disabled={busy !== null}
                  className="text-[11px] font-semibold rounded px-2 py-1 border disabled:opacity-50"
                  style={{ borderColor: "var(--ch-line)", color: "var(--ch-navy)" }}
                >
                  {busy === "assign" ? "Assigning…" : "Assign"}
                </button>
              </>
            )}
            {showUnassign && (
              <>
                <input
                  type="date"
                  value={unassignDate}
                  onChange={(e) => setUnassignDate(e.target.value)}
                  disabled={busy !== null}
                  title="Unassign date"
                  className="text-[11px] rounded px-1 py-1 border disabled:opacity-50"
                  style={{ borderColor: "var(--ch-line)", color: "var(--ch-ink)", width: "8.5rem" }}
                />
                <button
                  onClick={doUnassign}
                  disabled={busy !== null}
                  className="text-[11px] font-semibold rounded px-2 py-1 border disabled:opacity-50"
                  style={{ borderColor: "var(--ch-line)", color: "var(--ch-fail)" }}
                >
                  {busy === "unassign" ? "Unassigning…" : "Unassign"}
                </button>
              </>
            )}
          </>
        )}
      </div>
      {requestOpen && (
        <div className="mt-2 p-2.5 rounded-lg border space-y-1.5" style={{ borderColor: "var(--ch-line)", background: "var(--ch-paper)", width: "15rem" }}>
          {showUnassign && (
            <div className="flex items-center gap-3 text-[11px]" style={{ color: "var(--ch-ink)" }}>
              <label className="flex items-center gap-1">
                <input type="radio" checked={requestKind === "replace"} onChange={() => setRequestKind("replace")} /> Replace
              </label>
              <label className="flex items-center gap-1">
                <input type="radio" checked={requestKind === "unassign_only"} onChange={() => setRequestKind("unassign_only")} /> Unassign only
              </label>
            </div>
          )}
          {showUnassign && requestKind === "replace" && (
            <select
              value={incomingCrewId}
              onChange={(e) => setIncomingCrewId(e.target.value)}
              className="text-[11px] rounded px-1.5 py-1 border w-full"
              style={{ borderColor: "var(--ch-line)", color: "var(--ch-ink)" }}
            >
              <option value="">Replacing with…</option>
              {candidateOptions.map((c) => (
                <option key={c.crew_id} value={c.crew_id}>{c.full_name}</option>
              ))}
            </select>
          )}
          <select
            value={reasonCode}
            onChange={(e) => setReasonCode(e.target.value)}
            className="text-[11px] rounded px-1.5 py-1 border w-full"
            style={{ borderColor: "var(--ch-line)", color: "var(--ch-ink)" }}
          >
            <option value="">Reason…</option>
            {REASON_CODES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
          <textarea
            value={reasonNotes}
            onChange={(e) => setReasonNotes(e.target.value)}
            placeholder="Notes (optional)"
            rows={2}
            className="text-[11px] rounded px-1.5 py-1 border w-full resize-none"
            style={{ borderColor: "var(--ch-line)", color: "var(--ch-ink)" }}
          />
          <input
            type="date"
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
            title="Effective date"
            className="text-[11px] rounded px-1.5 py-1 border w-full"
            style={{ borderColor: "var(--ch-line)", color: "var(--ch-ink)" }}
          />
          <div className="flex items-center gap-1.5">
            <button
              onClick={doRequestChange}
              disabled={busy !== null}
              className="text-[11px] font-semibold rounded px-2 py-1 border disabled:opacity-50"
              style={{ borderColor: "var(--ch-navy)", color: "var(--ch-navy)" }}
            >
              {busy === "request" ? "Submitting…" : "Submit for approval"}
            </button>
            <button
              onClick={() => setRequestOpen(false)}
              disabled={busy !== null}
              className="text-[11px] rounded px-2 py-1"
              style={{ color: "var(--ch-sub)" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <div className="text-[10px] mt-1" style={{ color: "var(--ch-fail)" }}>{error}</div>}
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
  part?: DisplayColumnPart;
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
