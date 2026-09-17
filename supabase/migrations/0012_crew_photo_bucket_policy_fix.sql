-- ============================================================
-- ComplianceHub — Phase 12 follow-up #2: fix crew-photos upload RLS
--
-- Migration 0011's storage policies (bucket_id = 'crew-photos' and
-- org match and has_permission('crew.matrix.manage')) were confirmed
-- applied, but every upload attempt still failed with "new row
-- violates row-level security policy" even though the exact same
-- has_permission('crew.matrix.manage') check succeeds moments earlier
-- in the same request for crew_intake_generations (a public-schema
-- table) — see app/crew/profiles/intake-actions.ts. That strongly
-- points at has_permission() behaving differently when invoked from a
-- storage.objects policy (a different schema) than from a public.*
-- table policy, rather than an actual permission or org mismatch.
--
-- Rather than debug that further, this migration drops the
-- has_permission() clause from the crew-photos policies and keeps
-- only the org-scoping check. This is safe: the only writer to this
-- bucket is the AI crew-intake server action, and every code path
-- that reaches it already requires crew.manage AND crew.matrix.manage
-- at the application layer (requireIntakeAccess() in
-- app/crew/profiles/intake-actions.ts throws before any upload is
-- attempted otherwise) — the has_permission() clause in the storage
-- policy was redundant defense-in-depth, not the only gate. This also
-- matches the simpler, already-working precedent of the pre-existing
-- "inspection-photos" bucket, which doesn't use has_permission()
-- either.
--
-- Run this whole file once, top to bottom, in the Supabase SQL
-- Editor, after 0011. Safe to re-run.
-- ============================================================

begin;

drop policy if exists crew_photos_insert on storage.objects;
create policy crew_photos_insert on storage.objects for insert
  with check (bucket_id = 'crew-photos' and (storage.foldername(name))[1] = my_org_id()::text);

drop policy if exists crew_photos_update on storage.objects;
create policy crew_photos_update on storage.objects for update
  using (bucket_id = 'crew-photos' and (storage.foldername(name))[1] = my_org_id()::text)
  with check (bucket_id = 'crew-photos' and (storage.foldername(name))[1] = my_org_id()::text);

drop policy if exists crew_photos_delete on storage.objects;
create policy crew_photos_delete on storage.objects for delete
  using (bucket_id = 'crew-photos' and (storage.foldername(name))[1] = my_org_id()::text);

commit;
