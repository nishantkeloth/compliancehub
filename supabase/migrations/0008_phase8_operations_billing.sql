-- ============================================================
-- ComplianceHub — Phase 8: Offshore Catering Operations, Cost &
-- Billing Support
--
-- Depends on Phase 1 (contracts / projects), Phase 6 (crew_assignments
-- with project_id / planned & actual dates) and Phase 7 (containers).
-- Run this whole file once, top to bottom, in the Supabase SQL Editor.
-- Safe to re-run.
--
-- Adds: ops_daily_logs (daily POB + crew attendance + service delivery,
-- one row per project/site/day), ops_periods (monthly closing +
-- commercial approval + billing-ready, with controlled reopening and a
-- history trail), ops_cost_entries (manually captured costs — travel,
-- visa/medical, provision, equipment, other mobilization, other),
-- billing_terms (structured contract billing model), and
-- ops_billing_adjustments (additional approved services / deductions).
--
-- Design notes (see claude/phase8-operations-billing.md):
--  * Crew cost is NOT stored — it's computed from crew_assignments ×
--    crew_profiles.day_rate for the days in the period (lib/ops.ts).
--    Container cost likewise comes from container_movements. Only costs
--    the system can't derive are entered by hand (ops_cost_entries).
--  * "Closed periods cannot be edited without controlled reopening" is
--    enforced by a trigger on ops_daily_logs / ops_cost_entries /
--    ops_billing_adjustments that refuses writes when the matching
--    ops_periods row is not 'open' — in addition to the app checks.
--  * contracts.billing_model (free text, Phase 1) is left as-is; the
--    structured terms live in billing_terms (one per contract, with an
--    optional per-project override).
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. Monthly periods (closing / approval workflow)
-- ------------------------------------------------------------

create table if not exists ops_periods (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  period_month date not null, -- always the 1st of the month
  status text not null default 'open'
    check (status in ('open', 'closed', 'commercially_approved', 'billing_ready')),
  closed_by uuid references auth.users(id),
  closed_at timestamptz,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  billing_ready_by uuid references auth.users(id),
  billing_ready_at timestamptz,
  reopen_count integer not null default 0,
  last_reopen_reason text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, period_month)
);
create index if not exists ops_periods_org_idx on ops_periods(org_id);

create table if not exists ops_period_history (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  period_id uuid not null references ops_periods(id) on delete cascade,
  old_status text,
  new_status text not null,
  reason text,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now()
);
create index if not exists ops_period_history_period_idx on ops_period_history(period_id);

create or replace function log_ops_period_status()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if tg_op = 'INSERT' then
    insert into ops_period_history (period_id, org_id, old_status, new_status, changed_by)
    values (new.id, new.org_id, null, new.status, auth.uid());
  elsif new.status is distinct from old.status then
    insert into ops_period_history (period_id, org_id, old_status, new_status, reason, changed_by)
    values (new.id, new.org_id, old.status, new.status, case when new.status = 'open' then new.last_reopen_reason else null end, auth.uid());
  end if;
  return new;
end;
$$;
drop trigger if exists ops_periods_history_trg on ops_periods;
create trigger ops_periods_history_trg
  after insert or update of status on ops_periods
  for each row execute function log_ops_period_status();

-- Guard: refuse writes to period-scoped tables when the period is not open.
create or replace function ops_assert_period_open(p_project_id uuid, p_date date)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status text;
begin
  select status into v_status
  from ops_periods
  where project_id = p_project_id and period_month = date_trunc('month', p_date)::date;
  if v_status is not null and v_status <> 'open' then
    raise exception 'Period % for this project is %; reopen it before editing.', to_char(p_date, 'YYYY-MM'), v_status
      using errcode = 'P0001';
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 2. Daily operations log — POB, crew attendance, service delivery
-- ------------------------------------------------------------

create table if not exists ops_daily_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  offshore_site_id uuid not null references offshore_sites(id),
  entry_date date not null,
  -- POB & meals
  client_pob integer not null default 0,
  crew_pob integer not null default 0,
  breakfast_count integer not null default 0,
  lunch_count integer not null default 0,
  dinner_count integer not null default 0,
  night_meal_count integer not null default 0,
  special_meals integer not null default 0,
  packed_meals integer not null default 0,
  -- Crew attendance (headcounts for the day; overtime in hours)
  att_onboard integer not null default 0,
  att_on_duty integer not null default 0,
  att_off_duty integer not null default 0,
  att_sick integer not null default 0,
  att_training integer not null default 0,
  att_travel integer not null default 0,
  att_overtime_hours numeric(8, 2) not null default 0,
  att_emergency_duty integer not null default 0,
  -- Service delivery
  catering_delivered boolean not null default true,
  housekeeping_completed boolean not null default true,
  laundry_kg numeric(10, 2),
  special_events text,
  service_interruptions text,
  client_complaints integer not null default 0,
  client_complaint_notes text,
  food_waste_kg numeric(10, 2),
  non_conformities integer not null default 0,
  non_conformity_notes text,
  remarks text,
  -- Approval
  status text not null default 'draft' check (status in ('draft', 'submitted', 'verified', 'rejected')),
  submitted_by uuid references auth.users(id),
  submitted_at timestamptz,
  verified_by uuid references auth.users(id),
  verified_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  unique (project_id, offshore_site_id, entry_date)
);
create index if not exists ops_daily_logs_org_idx on ops_daily_logs(org_id);
create index if not exists ops_daily_logs_project_date_idx on ops_daily_logs(project_id, entry_date);

