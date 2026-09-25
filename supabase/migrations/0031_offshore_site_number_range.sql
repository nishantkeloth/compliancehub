-- ============================================================
-- ComplianceHub — Offshore Site auto-numbered codes
--
-- Offshore sites have always had a free-text `code` column (set
-- manually, optional, never validated for uniqueness). Clients,
-- Contractors, Contracts, Projects, Crew Matrices and Mobilizations
-- all get a unique short code auto-assigned instead, via the shared
-- number_range_configs / next_number_range_code() mechanism — this
-- migration extends that same mechanism to Offshore Sites (prefix
-- SIT), the same way each earlier migration that added an entity
-- type did (last widened in migration 0018).
--
-- Deliberately NOT touched: existing offshore_sites rows keep
-- whatever `code` they already have (blank or manually typed) —
-- this only changes how a *new* site's code gets set going forward.
-- The app-side change (making createOffshoreSite call this instead
-- of taking `code` from form input, and making the Code field
-- read-only in the UI) ships alongside this migration.
-- ============================================================

begin;

alter table number_range_configs drop constraint if exists number_range_configs_entity_type_check;
alter table number_range_configs add constraint number_range_configs_entity_type_check
  check (entity_type = any (array[
    'client', 'contractor', 'contract', 'project', 'crew_matrix',
    'mobilization', 'crew_matrix_share', 'offshore_site'
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
select id, 'offshore_site', 'SIT', 5, 0 from companies
on conflict (org_id, entity_type) do nothing;

commit;
