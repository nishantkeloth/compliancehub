-- ============================================================
-- ComplianceHub — Phase 6: Boarding, Active Rotation & Demobilization
--
-- Depends on Phase 4 (0004_phase4_readiness.sql) and the existing
-- crew_assignments / crew_profiles / rotation_templates tables. Run
-- this whole file once, top to bottom, in the Supabase SQL Editor.
-- Safe to re-run. (Numbered 0006 to match the phase number — there is
-- no 0005 migration.)
--
-- Adds: boarding_confirmations, signoff_confirmations,
-- crew_change_requests (+ status history), rotation_extensions.
-- Extends: crew_assignments (planned vs. actual dates, status, links
-- back to the mobilization/boarding/sign-off that created and closed
-- it), crew_profiles.deployment_status.
--
-- Design notes (see claude/phase6-boarding-rotation-demob.md):
--  * crew_assignments.end_date IS NULL stays the universal "active"
--    signal every existing screen already reads (roster, documents
--    matrix, readiness engine). assignment_status mirrors it and adds
--    the planned/extended/signed_off nuance; the two are kept in sync
--    by the server actions, never diverged on purpose.
--  * "Prevent two simultaneous active vessel assignments" is a partial
--    unique index on (crew_id) where end_date is null — a real DB
--    constraint, in addition to the app-layer refusal.
--  * No new permissions (spec has no Permissions section). Boarding and
--    sign-off use mobilization.manage; emergency sign-off requires
--    mobilization.emergency_override; crew change approval uses
--    mobilization.approve.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. crew_assignments — planned vs. actual, status, provenance
-- ------------------------------------------------------------

alter table crew_assignments add column if not exists project_id uuid references projects(id);
alter table crew_assignments add column if not exists mobilization_request_id uuid references mobilization_requests(id);
alter table crew_assignments add column if not exists mobilization_position_id uuid references mobilization_positions(id);
alter table crew_assignments add column if not exists rotation_template_id uuid references rotation_templates(id);
alter table crew_assignments add column if not exists planned_start_date date;
alter table crew_assignments add column if not exists planned_end_date date;
alter table crew_assignments add column if not exists actual_start_date date;
alter table crew_assignments add column if not exists actual_end_date date;
alter table crew_assignments add column if not exists assignment_status text not null default 'active';
alter table crew_assignments add column if not exists shift text;
alter table crew_assignments add column if not exists rotation_cycle_number integer;
alter table crew_assignments add column if not exists reliever_crew_id uuid references crew_profiles(id);
alter table crew_assignments add column if not exists boarding_confirmation_id uuid;
alter table crew_assignments add column if not exists signoff_confirmation_id uuid;

alter table crew_assignments drop constraint if exists crew_assignments_status_check;
alter table crew_assignments add constraint crew_assignments_status_check
  check (assignment_status in ('active', 'extended', 'signed_off', 'cancelled'));

-- Backfill rows that predate this phase.
update crew_assignments set assignment_status = 'signed_off' where end_date is not null and assignment_status = 'active';
update crew_assignments set actual_start_date = start_date where actual_start_date is null;
update crew_assignments set actual_end_date = end_date where actual_end_date is null and end_date is not null;

drop index if exists crew_assignments_one_active_idx;
create unique index crew_assignments_one_active_idx on crew_assignments(crew_id) where (end_date is null);

create index if not exists crew_assignments_planned_end_idx on crew_assignments(planned_end_date);
create index if not exists crew_assignments_position_idx on crew_assignments(mobilization_position_id);

-- ------------------------------------------------------------
-- 2. crew_profiles.deployment_status — updated automatically by
--    boarding / in-transit / sign-off, never edited by hand.
-- ------------------------------------------------------------

alter table crew_profiles add column if not exists deployment_status text not null default 'onshore';
alter table crew_profiles drop constraint if exists crew_profiles_deployment_status_check;
alter table crew_profiles add constraint crew_profiles_deployment_status_check
  check (deployment_status in ('onshore', 'in_transit', 'onboard'));
update crew_profiles p set deployment_status = 'onboard'
  where deployment_status = 'onshore'
    and exists (select 1 from crew_assignments a where a.crew_id = p.id and a.end_date is null);

