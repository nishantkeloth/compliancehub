-- ============================================================
-- ComplianceHub — Staffing Plan date fields (Phase 13, confirmed with
-- Ezhil Victor, AHM Marine ops — see
-- claude/phase13-ahm-walkthrough-call-clarifications.md section 2)
--
-- Two independent additions:
--
-- 1. roster_change_requests.incoming_effective_date — the direct-write
--    assign/unassign path (staffing-actions.ts) already captures
--    separate assign/unassign dates. The staged roster-change path (used
--    while composing a NEW VERSION of a matrix) only had one
--    effective_date, reused as BOTH the outgoing person's unassign date
--    and the incoming person's assign date on a Replace — meaning a
--    Replace could never represent a gap between someone signing off and
--    their reliever actually boarding, which is exactly the kind of date
--    AHM calculates payroll and on-board day counts from. This column
--    stays null for a plain assign or unassign (effective_date alone
--    already covers those); only a Replace sets both.
--
-- 2. boarding_confirmations.country_arrival_at — distinct from the
--    existing actual_arrival_at (which, read alongside
--    actual_departure_at/actual_onboard_at, is "arrived at the
--    vessel/transfer point" — one leg of the vessel-boarding sequence,
--    not arrival in the country at all). AHM pays a crew member from the
--    day they land in-country, not the day they board — there can be a
--    gap of a few days for medical checks/courses/documentation on land
--    first. Nothing in the schema captured that date anywhere. This is
--    captured alongside the existing boarding fields but is NOT wired
--    into the crew-cost/billing day-count engine (lib/ops.ts, which
--    still derives cost from crew_assignments.start_date/end_date) —
--    that's a separate decision with real payroll-calculation impact,
--    called out but deliberately not made here.
--
-- Run this whole file once, top to bottom, in the Supabase SQL Editor.
-- Safe to re-run.
-- ============================================================

begin;

alter table roster_change_requests add column if not exists incoming_effective_date date;

alter table boarding_confirmations add column if not exists country_arrival_at timestamptz;

commit;
