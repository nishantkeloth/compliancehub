-- ============================================================
-- ComplianceHub — Phase 12 follow-up #3: stop calling my_org_id()
-- from the crew-photos storage policies
--
-- Every layer has now been checked directly against the database and
-- is correct: the crew-photos bucket exists (public=true), the
-- crew_photos_insert/update/delete policies (after 0012) only check
-- bucket_id and an org-folder match, my_org_id() is a plain
-- `select org_id from profiles where id = auth.uid()`, the org id in
-- the upload path matches profiles.org_id for the signed-in user, and
-- a decoded session token captured at the exact moment of the failing
-- call shows role=authenticated with the correct sub and a JWT that
-- isn't expired. Despite all of that, the insert is still rejected
-- with "new row violates row-level security policy".
--
-- The one remaining difference from the bucket that's confirmed
-- working today -- inspection-photos -- is that its policies use an
-- inline subquery against profiles, never a function call:
--
--   (storage.foldername(name))[1] = (
--     select profiles.org_id::text from profiles where profiles.id = auth.uid()
--   )
--
-- Both my_org_id() and has_permission() (see 0012) are
-- SECURITY DEFINER functions, and both have now been seen to fail
-- specifically when invoked from a storage.objects policy while
-- working correctly from a public-schema table policy in the same
-- request. This migration drops the my_org_id() call from the
-- crew-photos policies and replaces it with the same inline subquery
-- inspection-photos already uses successfully -- removing the last
-- SECURITY DEFINER function call from this bucket's RLS entirely.
--
-- Run this whole file once, top to bottom, in the Supabase SQL
-- Editor, after 0012. Safe to re-run.
-- ============================================================

begin;

drop policy if exists crew_photos_insert on storage.objects;
create policy crew_photos_insert on storage.objects for insert
  with check (
    bucket_id = 'crew-photos'
    and (storage.foldername(name))[1] = (
      select profiles.org_id::text from profiles where profiles.id = auth.uid()
    )
  );

drop policy if exists crew_photos_update on storage.objects;
create policy crew_photos_update on storage.objects for update
  using (
    bucket_id = 'crew-photos'
    and (storage.foldername(name))[1] = (
      select profiles.org_id::text from profiles where profiles.id = auth.uid()
    )
  )
  with check (
    bucket_id = 'crew-photos'
    and (storage.foldername(name))[1] = (
      select profiles.org_id::text from profiles where profiles.id = auth.uid()
    )
  );

drop policy if exists crew_photos_delete on storage.objects;
create policy crew_photos_delete on storage.objects for delete
  using (
    bucket_id = 'crew-photos'
    and (storage.foldername(name))[1] = (
      select profiles.org_id::text from profiles where profiles.id = auth.uid()
    )
  );

commit;
