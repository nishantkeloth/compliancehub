-- ============================================================
-- ComplianceHub — Phase 12: Configurable per-client mobilization
-- checklist & manifest module
--
-- Depends on Phase 3 (0003_phase3_mobilization.sql), Phase 6
-- (0006_phase6_boarding_rotation_demob.sql), and Phase 11
-- (0018_client_contacts_and_matrix_sharing.sql). Run this whole file
-- once, top to bottom, in the Supabase SQL Editor. Safe to re-run.
--
-- Adds: mobilization_tracks, mobilization_checklist_items (template,
-- per track), mobilization_position_checklist_items (per-position
-- instances).
-- Extends: mobilization_positions (mobilization_track_id),
-- boarding_confirmations (join_method), crew_matrix_share_packages
-- (+ crew_matrix_share_staff) to also carry a mobilization-scoped
-- Crew Change Manifest alongside the existing whole-matrix share.
--
-- Design notes (see claude/phase12-adnoc-mobilization-flow-scope.md):
--  * Deliberately client-agnostic. Nothing here names ADNOC, T-BOSIET,
--    CICPA, or any other client-specific term — those are all just
--    data an admin enters through the new Mobilization Tracks screen.
--    A track's client_id is nullable so an org-wide fallback track
--    (no client configured yet) is possible.
--  * A checklist item's due date is computed from one of: the
--    mobilization's request_created_at, its required_onboard_date, or
--    another checklist item in the same track finishing
--    (due_relative_item_id + due_offset_days) — this reproduces "Day 5
--    from arrival" or "10 days after the exam" without a fixed enum of
--    named business milestones that would need a migration every time
--    a new client's process has a differently-named trigger event.
--  * Per-position checklist items are a COPY of the track's template
--    items at the moment a track is assigned to a position, not a live
--    reference — editing a client's template later never silently
--    changes a checklist already in progress for someone currently
--    mobilizing.
--  * The Crew Change Manifest reuses Phase 11's share tables rather
--    than duplicating the email/token/history plumbing:
--    crew_matrix_id becomes nullable, a new mobilization_request_id
--    column is added, and a check constraint requires exactly one of
--    the two to be set. "Sharing History" becomes one shared surface
--    for both a whole-matrix share and an event-specific manifest.
--  * No new permissions. Track/template configuration and per-position
--    checklist actions reuse mobilization.manage (the same permission
--    that already gates every other mobilization write). Manifest
--    sending reuses crew.matrix.share, since it's the exact same
--    RLS-protected tables Phase 11 already built.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. Mobilization tracks — one per client (or client_id null for an
--    org-wide default/fallback track), e.g. "New Joiner" / "Returning
--    Crew" for ADNOC, but the names and count are entirely up to the
--    admin configuring them.
-- ------------------------------------------------------------

create table if not exists mobilization_tracks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  client_id uuid references clients(id) on delete cascade,
  name text not null,
  description text,
  notice_days_override integer,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists mobilization_tracks_org_idx on mobilization_tracks(org_id);
create index if not exists mobilization_tracks_client_idx on mobilization_tracks(client_id);

-- ------------------------------------------------------------
-- 2. Checklist template items — the ordered steps of one track, as
--    configured by an admin. due_basis + due_offset_days (+
--    due_relative_item_id when due_basis = 'relative_to_item') is what
--    reproduces "Day 5/6 from arrival" or "10 days after the exam
--    step" for any client's process, not just ADNOC's.
-- ------------------------------------------------------------

create table if not exists mobilization_checklist_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  track_id uuid not null references mobilization_tracks(id) on delete cascade,
  sequence integer not null default 1,
  title text not null,
  description text,
  is_parallel boolean not null default false,
  due_basis text not null default 'request_created'
    check (due_basis in ('request_created', 'required_onboard_date', 'relative_to_item')),
  due_offset_days integer not null default 0,
  due_relative_item_id uuid references mobilization_checklist_items(id) on delete set null,
  linked_document_type_id uuid references document_types(id) on delete set null,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mobilization_checklist_items_relative_needs_target
    check (due_basis <> 'relative_to_item' or due_relative_item_id is not null)
);
create index if not exists mobilization_checklist_items_org_idx on mobilization_checklist_items(org_id);
create index if not exists mobilization_checklist_items_track_idx on mobilization_checklist_items(track_id);

-- ------------------------------------------------------------
-- 3. Per-position checklist instances — a copy of the track's items,
--    made the moment a track is assigned to a mobilization position.
--    due_relative_item_id here self-references another INSTANCE row
--    (not the template item), so completing one position's step never
--    touches another position's checklist.
-- ------------------------------------------------------------

