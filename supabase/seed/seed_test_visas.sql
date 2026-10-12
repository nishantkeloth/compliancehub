-- ============================================================
-- ComplianceHub - TEST visa records for every crew member (AHM Marine)
--
-- Run AFTER 0044 (visa types) and 0045 (visa change log).
-- Run this whole file once, top to bottom, in the Supabase SQL Editor.
-- Safe to re-run: it first removes the test visas it created before
-- (they are all marked "TEST DATA - visa seed" in the Notes field) and
-- creates them again with dates relative to today.
--
-- Every crew member gets one current visa in Saudi Arabia, Qatar or the
-- UAE (spread evenly). The mix, per 20 people:
--    8  valid          (entered, 100+ days left)
--    4  expiring soon  (2 to 59 days left)
--    3  expired        (5 to 384 days ago)
--    1  awaiting entry (visa issued, not yet used; some close to the deadline)
--    1  entry deadline passed (issued, never used)
--    1  permitted stay ended (visit/mission visa)
--    1  stay still running (visit/mission visa)
--    1  applied (no dates yet) or cancelled
-- Plus an older, finished visa for about every 3rd person and an older
-- expired one for about every 7th, so the "Expired & past" tab has rows.
--
-- To remove all of it again, run remove_test_visas.sql.
-- ============================================================

-- Pre-flight check: run this SELECT by itself first. It must show one
-- company and at least one user, or the inserts below affect 0 rows.
select
  (select id from companies where name ilike '%AHM%' limit 1) as resolved_org_id,
  (select count(*) from companies where name ilike '%AHM%') as matching_companies,
  (select count(*) from crew_profiles where org_id = (select id from companies where name ilike '%AHM%' limit 1)) as crew_in_company;

begin;

create temp table _seed_ctx on commit drop as
select
  (select id from companies where name ilike '%AHM%' limit 1) as org_id,
  (select id from profiles
    where org_id = (select id from companies where name ilike '%AHM%' limit 1) and status = 'active'
    order by full_name limit 1) as user_id,
  null::uuid as visa_doc_type_id;

-- 1. Remove test visas from an earlier run.
delete from crew_documents
where org_id = (select org_id from _seed_ctx) and notes like 'TEST DATA - visa seed%';

-- 2. Make sure there is a document type in the Visa category.
do $$
declare v_org uuid := (select org_id from _seed_ctx);
begin
  if not exists (select 1 from document_types where org_id = v_org and category = 'visa' and is_active) then
    if exists (select 1 from document_types where org_id = v_org and is_active and name ilike '%visa%') then
      update document_types set category = 'visa'
      where id = (select id from document_types where org_id = v_org and is_active and name ilike '%visa%' order by name limit 1);
    else
      insert into document_types (org_id, name, category, tracks_number, warning_threshold_days, created_by)
      values (v_org, 'Visa', 'visa', true, 30, (select user_id from _seed_ctx));
    end if;
  end if;
end $$;

update _seed_ctx set visa_doc_type_id =
  (select id from document_types
   where org_id = (select org_id from _seed_ctx) and category = 'visa' and is_active
   order by name limit 1);

-- 3. Make sure the six visa types used below exist (existing ones are left
--    exactly as they are - the dates below follow whatever rules they hold).
insert into visa_types (org_id, country, name, mobilization_code, entry_valid_days, stay_basis, stay_days, entry_type,
                        expiry_reminder_days, entry_reminder_days, notes, sort_order)
select c.org_id, v.country, v.name, v.code, v.entry_valid_days, v.stay_basis, v.stay_days, v.entry_type,
       v.expiry_reminder_days, v.entry_reminder_days, v.notes, v.sort_order
from _seed_ctx c
cross join (values
  ('United Arab Emirates', 'Mission visa',  'mission', 60,        'days_from_entry', 60,        'single',   '{30,14,7}'::int[],       '{14,7,3}'::int[], 'Test values - confirm with your PRO.', 10),
  ('United Arab Emirates', 'Resident visa', 'resident', null::int, 'until_expiry',   null::int, 'multiple', '{90,60,30,14,7}'::int[], '{}'::int[],       'Test values - confirm with your PRO.', 20),
  ('Saudi Arabia',         'Work visa',     null,       null::int, 'until_expiry',   null::int, 'multiple', '{75,45,30,14,7}'::int[], '{}'::int[],       'Test values - confirm with your PRO.', 50),
  ('Saudi Arabia',         'Visit visa',    'visit',    90,        'days_from_entry', 90,       'single',   '{30,14,7}'::int[],       '{14,7,3}'::int[], 'Test values - confirm with your PRO.', 60),
  ('Qatar',                'Work visa',     null,       null::int, 'until_expiry',   null::int, 'multiple', '{75,45,30,14,7}'::int[], '{}'::int[],       'Test values - confirm with your PRO.', 70),
  ('Qatar',                'Visit visa',    'visit',    90,        'days_from_entry', 30,       'single',   '{14,7,3}'::int[],        '{14,7,3}'::int[], 'Test values - confirm with your PRO.', 80)
) as v(country, name, code, entry_valid_days, stay_basis, stay_days, entry_type, expiry_reminder_days, entry_reminder_days, notes, sort_order)
on conflict (org_id, country, name) do nothing;

