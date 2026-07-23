-- ============================================================
-- ComplianceHub — Auth setup
-- Run in Supabase SQL Editor AFTER schema + RLS addendum.
--
-- 1) REPLACE 'PASTE-YOUR-ORG-UUID-HERE' below with the UUID
--    returned when you inserted the 'AHM Marine' organization.
-- 2) Run the whole file.
--
-- Effect: every new signup automatically gets a row in
-- public.profiles linked to your organization.
-- New users default to role 'admin' for now (you are the first
-- user). Change the default to 'inspector' before inviting others.
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, org_id, full_name, role)
  values (
    new.id,
    'PASTE-YOUR-ORG-UUID-HERE',
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    'admin'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Verify: after you sign up in the app, run
--   select * from profiles;
-- and you should see your row.
