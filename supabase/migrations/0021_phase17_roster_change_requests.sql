-- ============================================================
-- ComplianceHub — Phase 17: Roster Change Requests (approval +
-- expanding status timeline for an active crew matrix)
--
-- Depends on Phase 2 (0002_phase2_crew_matrix.sql — crew_matrices,
-- crew_matrix_status_history), Phase 6 (0006_phase6_boarding_rotation_
-- demob.sql — crew_assignments) and Phase 18's sharing tables
-- (0018_client_contacts_and_matrix_sharing.sql — crew_matrix_share_
-- packages). Run this whole file once, top to bottom, in the Supabase
-- SQL Editor. Safe to re-run.
--
-- Context: the crew matrix is a living document — once it's Active and
-- has been sent to the client, every further assign/replace/unassign on
-- it needs (a) a mandatory reason before it's even submitted, (b) an
-- internal approval step before it takes effect, and (c) to show up as
-- one more entry on an ever-growing status timeline that always
-- continues from wherever the matrix last stood — never a rerun of the
-- original Draft → Submitted → Internal approval → Client approval →
-- Activated pipeline (that pipeline stays exactly as-is, untouched by
-- this migration, and still governs how a matrix reaches Active in the
-- first place).
--
-- Deliberately a NEW table, not an extension of the existing
-- crew_change_requests (Phase 6, see 0006). That table is a different,
-- already-built-and-used feature: an operational crew swap on a live
-- offshore rotation, raised from the Rotations module, tied to a single
-- crew_assignment, carrying reliever readiness checks and an emergency-
-- override path, approved under mobilization.approve. This table is
-- matrix-scoped instead — every request ties back to a crew_matrix (and
-- usually a crew_matrix_line), drives the matrix's own timeline, and is
-- approved under the same crew.matrix.approve_internal permission that
-- already gates internal approval on the matrix itself. The two tables
-- can end up describing the same physical person-swap from two
-- different angles; that's fine — they answer different questions
-- ("is this vessel's rotation swap ready" vs. "is this client-facing
-- matrix's roster change ready"), and neither writes to the other.
--
-- Adds: roster_change_requests, roster_change_request_status_history.
-- Extends: crew_assignments (adds roster_change_request_id, so an
-- applied change can be traced back to the request that authorized it).
--
-- Design:
--  * change_type is 'assign' (new line filled, no one leaving),
--    'replace' (one person out, another in on the same line/role) or
--    'unassign' (person leaves, line goes vacant). outgoing_crew_id is
--    required for replace/unassign; incoming_crew_id is required for
--    assign/replace — enforced by a check constraint below.
--  * reason_code is a short fixed set (mirrors the reason dropdown
--    already confirmed with the client) plus reason_notes for anything
--    free-text. Both optional-vs-required is enforced in the server
--    action, not here — reason_code not-null is enough at the DB layer.
--  * status starts 'pending_approval'; only ever moves to 'approved',
--    'rejected' or 'cancelled' (requester withdrawing before decision).
--    'approved' does NOT itself touch crew_assignments — the server
--    action that records the approval applies the change in the same
--    transaction-ish sequence and stamps the resulting/closed
--    crew_assignments row with roster_change_request_id, exactly the
--    way boarding_confirmation_id/signoff_confirmation_id already trace
--    crew_assignments back to Phase 6's boarding/sign-off flows.
--  * roster_change_request_status_history + its trigger mirror
--    crew_matrix_status_history / crew_change_request_status_history
--    exactly (see 0002 and 0006) — this is the per-request audit trail;
--    the matrix-wide expanding timeline in the app merges this with
--    crew_matrix_status_history and crew_matrix_share_packages sends,
--    it isn't a new source of truth on its own.
--  * No new permissions. Requesting a change reuses crew.manage — the
--    same permission that already gates every direct assign/unassign
--    on the Staffing Plan (see staffing-actions.ts), so anyone who
--    could make the change outright before can still request it now.
--    Deciding (approve/reject) reuses crew.matrix.approve_internal —
--    the same permission that already gates internal approval on the
--    matrix itself, so "who can sign off on this matrix" stays a
--    single answer whether it's the original version or a later
--    roster change.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. roster_change_requests
-- ------------------------------------------------------------

create table if not exists roster_change_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  crew_matrix_id uuid not null references crew_matrices(id) on delete cascade,
  crew_matrix_line_id uuid references crew_matrix_lines(id) on delete set null,
  change_type text not null check (change_type in ('assign', 'replace', 'unassign')),
  outgoing_crew_id uuid references crew_profiles(id),
  incoming_crew_id uuid references crew_profiles(id),
  effective_date date not null,
  reason_code text not null
    check (reason_code in (
      'rotation_ended', 'sick_leave', 'performance_conduct',
      'client_request', 'headcount_change', 'other'
    )),
  reason_notes text,
  status text not null default 'pending_approval'
    check (status in ('pending_approval', 'approved', 'rejected', 'cancelled')),
  requested_by uuid references auth.users(id),
  requested_at timestamptz not null default now(),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  decision_comment text,
  applied_assignment_id uuid references crew_assignments(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roster_change_requests_outgoing_required
    check (change_type = 'assign' or outgoing_crew_id is not null),
  constraint roster_change_requests_incoming_required
    check (change_type = 'unassign' or incoming_crew_id is not null)
);
create index if not exists roster_change_requests_org_idx on roster_change_requests(org_id);
create index if not exists roster_change_requests_matrix_idx on roster_change_requests(crew_matrix_id);
create index if not exists roster_change_requests_status_idx on roster_change_requests(status);
create index if not exists roster_change_requests_pending_idx on roster_change_requests(crew_matrix_id) where status = 'pending_approval';

alter table roster_change_requests enable row level security;

drop policy if exists roster_change_requests_select on roster_change_requests;
create policy roster_change_requests_select on roster_change_requests for select
  using (org_id = my_org_id() and has_permission('crew.manage'));

drop policy if exists roster_change_requests_insert on roster_change_requests;
create policy roster_change_requests_insert on roster_change_requests for insert
  with check (org_id = my_org_id() and has_permission('crew.manage'));

-- Update covers both the requester cancelling their own pending request
-- and an approver deciding it — the server actions enforce which of
-- those a given caller is allowed to do (status transition + who set
-- decided_by), RLS just gates "is this person allowed to touch roster
-- change requests for this matrix at all", same convention as
-- crew_matrix_share_packages_update (0018) and crew_matrices_write
-- (0002).
drop policy if exists roster_change_requests_update on roster_change_requests;
create policy roster_change_requests_update on roster_change_requests for update
  using (org_id = my_org_id() and (has_permission('crew.manage') or has_permission('crew.matrix.approve_internal')))
  with check (org_id = my_org_id() and (has_permission('crew.manage') or has_permission('crew.matrix.approve_internal')));

-- ------------------------------------------------------------
-- 2. roster_change_request_status_history — audit trail, mirrors
--    crew_change_request_status_history (0006) exactly.
-- ------------------------------------------------------------

create table if not exists roster_change_request_status_history (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  roster_change_request_id uuid not null references roster_change_requests(id) on delete cascade,
  old_status text,
  new_status text not null,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now(),
  comment text
);
create index if not exists roster_change_request_status_history_req_idx on roster_change_request_status_history(roster_change_request_id);

create or replace function log_roster_change_request_status()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if tg_op = 'INSERT' then
    insert into roster_change_request_status_history (roster_change_request_id, org_id, old_status, new_status, changed_by)
    values (new.id, new.org_id, null, new.status, auth.uid());
  elsif new.status is distinct from old.status then
    insert into roster_change_request_status_history (roster_change_request_id, org_id, old_status, new_status, changed_by, comment)
    values (new.id, new.org_id, old.status, new.status, auth.uid(), new.decision_comment);
  end if;
  return new;
end;
$$;

drop trigger if exists roster_change_requests_status_history_trg on roster_change_requests;
create trigger roster_change_requests_status_history_trg
  after insert or update of status on roster_change_requests
  for each row execute function log_roster_change_request_status();

alter table roster_change_request_status_history enable row level security;
drop policy if exists roster_change_request_status_history_select on roster_change_request_status_history;
create policy roster_change_request_status_history_select on roster_change_request_status_history for select
  using (org_id = my_org_id() and has_permission('crew.manage'));

-- ------------------------------------------------------------
-- 3. crew_assignments — trace an applied change back to the request
--    that authorized it (same convention as boarding_confirmation_id /
--    signoff_confirmation_id from Phase 6).
-- ------------------------------------------------------------

alter table crew_assignments add column if not exists roster_change_request_id uuid references roster_change_requests(id);
create index if not exists crew_assignments_roster_change_request_idx on crew_assignments(roster_change_request_id);

commit;
