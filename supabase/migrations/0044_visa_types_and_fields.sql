
-- ============================================================
-- ComplianceHub — Visa tracking, step 1: visa types and visa fields
--
-- Depends on 0004 (my_org_id(), has_permission()) and the existing
-- document_types / crew_documents tables. Run this whole file once, top to
-- bottom, in the Supabase SQL Editor. Safe to re-run.
--
-- A visa stays a document on the crew member (so uploads, versions, the
-- readiness check and the expiry digest keep working). This adds:
--   visa_types      the visa types you deal with, per country, with the
--                   rules that drive dates: how long after issue the person
--                   must enter, how long they may stay, single or multiple
--                   entry, and the reminder steps.
--   crew_documents  four optional visa fields: country, visa type,
--                   application date and visa status.
--
-- The rule values seeded below are STARTING POINTS to confirm with your PRO
-- (rows marked "rules to be confirmed" have no dates logic until filled in).
-- Edit them under Crew Setup -> Visa Types.
-- ============================================================

begin;

create table if not exists visa_types (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  country text not null,
  name text not null,
  -- Matches the four visa choices on a mobilization position, so the two
  -- can be linked: mission / resident / seaman / visit. Optional.
  mobilization_code text check (mobilization_code in ('mission', 'resident', 'seaman', 'visit')),
  -- The person must enter the country within N days of the issue date.
  entry_valid_days integer check (entry_valid_days is null or entry_valid_days > 0),
  -- 'days_from_entry': may stay stay_days after entering.
  -- 'until_expiry':    may stay until the visa expiry date.
  stay_basis text not null default 'until_expiry' check (stay_basis in ('until_expiry', 'days_from_entry')),
  stay_days integer check (stay_days is null or stay_days > 0),
  entry_type text check (entry_type in ('single', 'multiple')),
  -- Days before the visa expiry date at which a reminder is raised.
  expiry_reminder_days integer[] not null default '{}',
  -- Days before the entry deadline at which a reminder is raised (visa
  -- issued but not yet used).
  entry_reminder_days integer[] not null default '{}',
  notes text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, country, name),
  check (stay_basis <> 'days_from_entry' or stay_days is not null)
);
create index if not exists visa_types_org_idx on visa_types(org_id, country);

alter table visa_types enable row level security;

drop policy if exists visa_types_select on visa_types;
create policy visa_types_select on visa_types for select
  using ((org_id = my_org_id() and (has_permission('crew.view') or has_permission('crew.manage')
          or has_permission('crew.documents.view') or has_permission('crew.documents.manage'))) or is_platform_admin());

drop policy if exists visa_types_insert on visa_types;
create policy visa_types_insert on visa_types for insert
  with check (org_id = my_org_id() and has_permission('crew.manage'));

drop policy if exists visa_types_update on visa_types;
create policy visa_types_update on visa_types for update
  using (org_id = my_org_id() and has_permission('crew.manage'))
  with check (org_id = my_org_id() and has_permission('crew.manage'));

drop policy if exists visa_types_delete on visa_types;
create policy visa_types_delete on visa_types for delete
  using (org_id = my_org_id() and has_permission('crew.manage'));

-- The visa fields on a crew document. All optional, and only shown on the
-- form for documents whose type is in the Visa category.
alter table crew_documents add column if not exists visa_country text;
alter table crew_documents add column if not exists visa_type_id uuid references visa_types(id) on delete set null;
alter table crew_documents add column if not exists visa_application_date date;
alter table crew_documents add column if not exists visa_status text
  check (visa_status is null or visa_status in ('applied', 'approved', 'awaiting_entry', 'entered', 'cancelled'));
create index if not exists crew_documents_visa_type_idx on crew_documents(visa_type_id) where visa_type_id is not null;

-- Starter set for every company that has none yet (a re-run adds nothing).
insert into visa_types (org_id, country, name, mobilization_code, entry_valid_days, stay_basis, stay_days, entry_type,
                        expiry_reminder_days, entry_reminder_days, notes, sort_order)
select c.id, v.country, v.name, v.code, v.entry_valid_days, v.stay_basis, v.stay_days, v.entry_type,
       v.expiry_reminder_days, v.entry_reminder_days, v.notes, v.sort_order
from companies c
cross join (values
  ('United Arab Emirates', 'Mission visa',  'mission',  60,   'days_from_entry', 60,   'single',   '{30,14,7}'::int[],        '{14,7,3}'::int[], 'Starting values — confirm with your PRO.', 10),
  ('United Arab Emirates', 'Resident visa', 'resident', null::int, 'until_expiry', null::int, 'multiple', '{90,60,30,14,7}'::int[], '{}'::int[],      'Starting values — confirm with your PRO.', 20),
  ('United Arab Emirates', 'Seaman visa',   'seaman',   null::int, 'until_expiry', null::int, null,       '{30,14,7}'::int[],        '{}'::int[],      'Rules to be confirmed — no entry or stay dates are calculated until filled in.', 30),
  ('United Arab Emirates', 'Visit visa',    'visit',    null::int, 'until_expiry', null::int, null,       '{30,14,7}'::int[],        '{}'::int[],      'Rules to be confirmed — no entry or stay dates are calculated until filled in.', 40),
  ('Saudi Arabia',         'Work visa',     null,       null::int, 'until_expiry', null::int, 'multiple', '{75,45,30,14,7}'::int[],  '{}'::int[],      'Starting values — confirm with your PRO.', 50)
) as v(country, name, code, entry_valid_days, stay_basis, stay_days, entry_type, expiry_reminder_days, entry_reminder_days, notes, sort_order)
where not exists (select 1 from visa_types t where t.org_id = c.id);

commit;
