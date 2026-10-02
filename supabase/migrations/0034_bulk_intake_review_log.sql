-- ============================================================
-- ComplianceHub — Phase 16b: audit log for Bulk Document Intake's
-- review step
--
-- Adds bulk_intake_review_log: one row per file the AI classified
-- during a Bulk Document Intake run, recording what the AI originally
-- proposed (document type guess, "not applicable" or not, number,
-- dates, confidence) alongside what the human reviewer actually
-- decided (included or excluded, and the final type/number/dates they
-- confirmed) — for every file, not just the ones that ended up
-- attached. Written once per folder from logBulkIntakeReview() in
-- app/team/bulk-intake/document-intake-actions.ts, right after that
-- folder's commit batches finish.
--
-- This is deliberately separate from crew_document_versions (which
-- already records every attached file with source: 'ai_upload' and an
-- ai_confidence column). That table only has a row for what got
-- attached; this table also has a row for what the AI proposed and a
-- reviewer excluded — e.g. a payroll slip the AI correctly flagged as
-- "not a compliance document," or one a reviewer corrected before
-- confirming — so a later question like "why isn't this crew member's
-- old Medical Certificate on file" or "did anyone review that batch of
-- remittance slips that got uploaded by mistake" has an answer beyond
-- the final state.
--
-- Gated the same way as the rest of Bulk Document Intake —
-- crew.bulk_intake.manage — since this log is itself part of that
-- admin-only tool, not a general crew-document-viewing surface.
--
-- Run this whole file once, top to bottom, in the Supabase SQL
-- Editor. Safe to re-run (every step guards itself).
-- ============================================================

begin;

create table if not exists bulk_intake_review_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  crew_id uuid not null references crew_profiles(id) on delete cascade,
  -- The crew-member folder name as selected on disk, not a FK — purely
  -- descriptive, so a batch's rows can be grouped back together even
  -- after folder/crew matching is long settled.
  folder_name text not null,
  filename text not null,

  -- What the AI proposed for this file.
  ai_document_type_name text,
  ai_not_applicable boolean not null default false,
  ai_document_number text,
  ai_issue_date date,
  ai_expiry_date date,
  ai_confidence numeric,

  -- What the reviewer actually did with it.
  included boolean not null,
  final_document_type_id uuid references document_types(id) on delete set null,
  final_new_document_type_name text,
  final_document_number text,
  final_issue_date date,
  final_expiry_date date,

  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists bulk_intake_review_log_org_id_idx on bulk_intake_review_log(org_id);
create index if not exists bulk_intake_review_log_crew_id_idx on bulk_intake_review_log(crew_id);
create index if not exists bulk_intake_review_log_reviewed_at_idx on bulk_intake_review_log(org_id, reviewed_at desc);

alter table bulk_intake_review_log enable row level security;
drop policy if exists bulk_intake_review_log_select on bulk_intake_review_log;
drop policy if exists bulk_intake_review_log_insert on bulk_intake_review_log;
create policy bulk_intake_review_log_select on bulk_intake_review_log for select
  using ((org_id = my_org_id() and has_permission('crew.bulk_intake.manage')) or is_platform_admin());
create policy bulk_intake_review_log_insert on bulk_intake_review_log for insert
  with check (org_id = my_org_id() and has_permission('crew.bulk_intake.manage'));
-- No update/delete policy — this is an append-only audit log, same
-- reasoning as crew_document_versions: a correction is a new row, not
-- an edit to history.

commit;
