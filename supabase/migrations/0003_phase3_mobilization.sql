-- ============================================================
-- ComplianceHub — Phase 3: Mobilization Request & Manpower Planning
--
-- Depends on Phase 2 (0002_phase2_crew_matrix.sql) — needs
-- crew_matrices / crew_matrix_lines, and on the existing
-- crew_profiles / crew_skills / crew_documents / crew_assignments
-- tables. Run this whole file once, top to bottom, in the Supabase
-- SQL Editor. Safe to re-run.
--
-- Adds: mobilization_requests, mobilization_positions,
-- mobilization_position_history (candidate-replacement audit),
-- mobilization_status_history (header status audit),
-- mobilization_comments.
-- Extends: number_range_configs ('mobilization' -> MOB),
-- next_number_range_code().
--
-- Design notes (flagged for review, see chat/project doc):
--  * A mobilization can only be created from a crew matrix whose
--    status is 'approved' or 'active' — enforced in the app layer
--    (createMobilizationRequest), matching how Phase 1 enforced its
--    project/contract business rules, not as a DB constraint.
--  * "Reservation" (req. 5) is a partial unique index on
--    mobilization_positions.selected_crew_id, active only while
--    final_status = 'pending'. Once a position is filled (boarded —
--    which is also the moment a real crew_assignments row is
--    created) or vacated/cancelled, the lock releases; ongoing
--    occupancy from that point on is governed by crew_assignments
--    (the existing system), not by this table. This keeps the
--    "reservation vs. active assignment" boundary the spec draws
--    (req. 5) a real boundary instead of a lock that never expires.
--  * Status timeline (mobilization_status_history) and free-text
--    Comments (mobilization_comments) are kept as two separate
--    tables/UI panels per req. 7, rather than overloading one
--    column the way Phase 2 reused rejection_reason — workflow
--    actions that need to explain themselves (return for
--    correction, cancel, emergency override) post a system comment
--    into mobilization_comments instead.
--  * Client approval only has one permission (mobilization.approve)
--    per the spec's permission list — Phase 2's separate internal
--    vs. client approval permissions don't apply here.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. Mobilization Request header
-- ------------------------------------------------------------

create table if not exists mobilization_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  mobilization_number text,
  project_id uuid not null references projects(id),
  offshore_site_id uuid not null references offshore_sites(id),
  crew_matrix_id uuid not null references crew_matrices(id),
  mobilization_type text not null
    check (mobilization_type in (
      'initial', 'rotation_change', 'replacement',
      'additional_manpower', 'emergency', 'demobilization'
    )),
  request_date date not null default current_date,
  required_onboard_date date not null,
  crew_change_location text,
  travel_origin text,
  special_instructions text,
  priority text not null default 'normal'
    check (priority in ('normal', 'urgent', 'emergency')),
  status text not null default 'draft'
    check (status in (
      'draft', 'planning', 'compliance_review', 'internal_approval',
      'client_approval', 'travel_arrangement', 'ready_to_mobilize',
      'in_transit', 'completed', 'partially_completed', 'cancelled'
    )),
  client_approval_required boolean not null default false,
  requested_by uuid references auth.users(id),
  coordinator_user_id uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
create index if not exists mobilization_requests_org_id_idx on mobilization_requests(org_id);
create index if not exists mobilization_requests_project_id_idx on mobilization_requests(project_id);
create index if not exists mobilization_requests_offshore_site_id_idx on mobilization_requests(offshore_site_id);
create index if not exists mobilization_requests_crew_matrix_id_idx on mobilization_requests(crew_matrix_id);
create index if not exists mobilization_requests_status_idx on mobilization_requests(status);

-- ------------------------------------------------------------
-- 2. Mobilization Positions — one row per headcount slot (a
--    matrix line with required_headcount = 3 expands into 3
--    position rows, position_sequence 1..3), so each slot gets
--    its own candidate.
-- ------------------------------------------------------------

create table if not exists mobilization_positions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  mobilization_request_id uuid not null references mobilization_requests(id) on delete cascade,
  crew_matrix_line_id uuid references crew_matrix_lines(id),
  job_role_id uuid not null references job_roles(id),
  position_sequence integer not null default 1,
  required_onboard_date date,
  selected_crew_id uuid references crew_profiles(id),
  reliever_for_crew_id uuid references crew_profiles(id),
  readiness_status text not null default 'open'
    check (readiness_status in (
      'open', 'selected', 'compliance_review', 'compliance_cleared',
      'compliance_issue', 'ready', 'boarded'
    )),
  client_approval_status text not null default 'not_required'
    check (client_approval_status in ('not_required', 'pending', 'approved', 'rejected')),
  final_status text not null default 'pending'
    check (final_status in ('pending', 'filled', 'vacant', 'cancelled')),
  is_additional boolean not null default false,
  additional_reason text,
  remarks text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  constraint mobilization_positions_additional_needs_reason
    check (not is_additional or additional_reason is not null)
);
create index if not exists mobilization_positions_org_id_idx on mobilization_positions(org_id);
create index if not exists mobilization_positions_request_id_idx on mobilization_positions(mobilization_request_id);
create index if not exists mobilization_positions_selected_crew_id_idx on mobilization_positions(selected_crew_id);

