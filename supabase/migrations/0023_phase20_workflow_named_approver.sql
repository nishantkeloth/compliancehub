-- ============================================================
-- ComplianceHub — Phase 20: Named-user approver on workflow stages
--
-- Depends on Phase 19 (0022_phase19_workflow_engine.sql). Run this
-- whole file once, top to bottom, in the Supabase SQL Editor. Safe to
-- re-run (guarded "add column if not exists" / "drop constraint if
-- exists" throughout).
--
-- Extends workflow_stages / workflow_instance_stages with an
-- approver_type ('permission' | 'user') and approver_user_id, so a
-- stage in the Approval Workflows admin screen can be assigned either
-- to "whoever holds this permission" (the original design) or to one
-- specific named person — the user's explicit follow-up request after
-- the engine shipped. required_permission is now nullable (only
-- required when approver_type = 'permission'); a check constraint
-- keeps exactly one of required_permission/approver_user_id set,
-- matching approver_type.
--
-- Every existing row defaults to approver_type = 'permission' with its
-- existing required_permission untouched and approver_user_id null —
-- already satisfies the new check constraint, so no backfill needed.
--
-- workflow_can_act() (used by crew_matrices_update's RLS policy and by
-- workflow_instances/workflow_instance_stages' own update policies) is
-- widened the same way: true when the caller IS the named approver
-- (approver_type = 'user'), or holds the named permission
-- (approver_type = 'permission'), exactly as before.
-- ============================================================

begin;

alter table workflow_stages
  add column if not exists approver_type text not null default 'permission'
    check (approver_type in ('permission', 'user')),
  add column if not exists approver_user_id uuid references auth.users(id);

alter table workflow_stages alter column required_permission drop not null;

alter table workflow_stages drop constraint if exists workflow_stages_approver_shape;
alter table workflow_stages add constraint workflow_stages_approver_shape
  check (
    (approver_type = 'permission' and required_permission is not null and approver_user_id is null)
    or (approver_type = 'user' and approver_user_id is not null and required_permission is null)
  );

alter table workflow_instance_stages
  add column if not exists approver_type text not null default 'permission'
    check (approver_type in ('permission', 'user')),
  add column if not exists approver_user_id uuid references auth.users(id);

alter table workflow_instance_stages alter column required_permission drop not null;

alter table workflow_instance_stages drop constraint if exists workflow_instance_stages_approver_shape;
alter table workflow_instance_stages add constraint workflow_instance_stages_approver_shape
  check (
    (approver_type = 'permission' and required_permission is not null and approver_user_id is null)
    or (approver_type = 'user' and approver_user_id is not null and required_permission is null)
  );

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
      and (
        (wis.approver_type = 'user' and wis.approver_user_id = auth.uid())
        or (wis.approver_type = 'permission' and has_permission(wis.required_permission))
      )
  );
$$;

commit;