-- ------------------------------------------------------------
-- 3. Boarding confirmations — the ONLY thing that creates an active
--    crew_assignment from a mobilization.
-- ------------------------------------------------------------

create table if not exists boarding_confirmations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  mobilization_request_id uuid not null references mobilization_requests(id),
  mobilization_position_id uuid not null references mobilization_positions(id),
  crew_id uuid not null references crew_profiles(id),
  offshore_site_id uuid not null references offshore_sites(id),
  actual_departure_at timestamptz,
  actual_arrival_at timestamptz,
  actual_onboard_at timestamptz not null,
  confirmed_by uuid references auth.users(id),
  vessel_acknowledged boolean not null default false,
  vessel_acknowledged_by text,
  boarding_reference text,
  remarks text,
  supporting_document_url text,
  created_at timestamptz not null default now()
);
create index if not exists boarding_confirmations_org_idx on boarding_confirmations(org_id);
create index if not exists boarding_confirmations_position_idx on boarding_confirmations(mobilization_position_id);
create index if not exists boarding_confirmations_crew_idx on boarding_confirmations(crew_id);

-- ------------------------------------------------------------
-- 4. Sign-off (demobilization) confirmations — the ONLY thing that
--    ends an active crew_assignment.
-- ------------------------------------------------------------

create table if not exists signoff_confirmations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  crew_assignment_id uuid not null references crew_assignments(id),
  crew_id uuid not null references crew_profiles(id),
  offshore_site_id uuid not null references offshore_sites(id),
  planned_signoff_date date,
  actual_signoff_at timestamptz not null,
  replacement_confirmed boolean not null default false,
  replacement_crew_id uuid references crew_profiles(id),
  handover_completed boolean not null default false,
  handover_notes text,
  return_travel_details text,
  return_travel_departure_at timestamptz,
  return_travel_arrival_at timestamptz,
  property_returned boolean not null default false,
  timesheet_closed boolean not null default false,
  clearance_status text not null default 'cleared'
    check (clearance_status in ('cleared', 'pending', 'flagged')),
  clearance_notes text,
  performance_rating integer check (performance_rating between 1 and 5),
  performance_notes text,
  return_to_pool_date date,
  is_emergency boolean not null default false,
  emergency_reason text,
  authorized_by uuid references auth.users(id),
  confirmed_by uuid references auth.users(id),
  remarks text,
  created_at timestamptz not null default now(),
  constraint signoff_emergency_needs_reason check (not is_emergency or emergency_reason is not null)
);
create index if not exists signoff_confirmations_org_idx on signoff_confirmations(org_id);
create index if not exists signoff_confirmations_assignment_idx on signoff_confirmations(crew_assignment_id);
create index if not exists signoff_confirmations_crew_idx on signoff_confirmations(crew_id);

-- ------------------------------------------------------------
-- 5. Rotation extensions — audited exception to the planned end.
-- ------------------------------------------------------------

create table if not exists rotation_extensions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  crew_assignment_id uuid not null references crew_assignments(id) on delete cascade,
  previous_planned_end_date date,
  new_planned_end_date date not null,
  reason text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists rotation_extensions_assignment_idx on rotation_extensions(crew_assignment_id);

-- ------------------------------------------------------------
-- 6. Crew change requests (rotation / replacement) with approval
--    workflow and reliever readiness captured at request time.
-- ------------------------------------------------------------

create table if not exists crew_change_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  crew_assignment_id uuid not null references crew_assignments(id),
  current_crew_id uuid not null references crew_profiles(id),
  proposed_reliever_crew_id uuid references crew_profiles(id),
  offshore_site_id uuid not null references offshore_sites(id),
  reason text not null,
  planned_change_date date not null,
  is_emergency boolean not null default false,
  status text not null default 'pending_approval'
    check (status in ('pending_approval', 'approved', 'rejected', 'completed', 'cancelled')),
  reliever_readiness_outcome text,
  reliever_readiness_checks jsonb,
  mobilization_request_id uuid references mobilization_requests(id),
  requested_by uuid references auth.users(id),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crew_change_requests_org_idx on crew_change_requests(org_id);