create or replace function ops_daily_logs_period_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if tg_op = 'DELETE' then
    perform ops_assert_period_open(old.project_id, old.entry_date);
    return old;
  end if;
  perform ops_assert_period_open(new.project_id, new.entry_date);
  return new;
end;
$$;
drop trigger if exists ops_daily_logs_period_guard_trg on ops_daily_logs;
create trigger ops_daily_logs_period_guard_trg
  before insert or update or delete on ops_daily_logs
  for each row execute function ops_daily_logs_period_guard();

-- ------------------------------------------------------------
-- 3. Manually captured costs
-- ------------------------------------------------------------

create table if not exists ops_cost_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  offshore_site_id uuid references offshore_sites(id),
  cost_date date not null,
  category text not null
    check (category in ('travel', 'visa_medical', 'provision', 'equipment', 'other_mobilization', 'other')),
  description text not null,
  amount numeric(14, 2) not null,
  currency text not null default 'USD',
  reference text,
  crew_id uuid references crew_profiles(id),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);
create index if not exists ops_cost_entries_project_date_idx on ops_cost_entries(project_id, cost_date);

create or replace function ops_cost_entries_period_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if tg_op = 'DELETE' then
    perform ops_assert_period_open(old.project_id, old.cost_date);
    return old;
  end if;
  perform ops_assert_period_open(new.project_id, new.cost_date);
  return new;
end;
$$;
drop trigger if exists ops_cost_entries_period_guard_trg on ops_cost_entries;
create trigger ops_cost_entries_period_guard_trg
  before insert or update or delete on ops_cost_entries
  for each row execute function ops_cost_entries_period_guard();

-- ------------------------------------------------------------
-- 4. Billing terms (structured contract model)
-- ------------------------------------------------------------

