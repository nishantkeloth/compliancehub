-- ============================================================
-- ComplianceHub — Reserve/soft-lock candidates on a Staffing Plan
--
-- Adds crew_matrix_line_reservations: lets a planner mark an
-- Available/Other Location candidate as "reserved" for a specific
-- rank on a specific crew matrix, with an optional note (e.g. "waiting
-- on Passport, Hepatitis B") and an optional expected-ready date —
-- without moving them off the Available/Other Location list the way
-- Assign does. A reserved candidate stays visible in the same list
-- with a "Reserved" badge, and can be un-reserved at any time.
--
-- One active reservation per crew member, org-wide at a time (a
-- partial unique index on crew_id where released_at is null) — this
-- is what lets the app show a small "Reserved for <other matrix's
-- rank>" tag on every OTHER matrix's Staffing Plan without an extra
-- join: a candidate is reserved for at most one thing anywhere, and
-- reserving them again (from this matrix or another) simply moves
-- that single reservation over rather than erroring, since the
-- planner clicking Reserve again is presumably taking over the hold,
-- not fighting over it. Not a hard lock — the candidate can still be
-- assigned from a different matrix if someone chooses to override it
-- (see reserveCandidateForLine / assignCandidateToMatrix in
-- app/crew/matrices/[id]/staffing-actions.ts, which releases any
-- reservation automatically once the person is actually assigned).
--
-- Gated on crew.manage — the same permission that already protects
-- Assign/Unassign on the Staffing Plan (canAssignCrew in page.tsx),
-- so reserving is available to exactly the same people who can
-- already assign crew there.
--
-- Run this whole file once, top to bottom, in the Supabase SQL
-- Editor. Safe to re-run (every step guards itself).
-- ============================================================

begin;

create table if not exists crew_matrix_line_reservations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  crew_id uuid not null references crew_profiles(id) on delete cascade,
  crew_matrix_id uuid not null references crew_matrices(id) on delete cascade,
  crew_matrix_line_id uuid not null references crew_matrix_lines(id) on delete cascade,
  notes text,
  expected_ready_date date,
  reserved_by uuid references auth.users(id),
  reserved_at timestamptz not null default now(),
  -- Soft-released, not deleted — same pattern as crew_assignments'
  -- end_date — so there's a history of who reserved whom, and when it
  -- was let go, rather than the row just vanishing.
  released_at timestamptz,
  released_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crew_matrix_line_reservations_org_id_idx on crew_matrix_line_reservations(org_id);
create index if not exists crew_matrix_line_reservations_crew_id_idx on crew_matrix_line_reservations(crew_id);
create index if not exists crew_matrix_line_reservations_crew_matrix_id_idx on crew_matrix_line_reservations(crew_matrix_id);
create index if not exists crew_matrix_line_reservations_line_id_idx on crew_matrix_line_reservations(crew_matrix_line_id);

drop index if exists crew_matrix_line_reservations_one_active_idx;
create unique index crew_matrix_line_reservations_one_active_idx
  on crew_matrix_line_reservations(crew_id) where released_at is null;

alter table crew_matrix_line_reservations enable row level security;
drop policy if exists crew_matrix_line_reservations_select on crew_matrix_line_reservations;
drop policy if exists crew_matrix_line_reservations_write on crew_matrix_line_reservations;
drop policy if exists crew_matrix_line_reservations_update on crew_matrix_line_reservations;
create policy crew_matrix_line_reservations_select on crew_matrix_line_reservations for select
  using ((org_id = my_org_id() and has_permission('crew.matrix.view')) or is_platform_admin());
create policy crew_matrix_line_reservations_write on crew_matrix_line_reservations for insert
  with check (org_id = my_org_id() and has_permission('crew.manage'));
create policy crew_matrix_line_reservations_update on crew_matrix_line_reservations for update
  using (org_id = my_org_id() and has_permission('crew.manage'))
  with check (org_id = my_org_id());
-- No delete policy — reservations are always soft-released (see above),
-- never hard-deleted, so there's nothing for a delete policy to gate.

commit;
