-- ============================================================
-- ComplianceHub — Document upload checks: file-hash duplicate
-- detection + faster document-number cross-checks
--
-- Depends on Phase 13 (0014_crew_document_versions.sql). Run this whole
-- file once, top to bottom, in the Supabase SQL Editor. Safe to re-run.
--
-- file_hash is a SHA-256 of the uploaded bytes, computed server-side in
-- every upload path (see lib/documents/checks.ts) before the row is
-- inserted. Existing rows are left null — they were never hashed at
-- upload time, so there's nothing to backfill; the duplicate-file check
-- simply has nothing to match against for those until they're re-
-- uploaded or a new version is added.
-- ============================================================

begin;

alter table crew_document_versions add column if not exists file_hash text;

-- Duplicate-file check: same org + crew + hash, most recent first.
create index if not exists crew_document_versions_hash_idx
  on crew_document_versions(org_id, crew_id, file_hash);

-- Duplicate-document-number check: candidate rows are fetched by
-- org + document_type_id + is_active, then compared case-insensitively
-- in application code (see checkDuplicateDocumentNumber) rather than
-- with a SQL ilike, so this index just needs to make that fetch fast.
create index if not exists crew_documents_type_active_idx
  on crew_documents(org_id, document_type_id, is_active);

commit;
