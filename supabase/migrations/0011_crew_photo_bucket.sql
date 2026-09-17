-- ============================================================
-- ComplianceHub — Phase 12 follow-up: crew profile photo storage
--
-- Depends on Phase 9 (has_permission(), my_org_id()) and Phase 2
-- (crew_profiles.photo_url, already present). Run this whole file once,
-- top to bottom, in the Supabase SQL Editor. Safe to re-run.
--
-- Adds a PUBLIC storage bucket for crew profile photos — public because
-- crew_profiles.photo_url is a plain URL rendered in <img> tags with no
-- signed-URL plumbing, matching the existing (unmigrated) precedent of
-- the "inspection-photos" bucket. Public means reads bypass RLS entirely
-- (served from a public path); writes still go through the authenticated
-- API and are RLS-gated below, scoped to crew.matrix.manage since the
-- only writer today is the AI crew-intake auto-crop step (see
-- lib/ai/crew-intake-schema.ts, app/crew/profiles/intake-actions.ts).
-- ============================================================

begin;

insert into storage.buckets (id, name, public)
values ('crew-photos', 'crew-photos', true)
on conflict (id) do nothing;

drop policy if exists crew_photos_insert on storage.objects;
create policy crew_photos_insert on storage.objects for insert
  with check (bucket_id = 'crew-photos' and (storage.foldername(name))[1] = my_org_id()::text and has_permission('crew.matrix.manage'));

drop policy if exists crew_photos_update on storage.objects;
create policy crew_photos_update on storage.objects for update
  using (bucket_id = 'crew-photos' and (storage.foldername(name))[1] = my_org_id()::text and has_permission('crew.matrix.manage'))
  with check (bucket_id = 'crew-photos' and (storage.foldername(name))[1] = my_org_id()::text and has_permission('crew.matrix.manage'));

drop policy if exists crew_photos_delete on storage.objects;
create policy crew_photos_delete on storage.objects for delete
  using (bucket_id = 'crew-photos' and (storage.foldername(name))[1] = my_org_id()::text and has_permission('crew.matrix.manage'));

commit;
