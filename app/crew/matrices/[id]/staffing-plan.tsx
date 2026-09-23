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

import { useEffect, useState, type CSSProperties } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Line, DocTypeRef } from "./lines-editor";
import { DOCUMENT_STATUS_COLORS } from "@/lib/document-status";
import { assignCandidateToMatrix, unassignCandidateFromMatrix, reserveCandidateForLine, unreserveCandidate } from "./staffing-actions";
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
  type ReservationInfo,
} from "@/lib/staffing-plan-shared";
import RosterTimeline, { type HistoryRow } from "./roster-timeline";

// Re-exported for existing callers (matrix-detail.tsx) that import these
// types from this file — the actual definitions now live in
// lib/staffing-plan-shared.ts so server-side code (share-actions.ts) can
// use them too without importing a "use client" module.
export type { StaffingCrew, FieldDef, ReservationInfo };

const cardCls = "bg-white border rounded-xl";
const cardStyle = { borderColor: "var(--ch-line)" };

// lib/regions.ts lists these three emirates as their own selectable
// entries alongside "United Arab Emirates" as a country — a site can be
// set to one specific emirate while crew are recorded at the country
// level (or vice versa). Without this, a site set to "Abu Dhabi" shows
// zero "Available candidates" even when the company's UAE crew are all
// there, just recorded as "United Arab Emirates" — exactly what
// happened after the current_location cleanup consolidated crew onto
// the country-level value. Treat any of the four as the same region.
const UAE_REGION_ALIASES = new Set(["abu dhabi", "dubai", "sharjah", "united arab emirates"]);
function normalizeRegion(value: string): string {
  const v = value.trim().toLowerCase();
  return UAE_REGION_ALIASES.has(v) ? "united arab emirates" : v;
}

// Phase 16 — case-insensitive, whitespace-tolerant match between a crew
// member's current_location (constrained to lib/regions.ts) and a matrix's
// site/project operating_region (still free text) — see matrixRegion's
// comment in page.tsx for why these can't be guaranteed to line up exactly.
function sameRegion(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return normalizeRegion(a) === normalizeRegion(b);
}

// Table dividers — approved via table-dividers-sample.html, then softened
// per feedback on the live page (the category-boundary line read as a
// hard black rule, not a divider). Both tiers are now a plain 1px line —
// a light one at a document type's own column group (e.g. Food Safety
// Certificate's Number+Date pair), a very slightly darker (but still
// soft, not bold/black) one at a category boundary (Certificates ->
// Travel Documents -> ...) and the very first data column (the boundary
// between the Name/Nationality/Actions columns and the document data).
// Shared by the three header rows and every body cell so the same line
// runs unbroken from the header straight down through the data.
const DIVIDER_COLOR = "#e5e7eb";
const DIVIDER_COLOR_HEAVY = "#d1d5db";
type DividerKind = "none" | "type" | "category";

function dividerKind(columns: DisplayColumn[], groupIndex: number[], i: number): DividerKind {
  if (i === 0) return "category";
  if (groupIndex[i] !== groupIndex[i - 1]) return "category";
  if (columns[i - 1].docType.id !== columns[i].docType.id) return "type";
  return "none";
}

