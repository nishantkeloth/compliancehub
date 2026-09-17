-- ============================================================
-- ComplianceHub — Phase 13: crew document file uploads + versioning
--
-- Depends on Phase 4 (my_org_id(), has_permission()) and the existing
-- crew_documents table (org_id, crew_id, document_type_id,
-- document_number, issue_date, expiry_date, ...). Run this whole file
-- once, top to bottom, in the Supabase SQL Editor. Safe to re-run.
--
-- Today crew_documents is data only — a document number and an expiry
-- date, with no file behind it. This adds the file itself, and keeps
-- every file ever uploaded rather than overwriting: crew_document_versions
-- is insert-only (no update/delete policy, matching the
-- boarding_confirmations / signoff_confirmations / readiness_snapshots
-- precedent from Phases 4 and 6 — these are facts, not editable state).
-- "Current version" is deliberately NOT a stored flag; it's whichever
-- version has the highest version_number for that document. That keeps
-- the table fully append-only with no UPDATE policy needed at all, and
-- avoids the class of race/partial-index complexity a stored
-- is_current boolean would introduce.
--
-- crew_documents gains is_active: once a document has real files and
-- version history behind it, "Remove" in the UI becomes a deactivate
-- (is_active = false) rather than a delete, so the audit trail behind
-- it is never destroyed. Existing rows default to active.
--
-- Storage: a PRIVATE bucket (crew-documents) — unlike crew-photos,
-- these are passports/medical certificates/visas, not a face crop for
-- an <img> tag, so reads go through signed URLs, not a public path.
-- The storage.objects RLS policies use the same inline org-folder
-- subquery as 0013 (crew-photos), not my_org_id() — both my_org_id()
-- and has_permission() are SECURITY DEFINER functions confirmed to
-- misbehave specifically inside storage.objects policies (see 0013's
-- notes); the actual "who can upload" check is enforced in the server
-- action (requireDocumentsManage(), same as every other write to
-- crew_documents), with the storage policy only responsible for
-- keeping one org's files out of another org's folder.
-- ============================================================

begin;

alter table crew_documents add column if not exists is_active boolean not null default true;

create table if not exists crew_document_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  crew_document_id uuid not null references crew_documents(id) on delete cascade,
  crew_id uuid not null references crew_profiles(id),
  version_number integer not null,
  file_path text not null,
  file_name text,
  content_type text,
  file_size_bytes bigint,
  document_number text,
  issue_date date,
  expiry_date date,
  source text not null default 'manual' check (source in ('manual', 'ai_upload', 'ai_intake', 'self_upload')),
  ai_confidence numeric,
  notes text,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists crew_document_versions_document_idx on crew_document_versions(crew_document_id, version_number desc);
create index if not exists crew_document_versions_crew_idx on crew_document_versions(crew_id);
create index if not exists crew_document_versions_org_idx on crew_document_versions(org_id);

alter table crew_document_versions enable row level security;

drop policy if exists crew_document_versions_select on crew_document_versions;
create policy crew_document_versions_select on crew_document_versions for select
  using ((org_id = my_org_id() and (has_permission('crew.documents.view') or has_permission('crew.documents.manage'))) or is_platform_admin());

drop policy if exists crew_document_versions_insert on crew_document_versions;
create policy crew_document_versions_insert on crew_document_versions for insert
  with check (org_id = my_org_id() and has_permission('crew.documents.manage'));
-- Insert-only: a version is a fact about what was uploaded and when.
-- No update/delete policy — a correction is a new version, never an edit.

insert into storage.buckets (id, name, public)
values ('crew-documents', 'crew-documents', false)
on conflict (id) do nothing;

drop policy if exists crew_documents_files_select on storage.objects;
create policy crew_documents_files_select on storage.objects for select
  using (
    bucket_id = 'crew-documents'
    and (storage.foldername(name))[1] = (
      select profiles.org_id::text from profiles where profiles.id = auth.uid()
    )
  );

drop policy if exists crew_documents_files_insert on storage.objects;
create policy crew_documents_files_insert on storage.objects for insert
  with check (
    bucket_id = 'crew-documents'
    and (storage.foldername(name))[1] = (
      select profiles.org_id::text from profiles where profiles.id = auth.uid()
    )
  );
-- No update/delete storage policy either, for the same append-only reason.

commit;
