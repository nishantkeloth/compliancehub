-- ============================================================
-- ComplianceHub — Send-time document verification for "Send Matrix to Client"
--
-- Depends on 0014 (crew_document_versions) and 0018 (matrix sharing).
-- Run this whole file once, top to bottom, in the Supabase SQL Editor.
-- Safe to re-run.
--
-- crew_document_verification_reads caches what the AI read off one stored
-- document file (holder name, number, dates, document type). A document
-- version is append-only, so one version id is one set of bytes: the cache
-- is keyed by version and never goes stale. Comparing that reading with the
-- crew record is cheap and is re-done every time, so fixing a record and
-- re-checking costs no AI call.
--
-- crew_matrix_share_packages gains the verification summary that was true
-- at the moment of sending, so Sharing History can show what was checked.
-- ============================================================

begin;

create table if not exists crew_document_verification_reads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  crew_document_version_id uuid not null references crew_document_versions(id) on delete cascade,
  crew_id uuid not null references crew_profiles(id),
  file_hash text,
  read_ok boolean not null default true,
  read_json jsonb,
  read_error text,
  model_label text,
  read_by uuid references auth.users(id),
  read_at timestamptz not null default now(),
  unique (crew_document_version_id)
);
create index if not exists crew_document_verification_reads_org_idx on crew_document_verification_reads(org_id);

alter table crew_document_verification_reads enable row level security;

drop policy if exists crew_document_verification_reads_select on crew_document_verification_reads;
create policy crew_document_verification_reads_select on crew_document_verification_reads for select
  using (org_id = my_org_id() and has_permission('crew.matrix.share'));

drop policy if exists crew_document_verification_reads_insert on crew_document_verification_reads;
create policy crew_document_verification_reads_insert on crew_document_verification_reads for insert
  with check (org_id = my_org_id() and has_permission('crew.matrix.share'));

-- A re-read of the same version (after a failed or unreadable first try)
-- replaces the cached row.
drop policy if exists crew_document_verification_reads_update on crew_document_verification_reads;
create policy crew_document_verification_reads_update on crew_document_verification_reads for update
  using (org_id = my_org_id() and has_permission('crew.matrix.share'))
  with check (org_id = my_org_id() and has_permission('crew.matrix.share'));

alter table crew_matrix_share_packages add column if not exists verification_json jsonb;
alter table crew_matrix_share_packages add column if not exists verification_policy text
  check (verification_policy in ('auto_exclude', 'require_decision'));
alter table crew_matrix_share_packages add column if not exists verified_at timestamptz;

commit;
