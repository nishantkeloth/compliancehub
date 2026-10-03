-- ============================================================
-- ComplianceHub — crew matrix version integrity
--
-- Run this whole file once, top to bottom, in the Supabase SQL Editor.
-- Safe to re-run.
--
-- Two fixes:
--
-- 1. Duplicate version numbers. "Create New Version" works out the next
--    version as (highest existing + 1) and then inserts, with nothing in
--    the database stopping two near-simultaneous clicks (or two users)
--    from both producing, say, v2 of the same matrix. A partial unique
--    index on (org_id, matrix_number, version_number) now makes the
--    second insert fail; the app turns that into a friendly message.
--
-- 2. Cross-company supersede. supersede_previous_active_matrix() looked
--    for the matrix's previous active version by matrix_number alone.
--    Matrix numbers come from a per-company number range, so two
--    companies can hold the same number (e.g. CM-0001) — activating one
--    company's matrix would have silently superseded the other's active
--    one. It is now scoped to the same org_id.
--
-- If the index step finds existing duplicate versions it stops and lists
-- them WITHOUT changing any data — renumber or remove those by hand,
-- then re-run this file.
-- ============================================================

begin;

do $$
declare
  dup text;
begin
  select string_agg(format('org %s: %s v%s (%s rows)', org_id, matrix_number, version_number, n), E'\n')
  into dup
  from (
    select org_id, matrix_number, version_number, count(*) as n
    from crew_matrices
    where matrix_number is not null
    group by org_id, matrix_number, version_number
    having count(*) > 1
  ) d;

  if dup is not null then
    raise exception E'Duplicate matrix versions exist - fix these first, then re-run:\n%', dup;
  end if;
end $$;

create unique index if not exists crew_matrices_org_number_version_uniq
  on crew_matrices (org_id, matrix_number, version_number)
  where matrix_number is not null;

create or replace function supersede_previous_active_matrix()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status = 'active' and (old.status is distinct from 'active') and new.matrix_number is not null then
    update crew_matrices
    set status = 'superseded', updated_at = now(), updated_by = new.updated_by
    where org_id = new.org_id
      and matrix_number = new.matrix_number
      and id <> new.id
      and status = 'active';
  end if;
  return new;
end;
$$;

commit;
