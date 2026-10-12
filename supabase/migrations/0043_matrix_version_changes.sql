
-- ============================================================
-- ComplianceHub — Version-to-version change tracking for crew matrices
--
-- Depends on 0002 (crew_matrices) and 0039 (version uniqueness).
-- Run this whole file once, top to bottom, in the Supabase SQL Editor.
-- Safe to re-run.
--
-- The comparison itself is computed from the existing matrix tables (every
-- old version already holds its full lines), so nothing needs backfilling.
-- These four columns record the human side of a version:
--   version_reason            why this version was created
--   compared_to_matrix_id     the version it was created from
--   change_summary_json       the list of changes, frozen when the version
--                             is submitted for approval (and refreshed on
--                             activation) so it cannot drift later
--   change_summary_frozen_at  when that was frozen
-- ============================================================

begin;

alter table crew_matrices add column if not exists version_reason text;
alter table crew_matrices add column if not exists compared_to_matrix_id uuid references crew_matrices(id) on delete set null;
alter table crew_matrices add column if not exists change_summary_json jsonb;
alter table crew_matrices add column if not exists change_summary_frozen_at timestamptz;

commit;