-- The reservation lock (req. 3 + 5): a crew member can hold at
-- most one "pending" (not yet filled/vacant/cancelled) position
-- anywhere in the org at a time.
drop index if exists mobilization_positions_one_active_reservation;
create unique index mobilization_positions_one_active_reservation
  on mobilization_positions(selected_crew_id)
  where (selected_crew_id is not null and final_status = 'pending');

-- ------------------------------------------------------------
-- 3. Candidate-replacement audit trail
-- ------------------------------------------------------------

create table if not exists mobilization_position_history (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  mobilization_position_id uuid not null references mobilization_positions(id) on delete cascade,
  previous_crew_id uuid references crew_profiles(id),
  new_crew_id uuid references crew_profiles(id),
  reason text,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now()
);
create index if not exists mobilization_position_history_position_id_idx on mobilization_position_history(mobilization_position_id);

-- Written explicitly by the selectCandidate/replaceCandidate server
-- actions (which already have the human-entered reason in hand),
-- not by a trigger — a trigger here would have to guess at "reason"
-- from some column on mobilization_positions, and the only text
-- column available (remarks) is a general-purpose field that can
-- be edited for unrelated reasons, which would make the audit trail
-- unreliable. See RLS below for the insert policy this needs.

-- ------------------------------------------------------------
-- 4. Header status audit trail
-- ------------------------------------------------------------

create table if not exists mobilization_status_history (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  mobilization_request_id uuid not null references mobilization_requests(id) on delete cascade,
  old_status text,
  new_status text not null,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now()
);
create index if not exists mobilization_status_history_request_id_idx on mobilization_status_history(mobilization_request_id);

