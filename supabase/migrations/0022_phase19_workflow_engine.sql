-- ============================================================
-- ComplianceHub — Phase 19: Configurable Approval Workflow Engine
--
-- Depends on Phase 2 (0002_phase2_crew_matrix.sql — crew_matrices) and
-- the base RBAC schema (0001 — permissions, roles, role_permissions,
-- has_permission(), my_org_id(), is_platform_admin()). Run this whole
-- file once, top to bottom, in the Supabase SQL Editor. Safe to re-run
-- (every step guards itself with "if not exists" / "on conflict do
-- nothing" / a "do $$ ... if not exists $$" backfill block).
--
-- Adds: workflow_definitions, workflow_stages, workflow_instances,
-- workflow_instance_stages, workflow_instance_events, workflow_can_act().
-- Extends: crew_matrices (status check gets a new 'pending_approval'
-- value; its update RLS policy gets an extra OR branch), permissions
-- (adds 'workflows.manage').
--
-- Design (locked in with the user — see chat, AskUserQuestion answers):
--  * Scope for now: crew_matrix only. The engine itself is entity-type
--    agnostic (every table is keyed by entity_type/entity_id, not by
--    crew_matrix specifically) so a second document type is a data
--    change (insert a workflow_definitions row), not a schema change.
--  * Approver assignment: by permission/role. Each stage names a
--    required_permission (any key from the `permissions` table) —
--    whoever's role holds it can act on that stage. No named-approver
--    list, no per-instance routing.
--  * Config granularity: ONE active template per (org, entity_type) —
--    not multiple named templates picked per instance. A definition's
--    stages are an ordered list (1..N); 0 stages means "auto-approve
--    on submit" for that document type.
--  * Backward compatibility: the OLD hardcoded 2-stage pipeline
--    (crew_matrices.status walking draft -> pending_internal_approval
--    -> pending_client_approval -> approved via submitForApproval /
--    approveInternal / rejectInternal / returnForCorrection /
--    approveClient / rejectClient in app/crew/matrices/actions.ts)
--    is NOT touched or removed — those functions and both pending_*
--    statuses stay exactly as they are, so any crew matrix already
--    mid-approval when this ships keeps running on the old code path
--    to completion. Every NEW submission (app-side change, not in this
--    migration) instead starts a workflow_instance and lands in the
--    new 'pending_approval' status, walking through however many
--    stages the org's active template defines. The backfill below
--    gives every existing company a 2-stage template (Internal
--    Approval -> crew.matrix.approve_internal, then Client Approval ->
--    crew.matrix.approve_client, skipped automatically when no line
--    requires client approval) that reproduces today's default
--    behavior exactly, so nothing changes for an org that never opens
--    the new Approval Workflows admin screen.
--  * workflow_instance_stages is a SNAPSHOT of workflow_stages taken
--    when the instance starts (submit time) — editing the template
--    later never reaches back into an in-flight approval.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. crew_matrices — add the new generic-engine status.
-- ------------------------------------------------------------

alter table crew_matrices drop constraint if exists crew_matrices_status_check;
alter table crew_matrices add constraint crew_matrices_status_check
  check (status in (
    'draft', 'pending_internal_approval', 'pending_client_approval', 'pending_approval',
    'approved', 'active', 'superseded', 'rejected', 'cancelled'
  ));

-- ------------------------------------------------------------
-- 2. workflow_definitions — one active template per (org, entity_type).
-- ------------------------------------------------------------

create table if not exists workflow_definitions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  entity_type text not null,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
create index if not exists workflow_definitions_org_idx on workflow_definitions(org_id);
-- "One template per document type" is a locked design decision, not
-- just a UI convention — enforced here too.
create unique index if not exists workflow_definitions_one_active_idx
  on workflow_definitions(org_id, entity_type) where is_active;

-- ------------------------------------------------------------
-- 3. workflow_stages — the ordered stage list a definition is made of.
-- ------------------------------------------------------------

create table if not exists workflow_stages (
  id uuid primary key default gen_random_uuid(),
  workflow_definition_id uuid not null references workflow_definitions(id) on delete cascade,
  org_id uuid not null references companies(id) on delete cascade,
  sequence integer not null,
  name text not null,
  required_permission text not null,
  -- Free text; only one literal is understood by the engine in v1 (see
  -- lib/workflow.ts's evaluateSkipCondition): 'no_lines_require_client_
  -- approval' for entity_type='crew_matrix', which reproduces the old
  -- approveInternal()'s "skip client stage if nothing needs it" check.
  -- An unrecognized/blank value is simply never skipped.
  skip_condition text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists workflow_stages_def_seq_idx on workflow_stages(workflow_definition_id, sequence);
create index if not exists workflow_stages_org_idx on workflow_stages(org_id);

-- ------------------------------------------------------------
-- 4. workflow_instances — one per (entity_type, entity_id) approval run.
--    current_stage_id references workflow_instance_stages, created next
--    — the column is added by ALTER after that table exists.
-- ------------------------------------------------------------

create table if not exists workflow_instances (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  workflow_definition_id uuid references workflow_definitions(id),
  status text not null default 'in_progress'
    check (status in ('in_progress', 'approved', 'rejected', 'cancelled')),
  started_by uuid references auth.users(id),
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists workflow_instances_org_idx on workflow_instances(org_id);
create index if not exists workflow_instances_entity_idx on workflow_instances(entity_type, entity_id);
-- Only one in-progress run per entity at a time.
create unique index if not exists workflow_instances_one_active_idx
  on workflow_instances(entity_type, entity_id) where status = 'in_progress';

-- ------------------------------------------------------------
-- 5. workflow_instance_stages — snapshot of workflow_stages, one row
--    per stage, taken at the moment the instance starts.
--    entity_type/entity_id are denormalized here (not just reachable
--    via workflow_instance_id) so both this table's own RLS and
--    workflow_can_act() below can filter without an extra join.
-- ------------------------------------------------------------

create table if not exists workflow_instance_stages (
  id uuid primary key default gen_random_uuid(),
  workflow_instance_id uuid not null references workflow_instances(id) on delete cascade,
  org_id uuid not null references companies(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  sequence integer not null,
  name text not null,
  required_permission text not null,
  skip_condition text,
  status text not null default 'pending'
    check (status in ('pending', 'skipped', 'approved', 'rejected')),
  acted_by uuid references auth.users(id),
  acted_at timestamptz,
  comment text
);
create unique index if not exists workflow_instance_stages_inst_seq_idx on workflow_instance_stages(workflow_instance_id, sequence);
create index if not exists workflow_instance_stages_entity_idx on workflow_instance_stages(entity_type, entity_id);

alter table workflow_instances add column if not exists current_stage_id uuid references workflow_instance_stages(id);

-- ------------------------------------------------------------
-- 6. workflow_instance_events — append-only audit trail (mirrors the
--    *_status_history convention used elsewhere, e.g. crew_matrix_
--    status_history in 0002), but populated by the app directly
--    rather than a trigger, since one instance can log several event
--    types without its own status column changing every time.
-- ------------------------------------------------------------

create table if not exists workflow_instance_events (
  id uuid primary key default gen_random_uuid(),
  workflow_instance_id uuid not null references workflow_instances(id) on delete cascade,
  org_id uuid not null references companies(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  event_type text not null
    check (event_type in ('started', 'stage_approved', 'stage_rejected', 'stage_skipped', 'returned', 'completed', 'cancelled')),
  stage_name text,
  actor_id uuid references auth.users(id),
  comment text,
  created_at timestamptz not null default now()
);
create index if not exists workflow_instance_events_instance_idx on workflow_instance_events(workflow_instance_id);
create index if not exists workflow_instance_events_entity_idx on workflow_instance_events(entity_type, entity_id);

-- ------------------------------------------------------------
-- 7. workflow_can_act() — "does the calling user hold the permission
--    named by this entity's CURRENT in-progress stage". security
--    definer so it can read across workflow_instances/workflow_
--    instance_stages regardless of the caller's own RLS grants on
--    those tables (same convention as has_permission() itself), and
--    to let this be referenced FROM another table's RLS policy
--    (crew_matrices_update, below) without that policy needing its
--    own join into the workflow tables.
-- ------------------------------------------------------------

create or replace function workflow_can_act(p_entity_type text, p_entity_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from workflow_instances wi
    join workflow_instance_stages wis on wis.id = wi.current_stage_id
    where wi.entity_type = p_entity_type
      and wi.entity_id = p_entity_id
      and wi.status = 'in_progress'
      and wi.org_id = my_org_id()
      and has_permission(wis.required_permission)
  );
$$;

-- ------------------------------------------------------------
-- 8. RLS.
-- ------------------------------------------------------------

alter table workflow_definitions enable row level security;
alter table workflow_stages enable row level security;
alter table workflow_instances enable row level security;
alter table workflow_instance_stages enable row level security;
alter table workflow_instance_events enable row level security;

-- Definitions/stages are just config — readable by anyone in the org
-- (it's what governs their own approvals, no reason to hide it from
-- non-admins), writable only by workflows.manage.
drop policy if exists workflow_definitions_select on workflow_definitions;
create policy workflow_definitions_select on workflow_definitions for select
  using ((org_id = my_org_id()) or is_platform_admin());
drop policy if exists workflow_definitions_write on workflow_definitions;
create policy workflow_definitions_write on workflow_definitions for insert
  with check (org_id = my_org_id() and has_permission('workflows.manage'));
drop policy if exists workflow_definitions_update on workflow_definitions;
create policy workflow_definitions_update on workflow_definitions for update
  using (org_id = my_org_id() and has_permission('workflows.manage'))
  with check (org_id = my_org_id());
drop policy if exists workflow_definitions_delete on workflow_definitions;
create policy workflow_definitions_delete on workflow_definitions for delete
  using (org_id = my_org_id() and has_permission('workflows.manage'));

drop policy if exists workflow_stages_select on workflow_stages;
create policy workflow_stages_select on workflow_stages for select
  using ((org_id = my_org_id()) or is_platform_admin());
drop policy if exists workflow_stages_write on workflow_stages;
create policy workflow_stages_write on workflow_stages for insert
  with check (org_id = my_org_id() and has_permission('workflows.manage'));
drop policy if exists workflow_stages_update on workflow_stages;
create policy workflow_stages_update on workflow_stages for update
  using (org_id = my_org_id() and has_permission('workflows.manage'))
  with check (org_id = my_org_id());
drop policy if exists workflow_stages_delete on workflow_stages;
create policy workflow_stages_delete on workflow_stages for delete
  using (org_id = my_org_id() and has_permission('workflows.manage'));

-- Instances/instance stages/events: scoped for now to whoever could
-- already touch the underlying document (crew.matrix.* permissions),
-- plus workflows.manage. This mirrors crew_matrices_update (0002)
-- rather than trying to be generic across future entity types —
-- revisit when a second entity type is actually wired up.
drop policy if exists workflow_instances_select on workflow_instances;
create policy workflow_instances_select on workflow_instances for select
  using (
    (org_id = my_org_id() and (has_permission('crew.matrix.view') or has_permission('workflows.manage')))
    or is_platform_admin()
  );
drop policy if exists workflow_instances_write on workflow_instances;
create policy workflow_instances_write on workflow_instances for insert
  with check (
    org_id = my_org_id()
    and (has_permission('crew.matrix.submit') or has_permission('crew.matrix.manage') or has_permission('workflows.manage'))
  );
drop policy if exists workflow_instances_update on workflow_instances;
create policy workflow_instances_update on workflow_instances for update
  using (
    org_id = my_org_id()
    and (
      has_permission('crew.matrix.manage')
      or has_permission('crew.matrix.approve_internal')
      or has_permission('crew.matrix.approve_client')
      or has_permission('workflows.manage')
      or workflow_can_act(entity_type, entity_id)
    )
  )
  with check (org_id = my_org_id());

drop policy if exists workflow_instance_stages_select on workflow_instance_stages;
create policy workflow_instance_stages_select on workflow_instance_stages for select
  using (
    (org_id = my_org_id() and (has_permission('crew.matrix.view') or has_permission('workflows.manage')))
    or is_platform_admin()
  );
drop policy if exists workflow_instance_stages_write on workflow_instance_stages;
create policy workflow_instance_stages_write on workflow_instance_stages for insert
  with check (
    org_id = my_org_id()
    and (has_permission('crew.matrix.submit') or has_permission('crew.matrix.manage') or has_permission('workflows.manage'))
  );
drop policy if exists workflow_instance_stages_update on workflow_instance_stages;
create policy workflow_instance_stages_update on workflow_instance_stages for update
  using (
    org_id = my_org_id()
    and (
      has_permission('crew.matrix.manage')
      or has_permission('crew.matrix.approve_internal')
      or has_permission('crew.matrix.approve_client')
      or has_permission('workflows.manage')
      or workflow_can_act(entity_type, entity_id)
    )
  )
  with check (org_id = my_org_id());

drop policy if exists workflow_instance_events_select on workflow_instance_events;
create policy workflow_instance_events_select on workflow_instance_events for select
  using (
    (org_id = my_org_id() and (has_permission('crew.matrix.view') or has_permission('workflows.manage')))
    or is_platform_admin()
  );
drop policy if exists workflow_instance_events_write on workflow_instance_events;
create policy workflow_instance_events_write on workflow_instance_events for insert
  with check (
    org_id = my_org_id()
    and (
      has_permission('crew.matrix.submit')
      or has_permission('crew.matrix.manage')
      or has_permission('crew.matrix.approve_internal')
      or has_permission('crew.matrix.approve_client')
      or has_permission('workflows.manage')
    )
  );
-- No update/delete policy — this log is append-only, same convention
-- as crew_matrix_status_history.

-- ------------------------------------------------------------
-- 9. crew_matrices_update — widen to also allow whoever holds the
--    permission named by the CURRENT stage of an in-progress generic
--    workflow instance on this matrix (new stage names, e.g. a
--    reviewer-only "Technical Review" stage an org adds later, aren't
--    necessarily one of the four permissions already listed here).
-- ------------------------------------------------------------

drop policy if exists crew_matrices_update on crew_matrices;
create policy crew_matrices_update on crew_matrices for update
  using (
    org_id = my_org_id()
    and (
      has_permission('crew.matrix.manage')
      or has_permission('crew.matrix.submit')
      or has_permission('crew.matrix.approve_internal')
      or has_permission('crew.matrix.approve_client')
      or has_permission('workflows.manage')
      or workflow_can_act('crew_matrix', id)
    )
  )
  with check (org_id = my_org_id());

-- ------------------------------------------------------------
-- 10. New permission: workflows.manage.
-- ------------------------------------------------------------

insert into permissions (key, label, description) values
  ('workflows.manage', 'Manage approval workflows', 'Configure the ordered approval stages used when documents (starting with crew matrices) are submitted for approval, and which permission unlocks each stage')
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_key)
select r.id, p.key from roles r join permissions p on p.key = 'workflows.manage'
where r.system_key = 'company_admin'
on conflict do nothing;

-- ------------------------------------------------------------
-- 11. Backfill — give every existing company a default Crew Matrix
--     template that exactly reproduces today's hardcoded behavior, so
--     nothing changes for an org that never opens the new admin screen.
-- ------------------------------------------------------------

do $$
declare
  co record;
  new_def_id uuid;
begin
  for co in select id from companies loop
    if not exists (
      select 1 from workflow_definitions
      where org_id = co.id and entity_type = 'crew_matrix' and is_active
    ) then
      insert into workflow_definitions (org_id, entity_type, name, is_active)
      values (co.id, 'crew_matrix', 'Crew Matrix Approval', true)
      returning id into new_def_id;

      insert into workflow_stages (workflow_definition_id, org_id, sequence, name, required_permission, skip_condition)
      values
        (new_def_id, co.id, 1, 'Internal Approval', 'crew.matrix.approve_internal', null),
        (new_def_id, co.id, 2, 'Client Approval', 'crew.matrix.approve_client', 'no_lines_require_client_approval');
    end if;
  end loop;
end $$;

commit;