create table if not exists mobilization_position_checklist_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  mobilization_position_id uuid not null references mobilization_positions(id) on delete cascade,
  source_item_id uuid references mobilization_checklist_items(id) on delete set null,
  sequence integer not null default 1,
  title text not null,
  description text,
  is_parallel boolean not null default false,
  due_basis text not null default 'request_created'
    check (due_basis in ('request_created', 'required_onboard_date', 'relative_to_item')),
  due_offset_days integer not null default 0,
  due_relative_item_id uuid references mobilization_position_checklist_items(id) on delete set null,
  due_date date,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'done', 'blocked')),
  completed_at timestamptz,
  completed_by uuid references auth.users(id),
  linked_document_type_id uuid references document_types(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
create index if not exists mob_position_checklist_items_org_idx on mobilization_position_checklist_items(org_id);
create index if not exists mob_position_checklist_items_position_idx on mobilization_position_checklist_items(mobilization_position_id);

-- ------------------------------------------------------------
-- 4. mobilization_positions — which track a candidate follows.
-- ------------------------------------------------------------

alter table mobilization_positions add column if not exists mobilization_track_id uuid references mobilization_tracks(id) on delete set null;

-- ------------------------------------------------------------
-- 5. boarding_confirmations — how the crew member actually joined.
--    Generic across every client (not part of the per-client
--    configuration system), so a plain fixed field is fine here.
-- ------------------------------------------------------------

alter table boarding_confirmations add column if not exists join_method text
  check (join_method in ('direct_port', 'crew_boat_transfer'));

-- ------------------------------------------------------------
-- 6. Crew Change Manifest — extend Phase 11's share tables rather than
--    duplicating them. A package now snapshots either a whole crew
--    matrix (existing behaviour) or one mobilization's positions (new)
--    — never both.
-- ------------------------------------------------------------

alter table crew_matrix_share_packages alter column crew_matrix_id drop not null;
alter table crew_matrix_share_packages add column if not exists mobilization_request_id uuid references mobilization_requests(id) on delete cascade;
alter table crew_matrix_share_packages add column if not exists mobilization_number_snapshot text;
alter table crew_matrix_share_packages add column if not exists manifest_confirmed_at timestamptz;
alter table crew_matrix_share_packages add column if not exists manifest_confirmed_reference text;

alter table crew_matrix_share_packages drop constraint if exists crew_matrix_share_packages_one_source;
alter table crew_matrix_share_packages add constraint crew_matrix_share_packages_one_source
  check ((crew_matrix_id is not null) <> (mobilization_request_id is not null));

create index if not exists crew_matrix_share_packages_mobilization_idx on crew_matrix_share_packages(mobilization_request_id);

-- crew_matrix_share_staff.share_package_id already carries every row we
-- need for a manifest recipient's page (one row per crew member, same
-- staff_snapshot_json shape) — no schema change needed there. A
-- manifest simply won't have crew_matrix_share_documents rows unless a
-- future increment wants per-document detail on the manifest too.

-- ------------------------------------------------------------
-- 7. Row Level Security — same broad-RLS/narrow-server-action division
--    as every other mobilization table. Tracks/templates are
--    configuration, so both read and write are gated on
--    mobilization.manage (view-only users don't need to see the raw
--    template list — the resolved checklist on a position they can
--    already see is what matters to them). Per-position checklist
--    instances follow mobilization_positions' own split: anyone who
--    can view mobilization positions can see their checklist; changing
--    status/track requires mobilization.manage.
-- ------------------------------------------------------------

alter table mobilization_tracks enable row level security;
drop policy if exists mobilization_tracks_select on mobilization_tracks;
drop policy if exists mobilization_tracks_write on mobilization_tracks;
create policy mobilization_tracks_select on mobilization_tracks for select
  using ((org_id = my_org_id() and has_permission('mobilization.manage')) or is_platform_admin());
create policy mobilization_tracks_write on mobilization_tracks for all
  using (org_id = my_org_id() and has_permission('mobilization.manage'))
  with check (org_id = my_org_id() and has_permission('mobilization.manage'));

alter table mobilization_checklist_items enable row level security;
drop policy if exists mobilization_checklist_items_select on mobilization_checklist_items;
drop policy if exists mobilization_checklist_items_write on mobilization_checklist_items;
create policy mobilization_checklist_items_select on mobilization_checklist_items for select
  using ((org_id = my_org_id() and has_permission('mobilization.manage')) or is_platform_admin());
create policy mobilization_checklist_items_write on mobilization_checklist_items for all
  using (org_id = my_org_id() and has_permission('mobilization.manage'))
  with check (org_id = my_org_id() and has_permission('mobilization.manage'));

alter table mobilization_position_checklist_items enable row level security;
drop policy if exists mob_position_checklist_items_select on mobilization_position_checklist_items;
drop policy if exists mob_position_checklist_items_write on mobilization_position_checklist_items;
create policy mob_position_checklist_items_select on mobilization_position_checklist_items for select
  using ((org_id = my_org_id() and has_permission('mobilization.view')) or is_platform_admin());
create policy mob_position_checklist_items_write on mobilization_position_checklist_items for all
  using (org_id = my_org_id() and has_permission('mobilization.manage'))
  with check (org_id = my_org_id() and has_permission('mobilization.manage'));

commit;