create index if not exists crew_change_requests_assignment_idx on crew_change_requests(crew_assignment_id);
create index if not exists crew_change_requests_status_idx on crew_change_requests(status);

create table if not exists crew_change_request_status_history (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  crew_change_request_id uuid not null references crew_change_requests(id) on delete cascade,
  old_status text,
  new_status text not null,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now()
);
create index if not exists crew_change_request_status_history_req_idx on crew_change_request_status_history(crew_change_request_id);

create or replace function log_crew_change_request_status()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if tg_op = 'INSERT' then
    insert into crew_change_request_status_history (crew_change_request_id, org_id, old_status, new_status, changed_by)
    values (new.id, new.org_id, null, new.status, auth.uid());
  elsif new.status is distinct from old.status then
    insert into crew_change_request_status_history (crew_change_request_id, org_id, old_status, new_status, changed_by)
    values (new.id, new.org_id, old.status, new.status, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists crew_change_requests_status_history_trg on crew_change_requests;
create trigger crew_change_requests_status_history_trg
  after insert or update of status on crew_change_requests
  for each row execute function log_crew_change_request_status();

-- ------------------------------------------------------------
-- 7. Row Level Security
-- ------------------------------------------------------------

alter table boarding_confirmations enable row level security;
alter table signoff_confirmations enable row level security;
alter table rotation_extensions enable row level security;
alter table crew_change_requests enable row level security;
alter table crew_change_request_status_history enable row level security;

drop policy if exists boarding_confirmations_select on boarding_confirmations;
create policy boarding_confirmations_select on boarding_confirmations for select
  using ((org_id = my_org_id() and (has_permission('mobilization.view') or has_permission('crew.view'))) or is_platform_admin());
drop policy if exists boarding_confirmations_insert on boarding_confirmations;
create policy boarding_confirmations_insert on boarding_confirmations for insert
  with check (org_id = my_org_id() and has_permission('mobilization.manage'));
-- Insert-only: a boarding record is a fact, not an editable form.

drop policy if exists signoff_confirmations_select on signoff_confirmations;
create policy signoff_confirmations_select on signoff_confirmations for select
  using ((org_id = my_org_id() and (has_permission('mobilization.view') or has_permission('crew.view'))) or is_platform_admin());
drop policy if exists signoff_confirmations_insert on signoff_confirmations;
create policy signoff_confirmations_insert on signoff_confirmations for insert
  with check (org_id = my_org_id() and (has_permission('mobilization.manage') or has_permission('mobilization.emergency_override')));

drop policy if exists rotation_extensions_select on rotation_extensions;
create policy rotation_extensions_select on rotation_extensions for select
  using ((org_id = my_org_id() and (has_permission('mobilization.view') or has_permission('crew.view'))) or is_platform_admin());
drop policy if exists rotation_extensions_insert on rotation_extensions;
create policy rotation_extensions_insert on rotation_extensions for insert
  with check (org_id = my_org_id() and has_permission('mobilization.manage'));

drop policy if exists crew_change_requests_select on crew_change_requests;
create policy crew_change_requests_select on crew_change_requests for select
  using ((org_id = my_org_id() and (has_permission('mobilization.view') or has_permission('crew.view'))) or is_platform_admin());
drop policy if exists crew_change_requests_insert on crew_change_requests;
create policy crew_change_requests_insert on crew_change_requests for insert
  with check (org_id = my_org_id() and has_permission('mobilization.manage'));
drop policy if exists crew_change_requests_update on crew_change_requests;
create policy crew_change_requests_update on crew_change_requests for update
  using (org_id = my_org_id() and (has_permission('mobilization.manage') or has_permission('mobilization.approve')));

drop policy if exists crew_change_request_status_history_select on crew_change_request_status_history;
create policy crew_change_request_status_history_select on crew_change_request_status_history for select
  using ((org_id = my_org_id() and (has_permission('mobilization.view') or has_permission('crew.view'))) or is_platform_admin());
-- No write policy: written only by the SECURITY DEFINER trigger.

commit;
