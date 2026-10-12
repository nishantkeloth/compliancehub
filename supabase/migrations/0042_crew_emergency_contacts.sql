
-- ============================================================
-- ComplianceHub — Emergency contacts / next of kin for the crew register
--
-- Depends on 0002 (crew_profiles) and 0004 (my_org_id(), has_permission()).
-- Run this whole file once, top to bottom, in the Supabase SQL Editor.
-- Safe to re-run.
--
-- Until now a crew member had one emergency contact name and one phone
-- number, stored directly on crew_profiles. This adds a proper list: up to
-- three contacts per person, each with relationship, phone, email and
-- address, one of them marked primary.
--
-- crew_profiles.emergency_contact_name / emergency_contact_phone are kept
-- and are always set from the primary contact, so every screen, report and
-- import that still reads those two columns keeps working.
-- Existing single contacts are copied across below.
-- ============================================================

begin;

create table if not exists crew_emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  crew_id uuid not null references crew_profiles(id) on delete cascade,
  full_name text not null,
  relationship text,
  phone text,
  email text,
  address text,
  is_primary boolean not null default false,
  sort_order integer not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crew_emergency_contacts_crew_idx on crew_emergency_contacts(crew_id, sort_order);
create index if not exists crew_emergency_contacts_org_idx on crew_emergency_contacts(org_id);

-- At most one primary contact per person.
create unique index if not exists crew_emergency_contacts_one_primary
  on crew_emergency_contacts(crew_id) where is_primary;

-- At most three contacts per person (also enforced in the app; this is the
-- backstop).
create or replace function crew_emergency_contacts_limit() returns trigger
language plpgsql as $$
begin
  if (select count(*) from crew_emergency_contacts where crew_id = new.crew_id) >= 3 then
    raise exception 'A crew member can have at most 3 emergency contacts.';
  end if;
  return new;
end;
$$;
drop trigger if exists crew_emergency_contacts_limit_trg on crew_emergency_contacts;
create trigger crew_emergency_contacts_limit_trg
  before insert on crew_emergency_contacts
  for each row execute function crew_emergency_contacts_limit();

alter table crew_emergency_contacts enable row level security;

drop policy if exists crew_emergency_contacts_select on crew_emergency_contacts;
create policy crew_emergency_contacts_select on crew_emergency_contacts for select
  using ((org_id = my_org_id() and (has_permission('crew.view') or has_permission('crew.manage'))) or is_platform_admin());

drop policy if exists crew_emergency_contacts_insert on crew_emergency_contacts;
create policy crew_emergency_contacts_insert on crew_emergency_contacts for insert
  with check (org_id = my_org_id() and has_permission('crew.manage'));

drop policy if exists crew_emergency_contacts_update on crew_emergency_contacts;
create policy crew_emergency_contacts_update on crew_emergency_contacts for update
  using (org_id = my_org_id() and has_permission('crew.manage'))
  with check (org_id = my_org_id() and has_permission('crew.manage'));

drop policy if exists crew_emergency_contacts_delete on crew_emergency_contacts;
create policy crew_emergency_contacts_delete on crew_emergency_contacts for delete
  using (org_id = my_org_id() and has_permission('crew.manage'));

-- Copy each existing single contact across as that person's primary contact
-- (only for people who have none yet, so a re-run changes nothing).
insert into crew_emergency_contacts (org_id, crew_id, full_name, phone, is_primary, sort_order)
select p.org_id, p.id,
       coalesce(nullif(btrim(p.emergency_contact_name), ''), 'Emergency contact'),
       nullif(btrim(p.emergency_contact_phone), ''),
       true, 0
from crew_profiles p
where (nullif(btrim(p.emergency_contact_name), '') is not null
       or nullif(btrim(p.emergency_contact_phone), '') is not null)
  and not exists (select 1 from crew_emergency_contacts c where c.crew_id = p.id);

commit;