function dividerStyle(kind: DividerKind): CSSProperties {
  if (kind === "category") return { borderLeftWidth: 1, borderLeftStyle: "solid", borderLeftColor: DIVIDER_COLOR_HEAVY };
  if (kind === "type") return { borderLeftWidth: 1, borderLeftStyle: "solid", borderLeftColor: DIVIDER_COLOR };
  return {};
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
  allVersions,
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
  // Phase 17 (timeline continuity) — every version in this matrix's family
  // (same matrix_number), each with its own id/status/created_at, so the
  // Roster Change History timeline can show one continuous ledger across
  // every version instead of resetting at each new version's own "Draft
  // created" (see RosterTimeline's file header). Optional, same reasoning
  // as statusHistory/matrixCreatedAt above — falls back to just this one
  // version when not passed.
  allVersions?: { id: string; version_number: number; status: string; created_at: string }[];
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
  // Third view — "Other Location Candidates" — split out from what used to
  // be a same-tab "Other region" divider inside Available Candidates (see
  // sameRegion below). Now a real tab of its own: candidates who match the
  // rank but whose current_location does NOT match this matrix's site/
  // project region, rather than a collapsed sub-section under Available.
  const [view, setViewState] = useState<"assigned" | "available" | "other_location">(
    viewFromUrl === "available" ? "available" : viewFromUrl === "other_location" ? "other_location" : "assigned"
  );
  const setView = (v: "assigned" | "available" | "other_location") => {
    setViewState(v);
    const params = new URLSearchParams(searchParams.toString());
    if (v === "assigned") params.delete("staffingView");
    else params.set("staffingView", v);
    const qs = params.toString();
    router.replace(`/crew/matrices/${crewMatrixId}${qs ? `?${qs}` : ""}`, { scroll: false });
  };
  const [exporting, setExporting] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(true);

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

  // Reserve/Unreserve (see RowActions) already succeeded on the server by
  // the time this is called — patch just that one candidate's reservation
  // in place, same "feels instant, background refresh resyncs later"
  // reasoning as moveToAssigned/moveToAvailable above. A candidate never
  // leaves either list for a reservation change (only Assign/Unassign
  // move rows between lists), so this only ever updates one field.
  const updateCandidateReservation = (crewId: string, reservation: ReservationInfo | null) => {
    setLocalCandidateCrew((prev) => prev.map((p) => (p.crew_id === crewId ? { ...p, reservation } : p)));
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

  // Phase 16/18 — Available candidates vs Other Location Candidates split
  // by current_location vs this matrix's site/project region (matrixRegion,
  // free text — see its comment in page.tsx). Computed once, here, so both
  // the on-screen per-line rows below and the Excel export use exactly the
  // same filtered set — a candidate view without a matrixRegion set at all
  // has nothing to compare against, so Available shows everyone (unchanged
  // prior behavior) and Other Location Candidates shows nobody rather than
  // guessing.
  const isCandidateView = view === "available" || view === "other_location";
  const activeCrew = !isCandidateView
    ? localCrew
    : !matrixRegion
      ? view === "available"
        ? localCandidateCrew
        : []
      : localCandidateCrew.filter((c) => (view === "available" ? sameRegion(c.current_location, matrixRegion) : !sameRegion(c.current_location, matrixRegion)));

  // Phase 17 (revised) — crew_assignments rows aren't scoped to a specific
  // matrix or version at all (they're keyed by crew_id + offshore_site_id,
  // live across every version of a site's matrix — see requestRosterChange's
  // comment in roster-change-actions.ts). That means editing "the active
  // matrix" was really always editing the one shared, client-facing site
  // roster, with no isolation and no review step protecting it. So:
  //  - Once a matrix is Active (isLiveMatrix below) — whatever version —
  //    its Staffing Plan is read-only. No Assign/Replace/Unassign/Request
  //    Change at all. The only way to change crew is Create New Version.
  //  - A NEW version (version_number > 1) is only editable while it's
  //    still a draft (canEditRoster below) — Replace/Unassign there
  //    records the change with a mandatory reason and stages it (see
  //    requestRosterChange) instead of writing to crew_assignments
  //    immediately, but it's a single step, not a separate request-then-
  //    approve — make as many changes as needed, then use the existing
  //    "Submit for approval" button at the top of the page (same Draft ->
  //    Submitted -> Internal approval -> Client approval pipeline every
  //    matrix already goes through) to send the whole version for review.
  //    Staged changes stay visible on this Staffing Plan (via page.tsx's
  //    overlay) all the way through that review, but only actually move
  //    the real, shared crew_assignments rows once, at Activate (see
  //    applyApprovedRosterChanges) — so the still-active previous version
  //    stays exactly as the client last saw it until the new version
  //    formally goes live. Once submitted (pending_internal_approval,
  //    pending_client_approval, approved, ...) the new version is
  //    read-only too, same as Lines editing already locks post-draft —
  //    return it to draft to make further changes.
  //  - A matrix's very first version (version 1, never yet active) keeps
  //    today's plain instant assign/unassign in any non-active status —
  //    nothing is live for a client yet, so there's nothing to protect.
  const isLiveMatrix = matrixStatus === "active";
  const isDraft = matrixStatus === "draft";
  const isNewVersion = (matrixVersion ?? 1) > 1;
  const isNewVersionUnderReview = isNewVersion && !isDraft && !isLiveMatrix;
  const readOnlyStaffing = isLiveMatrix || isNewVersionUnderReview;
  const canEditRoster = isNewVersion && isDraft;
  // Traffic light dots (Assigned view only) — only worth showing on a new
  // version at all, since a first-ever version (v1) can never carry a
  // staged roster change (see requestRosterChange's version_number > 1
  // check) and would just be a row of green dots with no information in
  // it. Once this version is Activated, page.tsx's overlay stops
  // surfacing any staged notes (they're applied by then), so every dot
  // here reads green from then on with no extra logic needed — the dot is
  // always literally "does this row carry a rosterChangeNote right now".
  const showTrafficLight = isNewVersion && view === "assigned";

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
      {readOnlyStaffing && (
        <div className="text-sm mb-3 rounded-lg px-3 py-2" style={{ background: "var(--ch-navy-soft)", color: "var(--ch-navy)" }}>
          {isLiveMatrix ? (
            <>This matrix is live, so its Staffing Plan is read-only. To change crew, use <strong>Create new version</strong> above.</>
          ) : (
            <>This version has been submitted for approval, so its Staffing Plan is read-only for now — crew changes already made are shown below and will take effect when this version goes live. Return it to draft to make more.</>
          )}
        </div>
      )}
      {showTrafficLight && (
        <div className="flex items-center gap-4 text-xs mb-3 flex-wrap" style={{ color: "var(--ch-sub)" }}>
          <span className="flex items-center gap-1.5">
            <span className="rounded-full inline-block" style={{ width: 8, height: 8, background: "#16a34a", boxShadow: "0 0 0 3px #eafaf0" }} />
            No change on this version
          </span>
          <span className="flex items-center gap-1.5">
            <span className="rounded-full inline-block" style={{ width: 8, height: 8, background: "#b45309", boxShadow: "0 0 0 3px #fff7ed" }} />
            Assigned/replaced on this version — turns green once activated
          </span>
        </div>
      )}
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
                allVersions={allVersions}
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
            {(["assigned", "available", "other_location"] as const).map((v) => (
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
                {v === "assigned" ? "Assigned" : v === "available" ? "Available candidates" : "Other Location Candidates"}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="text-xs mb-3" style={{ color: "var(--ch-sub)" }}>
        {view === "assigned" ? (
          <>One row per crew member currently assigned to this site, grouped by rank.</>
        ) : view === "available" ? (
          <>
            One row per crew member who matches the rank, holds no active assignment anywhere, and is free today — a preview for
            staffing before any mobilization request exists.{matrixRegion ? <> Limited to crew whose current location matches this site&apos;s region ({matrixRegion}).</> : null}
          </>
        ) : (
          <>
            Same pool as Available candidates, but limited to crew whose current location does{" "}
            <span className="font-semibold">not</span> match this site&apos;s region
            {matrixRegion ? <> ({matrixRegion})</> : null} — candidates you&apos;d need to bring in from elsewhere.
            {!matrixRegion && <> This matrix&apos;s site/project has no Operating Region set, so there&apos;s nothing to compare against — set one under Sites or Projects to use this tab.</>}
          </>
        )}
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
          // the candidate views actually sort by it, per the requirement
          // that closer, more-complete candidates surface first for
          // staffing decisions. activeCrew is already filtered to the
          // current view (region included — see its comment above), so
          // this is just a per-rank slice of it now, not a further split.
          let rows: CrewRow[] = activeCrew
            .filter((c) => c.job_role_id === line.job_role_id)
            .map((c) => ({ person: c, completeness: computeCompleteness(line.documents, documentTypes, c.documents) }));
          rows = isCandidateView
            ? [...rows].sort((a, b) => b.completeness - a.completeness || a.person.full_name.localeCompare(b.person.full_name))
            : [...rows].sort((a, b) => a.person.full_name.localeCompare(b.person.full_name));

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
              rows={rows}
              showLocationColumn={isCandidateView}
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
              readOnlyStaffing={readOnlyStaffing}
              canEditRoster={canEditRoster}
              showTrafficLight={showTrafficLight}
              candidateOptions={candidateOptions}
              onChanged={onChanged}
              onAssigned={moveToAssigned}
              onUnassigned={moveToAvailable}
              onReservationChanged={updateCandidateReservation}
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
  rows,
  showLocationColumn,
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
  readOnlyStaffing,
  canEditRoster,
  showTrafficLight,
  candidateOptions,
  onChanged,
  onAssigned,
  onUnassigned,
  onReservationChanged,
  customFieldDefinitions,
}: {
  line: Line;
  view: "assigned" | "available" | "other_location";
  // Already filtered to this view (including the region split for the two
  // candidate views — see activeCrew's comment in StaffingPlanView) and
  // sorted, for just this rank.
  rows: CrewRow[];
  // "Available candidates" and "Other Location Candidates" both show a
  // Current Location column (that's the whole point of the split); the
  // Assigned view doesn't — its own Start Date/Roll Off Date columns take
  // that slot instead.
  showLocationColumn: boolean;
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
  readOnlyStaffing: boolean;
  canEditRoster: boolean;
  showTrafficLight: boolean;
  candidateOptions: { crew_id: string; full_name: string }[];
  onChanged?: () => void;
  onAssigned: (crewId: string, dates?: { assignment_start_date: string; assignment_planned_end_date: string | null }) => void;
  onUnassigned: (crewId: string) => void;
  onReservationChanged: (crewId: string, reservation: ReservationInfo | null) => void;
  customFieldDefinitions: FieldDef[];
}) {
  // Assign makes sense from either candidate view; Unassign only from
  // Assigned. The per-row/per-rank "Share link" / "Email profile links"
  // actions (candidate_resource_profile_links) were removed at the
  // client's request — not needed at either the crew or the rank level.
  // A live matrix, or a new version already submitted for review, is
  // read-only regardless of view — see readOnlyStaffing's comment in
  // StaffingPlanView.
  const showAssignCol = !readOnlyStaffing && (view === "available" || view === "other_location") && canAssignCrew;
  const showUnassignCol = !readOnlyStaffing && view === "assigned" && canAssignCrew;
  const viewNoun = view === "assigned" ? "assigned" : view === "available" ? "available" : "in other locations";
  // Computed once per rank, reused by every row's DocCell below — see
  // dividerKind's own comment for what "category" vs "type" means.
  const columnDividers = lineDisplayColumns.map((_, i) => dividerKind(lineDisplayColumns, lineGroupIndex, i));

  return (
    <div className={`${cardCls} overflow-hidden`} style={cardStyle}>
      <div className="px-3 py-2 flex items-center justify-between gap-3 flex-wrap" style={{ background: "var(--ch-navy-soft)" }}>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm font-semibold" style={{ color: "var(--ch-navy)" }}>{line.job_role_name}</span>
          <span className="text-xs" style={{ color: "var(--ch-sub)" }}>
            Headcount required {line.required_headcount} · {rows.length} {viewNoun}
          </span>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="px-3 py-3 text-sm" style={{ color: "var(--ch-sub)" }}>
          {view === "assigned"
            ? "No crew currently assigned to this rank at this site."
            : view === "available"
              ? "No unassigned, available crew match this rank right now."
              : "No unassigned, available crew in another location match this rank right now."}
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
                {showAssignCol && (
                  // Kept up near Name/Nationality (instead of after every
                  // document column, at the far right of what's often a very
                  // wide, horizontally-scrolling table) so it's visible
                  // without scrolling — this is the only action on the
                  // Available/Other Location views, so it can live here
                  // instead of tucked away as a generic "Actions" column.
                  <th rowSpan={3} className="text-left font-semibold px-3 py-2 whitespace-nowrap align-bottom border-l" style={{ color: "var(--ch-sub)", borderColor: "var(--ch-line)", background: "var(--ch-paper)" }}>
                    Start Date &amp; Planned End Date
                  </th>
                )}
                {showLocationColumn && (
                  <th rowSpan={3} className="text-left font-semibold px-3 py-2 whitespace-nowrap align-bottom border-l" style={{ color: "var(--ch-sub)", borderColor: "var(--ch-line)", background: "var(--ch-paper)" }}>Current Location</th>
                )}
                {lineGroups.map((g, i) => (
                  <th
                    key={`${g.category ?? "general"}-${i}`}
                    colSpan={g.count}
                    className="text-center font-semibold px-3 py-1 whitespace-nowrap border-b"
                    style={{ color: "var(--ch-ink)", borderBottomColor: "var(--ch-line)", background: colorForCategory(g.category), ...dividerStyle("category") }}
                  >
                    {formatCategoryLabel(g.category)}
                  </th>
                ))}
                {showUnassignCol && (
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
                    const kind = dividerKind(lineDisplayColumns, lineGroupIndex, startIdx);
                    return (
                      <th
                        key={g.docType.id}
                        colSpan={g.count}
                        rowSpan={g.count > 1 ? 1 : 2}
                        className={`text-center font-semibold px-3 py-2 whitespace-nowrap${g.count > 1 ? "" : " align-bottom"}`}
                        style={{ color: "var(--ch-sub)", background: colorForCategory(lineGroups[lineGroupIndex[startIdx]]?.category ?? null), ...dividerStyle(kind) }}
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
                  // Divider at the first sub-column of its document type
                  // (Number, or Issued when a travel document doesn't
                  // track a number) — see dividerKind's comment above for
                  // why this line runs through the header AND the data
                  // rows below.
                  const kind = dividerKind(lineDisplayColumns, lineGroupIndex, i);
                  return (
                    <th
                      key={dc.key}
                      className="text-center font-normal px-3 py-1.5 whitespace-nowrap"
                      style={{ color: "var(--ch-sub)", background: colorForCategory(lineGroups[lineGroupIndex[i]]?.category ?? null), ...dividerStyle(kind) }}
                    >
                      {partLabel(dc.part)}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ person, completeness }) => (
                <CandidateRow
                  key={person.crew_id}
                  person={person}
                  completeness={completeness}
                  view={view}
                  lineDisplayColumns={lineDisplayColumns}
                  columnDividers={columnDividers}
                  customFieldDefinitions={customFieldDefinitions}
                  showLocationColumn={showLocationColumn}
                  crewMatrixId={crewMatrixId}
                  lineId={line.id}
                  showAssignCol={showAssignCol}
                  showUnassignCol={showUnassignCol}
                  canEditRoster={canEditRoster}
                  showTrafficLight={showTrafficLight}
                  candidateOptions={candidateOptions}
                  onChanged={onChanged}
                  onAssigned={onAssigned}
                  onUnassigned={onUnassigned}
                  onReservationChanged={onReservationChanged}
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
  columnDividers,
  customFieldDefinitions,
  showLocationColumn,
  crewMatrixId,
  lineId,
  showAssignCol,
  showUnassignCol,
  canEditRoster,
  showTrafficLight,
  candidateOptions,
  onChanged,
  onAssigned,
  onUnassigned,
  onReservationChanged,
}: {
  person: StaffingCrew;
  completeness: number;
  view: "assigned" | "available" | "other_location";
  lineDisplayColumns: DisplayColumn[];
  columnDividers: DividerKind[];
  customFieldDefinitions: FieldDef[];
  showLocationColumn: boolean;
  crewMatrixId: string;
  lineId: string;
  showAssignCol: boolean;
  showUnassignCol: boolean;
  canEditRoster: boolean;
  showTrafficLight: boolean;
  candidateOptions: { crew_id: string; full_name: string }[];
  onChanged?: () => void;
  onAssigned: (crewId: string, dates?: { assignment_start_date: string; assignment_planned_end_date: string | null }) => void;
  onUnassigned: (crewId: string) => void;
  onReservationChanged: (crewId: string, reservation: ReservationInfo | null) => void;
}) {
  const badge = completenessColors(completeness);
  // Phase 17 (traffic light) — green when this row isn't carrying a staged,
  // not-yet-applied roster change on this version; amber (with the change's
  // reason on hover) when it is. See StaffingCrew.rosterChangeNote's
  // comment in lib/staffing-plan-shared.ts for exactly what sets it.
  const changed = !!person.rosterChangeNote;
  return (
    <tr className="border-t" style={{ borderColor: "var(--ch-line)" }}>
      <td className="px-3 py-2 whitespace-nowrap">
        <div className="flex items-center gap-1.5">
          {showTrafficLight && (
            <span
              className="rounded-full shrink-0"
              style={{
                width: 8,
                height: 8,
                background: changed ? "#b45309" : "#16a34a",
                boxShadow: changed ? "0 0 0 3px #fff7ed" : "0 0 0 3px #eafaf0",
              }}
              title={changed ? (person.rosterChangeNote as string) : "No change on this version"}
            />
          )}
          {view !== "assigned" && (
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
        {showTrafficLight && changed && (
          <div className="text-[10px] mt-0.5" style={{ color: "#b45309" }}>{person.rosterChangeNote}</div>
        )}
        {view !== "assigned" && person.availability_date && (
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
      {showAssignCol && (
        // Placed here (right after Name/Nationality) rather than after
        // every document column — see the matching header comment above.
        <RowActions
          crewId={person.crew_id}
          crewMatrixId={crewMatrixId}
          lineId={lineId}
          personName={person.full_name}
          showAssign={showAssignCol}
          showUnassign={showUnassignCol}
          canEditRoster={canEditRoster}
          candidateOptions={candidateOptions}
          reservation={person.reservation}
          onChanged={onChanged}
          onAssigned={onAssigned}
          onUnassigned={onUnassigned}
          onReservationChanged={onReservationChanged}
        />
      )}
      {showLocationColumn && (
        <td className="px-3 py-2 whitespace-nowrap border-l" style={{ borderColor: "var(--ch-line)", color: "var(--ch-ink)" }}>
          {person.current_location ?? "—"}
        </td>
      )}
      {lineDisplayColumns.map((dc, i) => (
        <DocCell
          key={dc.key}
          docType={dc.docType}
          part={dc.part}
          doc={person.documents[dc.docType.id]}
          fieldDefs={customFieldDefinitions.filter((f) => f.applies_to_document_type_id === dc.docType.id || f.applies_to_document_type_id === null)}
          dividerKind={columnDividers[i]}
        />
      ))}
      {showUnassignCol && (
        <RowActions
          crewId={person.crew_id}
          crewMatrixId={crewMatrixId}
          lineId={lineId}
          personName={person.full_name}
          showAssign={showAssignCol}
          showUnassign={showUnassignCol}
          canEditRoster={canEditRoster}
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
  canEditRoster,
  candidateOptions,
  reservation,
  onChanged,
  onAssigned,
  onUnassigned,
  onReservationChanged,
}: {
  crewId: string;
  crewMatrixId: string;
  lineId: string;
  personName: string;
  showAssign: boolean;
  showUnassign: boolean;
  canEditRoster: boolean;
  candidateOptions: { crew_id: string; full_name: string }[];
  // Reserve/soft-lock — only ever passed on the showAssign call site (the
  // Assigned view's Unassign call site has nothing to reserve). undefined
  // there is fine, same as it being null here: "not currently reserved".
  reservation?: ReservationInfo | null;
  onChanged?: () => void;
  onAssigned: (crewId: string, dates?: { assignment_start_date: string; assignment_planned_end_date: string | null }) => void;
  onUnassigned: (crewId: string) => void;
  onReservationChanged?: (crewId: string, reservation: ReservationInfo | null) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [busy, setBusy] = useState<"assign" | "unassign" | "request" | "reserve" | "unreserve" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Reserve/soft-lock — an inline note + expected-ready-date form, same
  // expand-in-place pattern as the roster-change request form below, kept
  // separate from it since it applies in a different place (candidate
  // views only, never the Assigned view's Replace/Unassign form).
  const [reserveOpen, setReserveOpen] = useState(false);
  const [reserveNotes, setReserveNotes] = useState("");
  const [reserveReadyDate, setReserveReadyDate] = useState("");
  // Assign/unassign date inputs default to today but stay editable — AHM
  // calculates on-board day counts and payroll from these dates, so they
  // need to be caller-chosen, not silently stamped to "now". Planned end
  // date is optional (left blank by default) — it's shown on the Assigned
  // tab once set, but nothing requires it.
  const [assignDate, setAssignDate] = useState(today);
  const [plannedEndDate, setPlannedEndDate] = useState("");
  const [unassignDate, setUnassignDate] = useState(today);

  // Phase 17 (revised) — on a new version's draft, the instant assign/
  // unassign forms above are replaced by this form: pick what kind of
  // change (Replace only makes sense from the Assigned side, where
  // there's someone to replace), a mandatory reason, optional notes, and
  // an effective date. Confirming records the change and applies it to
  // this row right away (see doRosterChange below) — no separate approval
  // step per change; make as many of these as needed, then use "Submit
  // for approval" at the top of the page for the whole version. The
  // change is only staged (not written to the real, shared
  // crew_assignments) until this version is Activated — see
  // roster-change-actions.ts.
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestKind, setRequestKind] = useState<"replace" | "unassign_only">("replace");
  const [incomingCrewId, setIncomingCrewId] = useState("");
  const [reasonCode, setReasonCode] = useState("");
  const [reasonNotes, setReasonNotes] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(today);

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

  // Confirm Assign, from an already-reserved row — same insert as the
  // ordinary Assign above, just today-dated with no planned end date
  // (matches the approved mockup, which shows this as a single button
  // with no date inputs to fill in first). assignCandidateToMatrix
  // releases the reservation server-side once the insert succeeds, so
  // there's nothing extra to call here for that half.
  const doConfirmAssign = async () => {
    setError(null);
    setBusy("assign");
    const res = await assignCandidateToMatrix(crewId, crewMatrixId, today, undefined);
    setBusy(null);
    if (res?.error) {
      setError(res.error);
      return;
    }
    onAssigned(crewId, { assignment_start_date: today, assignment_planned_end_date: null });
    onChanged?.();
  };

  const doReserve = async () => {
    setError(null);
    setBusy("reserve");
    const res = await reserveCandidateForLine(crewId, crewMatrixId, lineId, reserveNotes || undefined, reserveReadyDate || undefined);
    setBusy(null);
    if (res?.error) {
      setError(res.error);
      return;
    }
    setReserveOpen(false);
    setReserveNotes("");
    setReserveReadyDate("");
    // Optimistic patch only — we don't get the new reservation row's id
    // back from the server action, and don't need it until Unreserve is
    // clicked, by which point the background refresh (onChanged, below)
    // will have landed with the real row. A non-null placeholder here is
    // enough to flip the row into the "reserved" treatment immediately.
    onReservationChanged?.(crewId, {
      id: "",
      crewMatrixId,
      crewMatrixLineId: lineId,
      notes: reserveNotes || null,
      expectedReadyDate: reserveReadyDate || null,
      reservedByLabel: "you",
      isThisMatrix: true,
      matrixNumber: null,
      matrixTitle: null,
      roleName: null,
    });
    onChanged?.();
  };

  const doUnreserve = async () => {
    if (!reservation?.id) return;
    setError(null);
    setBusy("unreserve");
    const res = await unreserveCandidate(reservation.id, crewMatrixId);
    setBusy(null);
    if (res?.error) {
      setError(res.error);
      return;
    }
    onReservationChanged?.(crewId, null);
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

  const doRosterChange = async () => {
    if (!reasonCode) {
      setError("Please choose a reason.");
      return;
    }
    if (requestKind === "replace" && !incomingCrewId) {
      setError("Pick who's replacing them, or switch to “Unassign only”.");
      return;
    }
    const changeType = showAssign ? "assign" : requestKind === "replace" ? "replace" : "unassign";
    setError(null);
    setBusy("request");
    const res = await requestRosterChange({
      crewMatrixId,
      crewMatrixLineId: lineId,
      changeType,
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
    // Recorded server-side already — move the row(s) over immediately,
    // same as the instant assign/unassign above, rather than waiting on
    // the slower background refresh (onChanged) to land first.
    if (changeType === "unassign" || changeType === "replace") onUnassigned(crewId);
    if (changeType === "assign") onAssigned(crewId, { assignment_start_date: effectiveDate, assignment_planned_end_date: null });
    if (changeType === "replace") {
      const incoming = candidateOptions.find((c) => c.crew_id === incomingCrewId);
      if (incoming) onAssigned(incoming.crew_id, { assignment_start_date: effectiveDate, assignment_planned_end_date: null });
    }
    setRequestOpen(false);
    setReasonCode("");
    setReasonNotes("");
    setIncomingCrewId("");
    onChanged?.();
  };

  const showRequestFlow = canEditRoster && (showAssign || showUnassign);
  // Reserve/soft-lock only applies to the plain instant-assign path
  // (canEditRoster's staged roster-change flow is a separate, later-
  // scoped decision — reserving isn't offered there yet). "Reserved on
  // THIS matrix" replaces the whole action area with the amber
  // badge/note/Confirm-Assign/Unreserve treatment from the approved
  // mockup; "reserved on a different matrix" instead shows a small grey
  // tag ABOVE the normal, still fully working date inputs + Assign +
  // Reserve controls — reserving here just moves the hold over (see
  // reserveCandidateForLine), which is the "override" the mockup called
  // for.
  const showReservedHere = showAssign && !showRequestFlow && !!reservation && reservation.isThisMatrix;

  return (
    <td className="px-3 py-2 border-l" style={{ borderColor: "var(--ch-line)" }}>
      {showReservedHere && reservation ? (
        <div className="flex flex-col gap-1 items-start">
          <span
            className="inline-flex items-center gap-1 rounded-full text-[10px] font-semibold px-2 py-0.5"
            style={{ color: "#92400e", background: "#fef3c7", border: "1px solid #fde68a" }}
          >
            ● Reserved by {reservation.reservedByLabel}
          </span>
          {(reservation.notes || reservation.expectedReadyDate) && (
            <span className="text-[10px]" style={{ color: "#92400e" }}>
              {[reservation.notes, reservation.expectedReadyDate ? `target ${formatDate(reservation.expectedReadyDate)}` : null].filter(Boolean).join(" — ")}
            </span>
          )}
          <div className="flex items-center gap-1.5">
            <button
              onClick={doConfirmAssign}
              disabled={busy !== null}
              className="text-[11px] font-semibold rounded px-2 py-1 border disabled:opacity-50"
              style={{ borderColor: "var(--ch-navy)", color: "var(--ch-navy)" }}
            >
              {busy === "assign" ? "Assigning…" : "Confirm Assign"}
            </button>
            <button
              onClick={doUnreserve}
              disabled={busy !== null || !reservation.id}
              className="text-[11px] rounded px-2 py-1 border disabled:opacity-50"
              style={{ borderColor: "var(--ch-line)", color: "var(--ch-sub)" }}
            >
              {busy === "unreserve" ? "Releasing…" : "Unreserve"}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 flex-wrap">
          {showRequestFlow ? (
            <button
              onClick={() => setRequestOpen((o) => !o)}
              className="text-[11px] font-semibold rounded px-2 py-1 border"
              style={{ borderColor: "var(--ch-line)", color: showAssign ? "var(--ch-navy)" : "#9d174d" }}
            >
              {showAssign ? "Assign" : "Replace"}
            </button>
          ) : (
            <>
              {showAssign && (
                <>
                  {reservation && !reservation.isThisMatrix && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full text-[10px] font-semibold px-2 py-0.5 w-full"
                      style={{ color: "#6b7280", background: "#f1f2f4", border: "1px solid var(--ch-line)" }}
                      title={reservation.expectedReadyDate ? `Expected ready ${formatDate(reservation.expectedReadyDate)}` : undefined}
                    >
                      ● Reserved for {reservation.matrixNumber ?? "another matrix"}{reservation.roleName ? ` — ${reservation.roleName}` : ""}
                    </span>
                  )}
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
                  <button
                    onClick={() => setReserveOpen((o) => !o)}
                    disabled={busy !== null}
                    className="text-[11px] font-semibold rounded px-2 py-1 border disabled:opacity-50"
                    style={{ borderColor: "#fde68a", color: "#92400e" }}
                  >
                    Reserve
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
      )}
      {reserveOpen && (
        <div className="mt-2 p-2.5 rounded-lg border space-y-1.5" style={{ borderColor: "#fde68a", background: "#fffbf0", width: "14rem" }}>
          <div className="text-[10px]" style={{ color: "#92400e" }}>
            Keeps {personName} on this list with a &quot;Reserved&quot; tag — doesn&apos;t assign them yet.
          </div>
          <textarea
            value={reserveNotes}
            onChange={(e) => setReserveNotes(e.target.value)}
            placeholder="Note (optional) — e.g. waiting on Passport"
            rows={2}
            className="text-[11px] rounded px-1.5 py-1 border w-full resize-none"
            style={{ borderColor: "var(--ch-line)", color: "var(--ch-ink)" }}
          />
          <input
            type="date"
            value={reserveReadyDate}
            onChange={(e) => setReserveReadyDate(e.target.value)}
            title="Expected ready date (optional)"
            className="text-[11px] rounded px-1.5 py-1 border w-full"
            style={{ borderColor: "var(--ch-line)", color: "var(--ch-ink)" }}
          />
          <div className="flex items-center gap-1.5">
            <button
              onClick={doReserve}
              disabled={busy !== null}
              className="text-[11px] font-semibold rounded px-2 py-1 border disabled:opacity-50"
              style={{ borderColor: "#fde68a", color: "#92400e" }}
            >
              {busy === "reserve" ? "Reserving…" : "Confirm Reserve"}
            </button>
            <button
              onClick={() => setReserveOpen(false)}
              disabled={busy !== null}
              className="text-[11px] rounded px-2 py-1"
              style={{ color: "var(--ch-sub)" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {requestOpen && (
        <div className="mt-2 p-2.5 rounded-lg border space-y-1.5" style={{ borderColor: "var(--ch-line)", background: "var(--ch-paper)", width: "15rem" }}>
          <div className="text-[10px]" style={{ color: "var(--ch-sub)" }}>
            Recorded on this version now. Use <strong>Submit for approval</strong> at the top once all your changes are done.
          </div>
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
              onClick={doRosterChange}
              disabled={busy !== null}
              className="text-[11px] font-semibold rounded px-2 py-1 border disabled:opacity-50"
              style={{ borderColor: "var(--ch-navy)", color: "var(--ch-navy)" }}
            >
              {busy === "request" ? "Saving…" : requestKind === "unassign_only" || showAssign ? "Confirm" : "Replace"}
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
  dividerKind: kind = "none",
}: {
  docType: DocTypeRef;
  doc: StaffingCrew["documents"][string] | undefined;
  fieldDefs: FieldDef[];
  part?: DisplayColumnPart;
  // See dividerKind()/dividerStyle() above — carries the same thin
  // (document-type start) / heavy (category start) rule down from the
  // header into the data rows, so the columns don't run together.
  dividerKind?: DividerKind;
}) {
  // Every column reaching this component is already required for the rank
  // it's rendered under (see lineDisplayColumns) — required is always true
  // here. `part` picks which half of a split travel-document column this
  // cell renders; "single" (the default) is every other document type,
  // completely unchanged from before the split existed.
  const info = cellInfoPart(true, docType, doc, fieldDefs, part);
  const tdStyle = dividerStyle(kind);

  if (info.kind === "missing") {
    const colors = DOCUMENT_STATUS_COLORS.expired;
    return (
      <td className="px-3 py-2 whitespace-nowrap" style={tdStyle}>
        <span className="rounded px-1.5 py-0.5 font-semibold" style={{ background: colors.bg, color: colors.fg }}>
          Missing
        </span>
      </td>
    );
  }

  if (info.kind === "empty") {
    const colors = DOCUMENT_STATUS_COLORS.none;
    return (
      <td className="px-3 py-2 whitespace-nowrap" style={tdStyle}>
        <span className="rounded px-1.5 py-0.5" style={{ background: colors.bg, color: colors.fg }}>
          {info.text}
        </span>
      </td>
    );
  }

  const colors = info.status ? DOCUMENT_STATUS_COLORS[info.status] : null;
  return (
    <td className="px-3 py-2 whitespace-nowrap" style={tdStyle}>
      <span className={colors ? "rounded px-1.5 py-0.5" : ""} style={colors ? { background: colors.bg, color: colors.fg } : { color: "var(--ch-ink)" }}>
        {info.text}
      </span>
    </td>
  );
}
