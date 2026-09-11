-- ============================================================
-- ComplianceHub — Phase 4: Crew Readiness & Compliance Gate
--
-- Depends on Phase 3 (0003_phase3_mobilization.sql) — needs
-- mobilization_requests / mobilization_positions, and on the
-- existing crew_profiles / crew_skills / crew_documents /
-- crew_assignments / document_types / rotation_templates tables.
-- Run this whole file once, top to bottom, in the Supabase SQL
-- Editor. Safe to re-run.
--
-- Adds: readiness_snapshots (immutable, insert-only),
-- compliance_waivers, manual_assignment_overrides.
--
-- Design notes (flagged for review, see chat/project doc):
--  * No new permissions are added. The Phase 4 spec (unlike
--    Phases 1-3) has no "Permissions" section, so this reuses
--    Phase 3's mobilization.view/manage/compliance_review/approve/
--    emergency_override — readiness is evaluated and gated as part
--    of the same mobilization workflow those permissions already
--    govern. manual_assignment_overrides additionally requires
--    crew.manage (it's still a crew_assignments write).
--  * readiness_snapshots has NO update and NO delete policy at
--    all — not even for admins — so a historical snapshot can
--    never be altered once written (req. 3: "must never change
--    when master data changes later"). Only an insert policy and
--    a select policy exist.
--  * compliance_waivers.status starts 'pending' and is moved to
--    'approved'/'rejected' by a follow-up UPDATE (mobilization.
--    approve) rather than a separate decision table — matches the
--    lightweight single-row-with-status pattern used throughout
--    this app (contracts, crew matrices, mobilizations) instead of
--    a separate waiver_decisions table.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. Readiness snapshots — one row per (position, trigger point).
--    Immutable: insert + select only, never updated/deleted.
-- ------------------------------------------------------------

create table if not exists readiness_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  mobilization_position_id uuid not null references mobilization_positions(id) on delete cascade,
  mobilization_request_id uuid not null references mobilization_requests(id) on delete cascade,
  crew_id uuid not null references crew_profiles(id),
  trigger_point text not null
    check (trigger_point in (
      'internal_approval_sent', 'client_approval_sent',
      'ready_to_mobilize', 'boarding_confirmed'
    )),
  overall_outcome text not null
    check (overall_outcome in ('ready', 'ready_with_warning', 'not_ready', 'overridden')),
  checks jsonb not null,
  evaluated_at timestamptz not null default now(),
  evaluated_by uuid references auth.users(id)
);
create index if not exists readiness_snapshots_org_id_idx on readiness_snapshots(org_id);
create index if not exists readiness_snapshots_position_id_idx on readiness_snapshots(mobilization_position_id);
create index if not exists readiness_snapshots_request_id_idx on readiness_snapshots(mobilization_request_id);
create index if not exists readiness_snapshots_crew_id_idx on readiness_snapshots(crew_id);

-- ------------------------------------------------------------
-- 2. Compliance waivers — approved waivers let a specific
--    blocking check be bypassed for a specific position/crew.
-- ------------------------------------------------------------

create table if not exists compliance_waivers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  mobilization_position_id uuid not null references mobilization_positions(id) on delete cascade,
  crew_id uuid not null references crew_profiles(id),
  check_code text not null,
  requirement_description text,
  justification text not null,
  attachment_url text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by uuid references auth.users(id),
  requested_at timestamptz not null default now(),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  decision_note text,
  expires_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists compliance_waivers_org_id_idx on compliance_waivers(org_id);
create index if not exists compliance_waivers_position_id_idx on compliance_waivers(mobilization_position_id);
create index if not exists compliance_waivers_crew_id_idx on compliance_waivers(crew_id);
create index if not exists compliance_waivers_status_idx on compliance_waivers(status);

-- ------------------------------------------------------------
-- 3. Manual assignment override audit — every direct
--    crew_assignments write made through the restricted
--    emergency path (not originating from a mobilization
--    boarding confirmation) logs a row here.
-- ------------------------------------------------------------

create table if not exists manual_assignment_overrides (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  crew_id uuid not null references crew_profiles(id),
  offshore_site_id uuid not null references offshore_sites(id),
  crew_assignment_id uuid references crew_assignments(id),
  reason text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists manual_assignment_overrides_org_id_idx on manual_assignment_overrides(org_id);
create index if not exists manual_assignment_overrides_crew_id_idx on manual_assignment_overrides(crew_id);

-- ------------------------------------------------------------
-- 4. Row Level Security
-- ------------------------------------------------------------

alter table readiness_snapshots enable row level security;
alter table compliance_waivers enable row level security;
alter table manual_assignment_overrides enable row level security;

drop policy if exists readiness_snapshots_select on readiness_snapshots;
create policy readiness_snapshots_select on readiness_snapshots for select
  using ((org_id = my_org_id() and has_permission('mobilization.view')) or is_platform_admin());

drop policy if exists readiness_snapshots_insert on readiness_snapshots;
create policy readiness_snapshots_insert on readiness_snapshots for insert
  with check (
    org_id = my_org_id() and (
      has_permission('mobilization.manage')
      or has_permission('mobilization.compliance_review')
      or has_permission('mobilization.approve')
    )
  );
-- Deliberately no update / delete policy — snapshots are permanent.

drop policy if exists compliance_waivers_select on compliance_waivers;
create policy compliance_waivers_select on compliance_waivers for select
  using ((org_id = my_org_id() and has_permission('mobilization.view')) or is_platform_admin());

drop policy if exists compliance_waivers_insert on compliance_waivers;
create policy compliance_waivers_insert on compliance_waivers for insert
  with check (
    org_id = my_org_id() and (
      has_permission('mobilization.manage') or has_permission('mobilization.compliance_review')
    )
  );

drop policy if exists compliance_waivers_update on compliance_waivers;
create policy compliance_waivers_update on compliance_waivers for update
  using (org_id = my_org_id() and (has_permission('mobilization.approve') or has_permission('mobilization.manage')));
-- Broad RLS backstop (matches the rest of this app) — server actions
-- narrow this further: only mobilization.approve can move status to
-- approved/rejected, mobilization.manage can only cancel a still-
-- pending request of its own.

drop policy if exists manual_assignment_overrides_select on manual_assignment_overrides;
create policy manual_assignment_overrides_select on manual_assignment_overrides for select
  using ((org_id = my_org_id() and has_permission('crew.manage')) or is_platform_admin());

drop policy if exists manual_assignment_overrides_insert on manual_assignment_overrides;
create policy manual_assignment_overrides_insert on manual_assignment_overrides for insert
  with check (
    org_id = my_org_id() and has_permission('crew.manage') and has_permission('mobilization.emergency_override')
  );

commit;