create table if not exists billing_terms (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  contract_id uuid not null references contracts(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade, -- null = contract default
  billing_model text not null default 'per_person_day'
    check (billing_model in ('per_person_day', 'fixed_monthly', 'lump_sum', 'cost_plus', 'management_fee', 'mixed')),
  currency text not null default 'USD',
  pob_basis text not null default 'client_pob' check (pob_basis in ('client_pob', 'total_pob')),
  minimum_billable_pob integer,
  rate_per_person_day numeric(12, 2),
  rate_breakfast numeric(12, 2),
  rate_lunch numeric(12, 2),
  rate_dinner numeric(12, 2),
  rate_night_meal numeric(12, 2),
  rate_special_meal numeric(12, 2),
  rate_packed_meal numeric(12, 2),
  fixed_monthly_fee numeric(14, 2),
  lump_sum_amount numeric(14, 2),
  lump_sum_billing_month date,
  markup_pct numeric(6, 2),
  management_fee_monthly numeric(14, 2),
  monthly_budget_cost numeric(14, 2),
  monthly_budget_revenue numeric(14, 2),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
create unique index if not exists billing_terms_contract_default_idx on billing_terms(contract_id) where (project_id is null);
create unique index if not exists billing_terms_project_idx on billing_terms(project_id) where (project_id is not null);

-- ------------------------------------------------------------
-- 5. Billing adjustments (additional approved services / deductions)
-- ------------------------------------------------------------

create table if not exists ops_billing_adjustments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  period_month date not null,
  kind text not null check (kind in ('additional_service', 'deduction')),
  description text not null,
  amount numeric(14, 2) not null check (amount >= 0),
  currency text not null default 'USD',
  reference text,
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected')),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);
create index if not exists ops_billing_adjustments_project_month_idx on ops_billing_adjustments(project_id, period_month);

create or replace function ops_billing_adjustments_period_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status text;
  v_project uuid := coalesce(new.project_id, old.project_id);
  v_month date := coalesce(new.period_month, old.period_month);
begin
  select status into v_status from ops_periods where project_id = v_project and period_month = v_month;
  -- Adjustments may still be decided while the period is 'closed' (that's
  -- what commercial review is for) but not once commercially approved.
  if v_status in ('commercially_approved', 'billing_ready') then
    raise exception 'Period % is %; reopen it before changing billing adjustments.', to_char(v_month, 'YYYY-MM'), v_status
      using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists ops_billing_adjustments_period_guard_trg on ops_billing_adjustments;
create trigger ops_billing_adjustments_period_guard_trg
  before insert or update or delete on ops_billing_adjustments
  for each row execute function ops_billing_adjustments_period_guard();

-- ------------------------------------------------------------
-- 6. Row Level Security
-- ------------------------------------------------------------

alter table ops_periods enable row level security;
alter table ops_period_history enable row level security;
alter table ops_daily_logs enable row level security;
alter table ops_cost_entries enable row level security;
alter table billing_terms enable row level security;
alter table ops_billing_adjustments enable row level security;

drop policy if exists ops_periods_select on ops_periods;
create policy ops_periods_select on ops_periods for select
  using ((org_id = my_org_id() and has_permission('ops.view')) or is_platform_admin());
drop policy if exists ops_periods_write on ops_periods;
create policy ops_periods_write on ops_periods for all
  using (org_id = my_org_id() and (has_permission('ops.close') or has_permission('ops.commercial') or has_permission('ops.enter')))
  with check (org_id = my_org_id() and (has_permission('ops.close') or has_permission('ops.commercial') or has_permission('ops.enter')));

drop policy if exists ops_period_history_select on ops_period_history;
create policy ops_period_history_select on ops_period_history for select
  using ((org_id = my_org_id() and has_permission('ops.view')) or is_platform_admin());

drop policy if exists ops_daily_logs_select on ops_daily_logs;
create policy ops_daily_logs_select on ops_daily_logs for select
  using ((org_id = my_org_id() and has_permission('ops.view')) or is_platform_admin());
drop policy if exists ops_daily_logs_write on ops_daily_logs;
create policy ops_daily_logs_write on ops_daily_logs for all
  using (org_id = my_org_id() and (has_permission('ops.enter') or has_permission('ops.verify')))
  with check (org_id = my_org_id() and (has_permission('ops.enter') or has_permission('ops.verify')));

drop policy if exists ops_cost_entries_select on ops_cost_entries;
create policy ops_cost_entries_select on ops_cost_entries for select
  using ((org_id = my_org_id() and has_permission('ops.commercial')) or is_platform_admin());
drop policy if exists ops_cost_entries_write on ops_cost_entries;
create policy ops_cost_entries_write on ops_cost_entries for all
  using (org_id = my_org_id() and (has_permission('ops.enter') or has_permission('ops.commercial')))
  with check (org_id = my_org_id() and (has_permission('ops.enter') or has_permission('ops.commercial')));

drop policy if exists billing_terms_select on billing_terms;
create policy billing_terms_select on billing_terms for select
  using ((org_id = my_org_id() and has_permission('ops.commercial')) or is_platform_admin());
drop policy if exists billing_terms_write on billing_terms;
create policy billing_terms_write on billing_terms for all
  using (org_id = my_org_id() and has_permission('ops.commercial'))
  with check (org_id = my_org_id() and has_permission('ops.commercial'));

drop policy if exists ops_billing_adjustments_select on ops_billing_adjustments;
create policy ops_billing_adjustments_select on ops_billing_adjustments for select
  using ((org_id = my_org_id() and has_permission('ops.commercial')) or is_platform_admin());
drop policy if exists ops_billing_adjustments_write on ops_billing_adjustments;
create policy ops_billing_adjustments_write on ops_billing_adjustments for all
  using (org_id = my_org_id() and (has_permission('ops.close') or has_permission('ops.commercial')))
  with check (org_id = my_org_id() and (has_permission('ops.close') or has_permission('ops.commercial')));

-- ------------------------------------------------------------
-- 7. Permissions
-- ------------------------------------------------------------

insert into permissions (key, label, description) values
  ('ops.view', 'View daily operations', 'View daily POB, attendance and service delivery logs and period status'),
  ('ops.enter', 'Enter daily operations', 'Create, edit and submit daily POB / attendance / service logs and manual cost entries'),
  ('ops.verify', 'Verify daily operations', 'Vessel / operations verification of submitted daily logs'),
  ('ops.close', 'Close monthly periods', 'Close a month for a project and propose billing adjustments'),
  ('ops.commercial', 'Commercial approval & billing', 'See costs, billing terms and profitability; approve adjustments; commercially approve, mark billing-ready, export, and reopen periods')
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_key)
select r.id, p.key
from roles r
join permissions p on p.key in ('ops.view', 'ops.enter', 'ops.verify', 'ops.close', 'ops.commercial')
where r.system_key = 'company_admin'
on conflict do nothing;

commit;
