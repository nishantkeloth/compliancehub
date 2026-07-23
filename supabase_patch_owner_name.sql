-- ============================================================
-- ComplianceHub — Phase 3 patch
-- Adds a free-text owner_name column so the MVP's "Owner" field
-- on Corrective Actions actually saves, without requiring a
-- full user-picker yet (that comes when you invite real
-- inspectors/owners as accounts).
-- Run in Supabase SQL Editor.
-- ============================================================

alter table corrective_actions
  add column if not exists owner_name text;