-- 4. The visas. One current visa per person, plus older ones for some.
create temp table _seed_visas on commit drop as
with plan as (
  select cp.id as crew_id,
         row_number() over (order by cp.crew_code, cp.id)::int as rn
  from crew_profiles cp
  where cp.org_id = (select org_id from _seed_ctx)
),
base as (
  select p.crew_id, p.rn,
    (p.rn % 20) as k,
    ((p.rn / 20) % 2) as sub,
    case p.rn % 3 when 0 then 'United Arab Emirates' when 1 then 'Saudi Arabia' else 'Qatar' end as country,
    case p.rn % 3 when 0 then 'Resident visa' else 'Work visa' end as long_name,
    case p.rn % 3 when 0 then 'Mission visa' else 'Visit visa' end as win_name,
    case p.rn % 3 when 0 then 'AHM Marine LLC' when 1 then 'AHM Marine KSA' else 'AHM Marine Qatar W.L.L.' end as sponsor,
    case p.rn % 3 when 0 then 'UAE' when 1 then 'KSA' else 'QAT' end as cc
  from plan p
),
typed as (
  select b.*,
    case when b.k <= 14 or (b.k = 19 and b.sub = 1) then b.long_name else b.win_name end as type_name
  from base b
),
joined as (
  select t.*, vt.id as visa_type_id,
         coalesce(vt.entry_valid_days, 60) as evd,
         coalesce(vt.stay_days, 60) as sd
  from typed t
  join visa_types vt
    on vt.org_id = (select org_id from _seed_ctx) and vt.country = t.country and vt.name = t.type_name
),
dated as (
  select j.*,
    -- issue date
    case
      when j.k <= 7   then (current_date + 100 + (j.rn % 800)) - 1095
      when j.k <= 11  then (current_date + 2 + (j.rn % 58)) - 730
      when j.k <= 14  then (current_date - (5 + (j.rn % 380))) - 730
      when j.k = 15   then current_date - (j.evd - (5 + (j.rn % 50)))
      when j.k = 16   then current_date - (j.evd + 10 + (j.rn % 200))
      when j.k = 17   then current_date - (j.sd + 5 + (j.rn % 60)) - (5 + (j.rn % 20))
      when j.k = 18   then current_date - ((j.sd * ((j.rn % 9) + 1)) / 10) - 5
      when j.k = 19 and j.sub = 1 then (current_date + 200) - 730
      else null
    end as issue_date,
    -- expiry date
    case
      when j.k <= 7   then current_date + 100 + (j.rn % 800)
      when j.k <= 11  then current_date + 2 + (j.rn % 58)
      when j.k <= 14  then current_date - (5 + (j.rn % 380))
      when j.k = 19 and j.sub = 1 then current_date + 200
      else null
    end as expiry_date
  from joined j
),
final as (
  select d.*,
    -- window-type visas expire at the end of the entry window
    case when d.k between 15 and 18 then d.issue_date + d.evd else d.expiry_date end as expiry_final,
    case
      when d.k <= 14 then d.issue_date + 7
      when d.k = 17 then current_date - (d.sd + 5 + (d.rn % 60))
      when d.k = 18 then current_date - ((d.sd * ((d.rn % 9) + 1)) / 10)
      else null
    end as entry_date,
    case
      when d.k <= 14 then 'entered'
      when d.k = 15 then 'awaiting_entry'
      when d.k = 16 then 'approved'
      when d.k in (17, 18) then 'entered'
      when d.sub = 0 then 'applied'
      else 'cancelled'
    end as visa_status
  from dated d
)
select f.crew_id, f.rn, f.cc, f.country, f.sponsor, f.visa_type_id, f.visa_status,
       f.issue_date, f.expiry_final as expiry_date, f.entry_date,
       case when f.k = 19 and f.sub = 0 then current_date - (2 + (f.rn % 14))
            when f.issue_date is not null then f.issue_date - (3 + (f.rn % 5))
            else null end as application_date,
       case when f.k = 19 and f.sub = 0 then null
            else 'TEST-' || f.cc || '-' || lpad(f.rn::text, 4, '0') end as document_number,
       case when f.k = 19 and f.sub = 1 then 'TEST DATA - visa seed (cancelled: project cancelled)'
            else 'TEST DATA - visa seed' end as notes