create or replace function log_mobilization_status_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status is distinct from old.status then
    insert into mobilization_status_history (mobilization_request_id, org_id, old_status, new_status, changed_by)
    values (new.id, new.org_id, old.status, new.status, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists mobilization_requests_status_history_trg on mobilization_requests;
create trigger mobilization_requests_status_history_trg
  after update of status on mobilization_requests
  for each row execute function log_mobilization_status_change();

-- ------------------------------------------------------------
-- 5. Comments (separate from the audited status timeline —
--    system actions post here too, marked is_system, so
--    "why was this returned / cancelled / fast-tracked" has a
--    home without overloading a status column).
-- ------------------------------------------------------------

create table if not exists mobilization_comments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  mobilization_request_id uuid not null references mobilization_requests(id) on delete cascade,
  user_id uuid references auth.users(id),
  body text not null,
  is_system boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists mobilization_comments_request_id_idx on mobilization_comments(mobilization_request_id);

-- ------------------------------------------------------------
-- 6. Row Level Security
--
--    mobilization_requests: write is allowed for ANY of the
--    mobilization permissions (manage / compliance_review /
--    approve / cancel / emergency_override) — same broad-RLS/
--    narrow-server-action division of labor as Phase 2's
--    crew_matrices. mobilization_positions gets the same shape
--    since compliance reviewers and approvers update different
--    position-level fields.
-- ------------------------------------------------------------

alter table mobilization_requests enable row level security;
drop policy if exists mobilization_requests_select on mobilization_requests;
drop policy if exists mobilization_requests_write on mobilization_requests;
drop policy if exists mobilization_requests_update on mobilization_requests;
drop policy if exists mobilization_requests_delete on mobilization_requests;
create policy mobilization_requests_select on mobilization_requests for select
  using ((org_id = my_org_id() and has_permission('mobilization.view')) or is_platform_admin());
create policy mobilization_requests_write on mobilization_requests for insert
  with check (org_id = my_org_id() and has_permission('mobilization.manage'));
create policy mobilization_requests_update on mobilization_requests for update
  using (
    org_id = my_org_id() and (
      has_permission('mobilization.manage')
      or has_permission('mobilization.compliance_review')
      or has_permission('mobilization.approve')
      or has_permission('mobilization.cancel')
      or has_permission('mobilization.emergency_override')
    )
  )
  with check (org_id = my_org_id());
create policy mobilization_requests_delete on mobilization_requests for delete
  using (org_id = my_org_id() and has_permission('mobilization.manage'));

alter table mobilization_positions enable row level security;
drop policy if exists mobilization_positions_select on mobilization_positions;
drop policy if exists mobilization_positions_write on mobilization_positions;
drop policy if exists mobilization_positions_update on mobilization_positions;
drop policy if exists mobilization_positions_delete on mobilization_positions;
create policy mobilization_positions_select on mobilization_positions for select
  using ((org_id = my_org_id() and has_permission('mobilization.view')) or is_platform_admin());
create policy mobilization_positions_write on mobilization_positions for insert
  with check (org_id = my_org_id() and has_permission('mobilization.manage'));
create policy mobilization_positions_update on mobilization_positions for update
  using (
    org_id = my_org_id() and (
      has_permission('mobilization.manage')
      or has_permission('mobilization.compliance_review')
      or has_permission('mobilization.approve')
    )
  )
  with check (org_id = my_org_id());
create policy mobilization_positions_delete on mobilization_positions for delete
  using (org_id = my_org_id() and has_permission('mobilization.manage'));

alter table mobilization_position_history enable row level security;
drop policy if exists mobilization_position_history_select on mobilization_position_history;
drop policy if exists mobilization_position_history_write on mobilization_position_history;
create policy mobilization_position_history_select on mobilization_position_history for select
  using ((org_id = my_org_id() and has_permission('mobilization.view')) or is_platform_admin());
create policy mobilization_position_history_write on mobilization_position_history for insert
  with check (org_id = my_org_id() and has_permission('mobilization.manage'));
-- No update/delete policy — append-only audit trail, written by the
-- selectCandidate/replaceCandidate server actions.

alter table mobilization_status_history enable row level security;
drop policy if exists mobilization_status_history_select on mobilization_status_history;
create policy mobilization_status_history_select on mobilization_status_history for select
  using ((org_id = my_org_id() and has_permission('mobilization.view')) or is_platform_admin());
-- No write policy: only the trigger (security definer) inserts here.

alter table mobilization_comments enable row level security;
drop policy if exists mobilization_comments_select on mobilization_comments;
drop policy if exists mobilization_comments_write on mobilization_comments;
create policy mobilization_comments_select on mobilization_comments for select
  using ((org_id = my_org_id() and has_permission('mobilization.view')) or is_platform_admin());
create policy mobilization_comments_write on mobilization_comments for insert
  with check (org_id = my_org_id() and has_permission('mobilization.view'));
-- Comments are an append-only collaboration log, like the status
-- timeline — no update/delete policy.

-- ------------------------------------------------------------
-- 7. Number-range support for Mobilization codes (MOB00001, ...)
-- ------------------------------------------------------------

alter table number_range_configs drop constraint if exists number_range_configs_entity_type_check;
alter table number_range_configs add constraint number_range_configs_entity_type_check
  check (entity_type = any (array['client', 'contractor', 'contract', 'project', 'crew_matrix', 'mobilization']));

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

insert into number_range_configs (org_id, entity_type, prefix, padding_length, current_number)
select id, 'mobilization', 'MOB', 5, 0 from companies
on conflict (org_id, entity_type) do nothing;

-- ------------------------------------------------------------
-- 8. Permissions
-- ------------------------------------------------------------

insert into permissions (key, label, description) values
  ('mobilization.view', 'View mobilization requests', 'View mobilization/manpower planning requests, positions, and history'),
  ('mobilization.manage', 'Manage mobilization requests', 'Create and edit draft mobilization requests, generate/select/replace positions, confirm boarding'),
  ('mobilization.compliance_review', 'Run compliance review on mobilizations', 'Mark candidate positions compliance-cleared or flag compliance issues; move a request out of compliance review'),
  ('mobilization.approve', 'Approve mobilization requests', 'Give internal and client approval on a mobilization request'),
  ('mobilization.cancel', 'Cancel mobilization requests', 'Cancel a mobilization request at any stage'),
  ('mobilization.emergency_override', 'Emergency fast-track mobilizations', 'Skip the normal approval sequence for a priority=emergency mobilization request')
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_key)
select r.id, p.key
from roles r
join permissions p on p.key in (
  'mobilization.view', 'mobilization.manage', 'mobilization.compliance_review',
  'mobilization.approve', 'mobilization.cancel', 'mobilization.emergency_override'
)
where r.system_key = 'company_admin'
on conflict do nothing;

commit;
