-- ============================================================
-- ComplianceHub — Crew Profile auto-numbered codes
--
-- Clients, Contractors, Contracts, Projects, Crew Matrices,
-- Mobilizations and Offshore Sites all get a unique short code
-- auto-assigned via the shared number_range_configs /
-- next_number_range_code() mechanism (last widened in migration
-- 0031, for Offshore Sites). Crew Profiles never got one — the only
-- identifier on a crew member has been employee_code, a manual,
-- optional, free-text field with no uniqueness guarantee, so a
-- candidate who hasn't been issued an employee code yet (or a
-- duplicate name) has no stable reference at all.
--
-- This migration extends that same mechanism to Crew Profiles
-- (prefix CRW), the same way each earlier migration that added an
-- entity type did. employee_code is untouched and keeps its own
-- meaning (the employer's own HR/payroll code, when they have one);
-- crew_code is a new, separate, always-present internal reference.
--
-- Backfill: every existing crew_profiles row (across every company)
-- gets a crew_code assigned in created_at order, using the same
-- atomic counter a newly-created crew profile will draw from next —
-- so numbering picks up seamlessly rather than colliding with the
-- first crew member created after this migration.
-- ============================================================

begin;

alter table crew_profiles add column if not exists crew_code text;

alter table number_range_configs drop constraint if exists number_range_configs_entity_type_check;
alter table number_range_configs add constraint number_range_configs_entity_type_check
  check (entity_type = any (array[
    'client', 'contractor', 'contract', 'project', 'crew_matrix',
    'mobilization', 'crew_matrix_share', 'offshore_site', 'crew'
  ]));

-- Minimal-diff copy of the existing function (same auth check, same
-- insert-then-increment shape) — only the default-prefix logic grows
-- one more branch, same pattern each earlier migration used.
create or replace function public.next_number_range_code(p_org_id uuid, p_entity_type text)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_next bigint;
  v_prefix text;
  v_padding int;
  v_code text;
  v_default_prefix text;
begin
  if p_org_id is distinct from my_org_id() and not is_platform_admin() then
    raise exception 'not authorized';
  end if;

  v_default_prefix := case p_entity_type
    when 'client' then 'CLI'
    when 'contractor' then 'CON'
    when 'contract' then 'CTR'
    when 'project' then 'PRJ'
    when 'crew_matrix' then 'CMX'
    when 'mobilization' then 'MOB'
    when 'crew_matrix_share' then 'SHR'
    when 'offshore_site' then 'SIT'
    when 'crew' then 'CRW'
    else 'GEN'
  end;

  insert into number_range_configs (org_id, entity_type, prefix, padding_length, current_number)
  values (p_org_id, p_entity_type, v_default_prefix, 5, 0)
  on conflict (org_id, entity_type) do nothing;

  update number_range_configs
  set current_number = current_number + 1,
      updated_at = now()
  where org_id = p_org_id and entity_type = p_entity_type
  returning current_number, prefix, padding_length into v_next, v_prefix, v_padding;

  v_code := coalesce(v_prefix, '') || lpad(v_next::text, v_padding, '0');
  return v_code;
end;
$function$;

-- Make the config row visible on the Number Ranges screen immediately
-- for every existing company (harmless if next_number_range_code()
-- would have lazily created it anyway).
insert into number_range_configs (org_id, entity_type, prefix, padding_length, current_number)
select id, 'crew', 'CRW', 5, 0 from companies
on conflict (org_id, entity_type) do nothing;

-- ------------------------------------------------------------
-- Backfill — every existing crew_profiles row gets a crew_code,
-- oldest first per company, drawing from the same counter a new
-- crew member created after this migration will continue from.
--
-- pg_temp._migration_next_code() is a session-local copy of
-- next_number_range_code() without its auth.uid()-based
-- authorization check, since this migration runs outside a signed-in
-- app session and can't satisfy it — the insert above already
-- guarantees a number_range_configs row exists for every company's
-- 'crew' entity_type, so the plain update here is safe.
-- ------------------------------------------------------------

create or replace function pg_temp._migration_next_code(p_org_id uuid, p_entity_type text)
returns text
language plpgsql
as $$
declare
  v_next bigint;
  v_prefix text;
  v_padding int;
begin
  update number_range_configs
  set current_number = current_number + 1,
      updated_at = now()
  where org_id = p_org_id and entity_type = p_entity_type
  returning current_number, prefix, padding_length into v_next, v_prefix, v_padding;

  return coalesce(v_prefix, '') || lpad(v_next::text, v_padding, '0');
end;
$$;

do $$
declare
  crew_row record;
begin
  for crew_row in
    select id, org_id from crew_profiles where crew_code is null order by org_id, created_at asc, id asc
  loop
    update crew_profiles
    set crew_code = pg_temp._migration_next_code(crew_row.org_id, 'crew')
    where id = crew_row.id;
  end loop;
end $$;

commit;