from final f

union all
-- older, finished visa for about every 3rd person (stay ended long ago)
select b.crew_id, b.rn, b.cc, b.country, b.sponsor, vt.id, 'entered',
       current_date - (600 + (b.rn % 300)),
       (current_date - (600 + (b.rn % 300))) + coalesce(vt.entry_valid_days, 60),
       (current_date - (600 + (b.rn % 300))) + 5,
       (current_date - (600 + (b.rn % 300))) - 4,
       'TEST-' || b.cc || '-H-' || lpad(b.rn::text, 4, '0'),
       'TEST DATA - visa seed (older visa)'
from base b
join visa_types vt
  on vt.org_id = (select org_id from _seed_ctx) and vt.country = b.country and vt.name = b.win_name
where b.rn % 3 = 0

union all
-- older expired long-term visa for about every 7th person
select b.crew_id, b.rn, b.cc, b.country, b.sponsor, vt.id, 'entered',
       current_date - (1500 + (b.rn % 200)),
       current_date - (700 + (b.rn % 200)),
       (current_date - (1500 + (b.rn % 200))) + 7,
       (current_date - (1500 + (b.rn % 200))) - 4,
       'TEST-' || b.cc || '-P-' || lpad(b.rn::text, 4, '0'),
       'TEST DATA - visa seed (older visa)'
from base b
join visa_types vt
  on vt.org_id = (select org_id from _seed_ctx) and vt.country = b.country and vt.name = b.long_name
where b.rn % 7 = 0;

insert into crew_documents (
  org_id, crew_id, document_type_id, document_number, sponsor, issue_date, expiry_date, entry_date,
  notes, custom_fields, visa_country, visa_type_id, visa_application_date, visa_status, created_by, updated_by
)
select c.org_id, s.crew_id, c.visa_doc_type_id, s.document_number, s.sponsor, s.issue_date, s.expiry_date, s.entry_date,
       s.notes, '{}'::jsonb, s.country, s.visa_type_id, s.application_date, s.visa_status, c.user_id, c.user_id
from _seed_visas s
cross join _seed_ctx c;

-- 5. A short change log for each test visa (only when the 0045 log table exists).
do $$
begin
  if to_regclass('public.crew_visa_events') is not null then
    insert into crew_visa_events (org_id, crew_id, crew_document_id, event_type, summary, new_value, created_by, created_at)
    select d.org_id, d.crew_id, d.id, 'recorded',
           'Visa recorded - status ' || initcap(replace(coalesce(d.visa_status, 'applied'), '_', ' '))
             || coalesce(', application date ' || to_char(d.visa_application_date, 'DD Mon YYYY'), ''),
           d.visa_status, d.created_by,
           coalesce(d.visa_application_date, d.issue_date, current_date)::timestamp + time '09:00'
    from crew_documents d
    where d.org_id = (select org_id from _seed_ctx) and d.notes like 'TEST DATA - visa seed%';

    insert into crew_visa_events (org_id, crew_id, crew_document_id, event_type, summary, new_value, created_by, created_at)
    select d.org_id, d.crew_id, d.id, 'entry_date',
           'Entry date recorded - ' || to_char(d.entry_date, 'DD Mon YYYY'),
           d.entry_date::text, d.created_by, d.entry_date::timestamp + time '14:00'
    from crew_documents d
    where d.org_id = (select org_id from _seed_ctx) and d.notes like 'TEST DATA - visa seed%' and d.entry_date is not null;
  end if;
end $$;

commit;

-- Check: how the test visas came out, by country and by what the Visas tab will show.
select d.visa_country,
       count(*) filter (where d.visa_status = 'cancelled') as cancelled,
       count(*) filter (where d.visa_status = 'applied') as applied,
       count(*) filter (where d.visa_status in ('awaiting_entry', 'approved')) as not_yet_entered,
       count(*) filter (where d.visa_status = 'entered') as entered,
       count(*) as total
from crew_documents d
where d.notes like 'TEST DATA - visa seed%'
group by d.visa_country
order by d.visa_country;
