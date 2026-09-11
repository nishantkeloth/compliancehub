-- ============================================================
-- ComplianceHub — Phase 7: Materials & Container Mobilization
--
-- Depends on Phase 1 (projects) and the existing offshore_sites table.
-- Run this whole file once, top to bottom, in the Supabase SQL Editor.
-- Safe to re-run.
--
-- Adds: containers, container_movements, container_load_items,
-- container_incidents, container_maintenance, and two permissions
-- (containers.view / containers.manage).
--
-- Design notes (see claude/phase7-containers.md):
--  * Deliberately NOT a warehouse system — one movement is one trip of
--    one container (out and back); load is high-level categories, not
--    SKU-level inventory.
--  * "A container cannot be allocated to overlapping movements" is a
--    partial unique index on container_movements(container_id) where the
--    movement is still open (not returned / cancelled) — a real DB
--    constraint, in addition to the app-layer status check.
--  * containers.availability_status is the process status (available →
--    reserved → loading → dispatched → in_transit → received_offshore →
--    in_use → return_requested → returned → inspection → available) and
--    is driven entirely by movement / inspection actions, never edited
--    by hand.
--  * Container numbers are the physical container's own number (e.g.
--    the ISO code painted on it), entered by the user — no number range.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. Container master
-- ------------------------------------------------------------

create table if not exists containers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  container_code text not null,
  container_type text,
  ownership text not null default 'owned'
    check (ownership in ('owned', 'rented', 'client_owned', 'contractor_owned')),
  supplier_lessor text,
  purchase_cost numeric(14, 2),
  rental_rate numeric(14, 2),
  rate_basis text check (rate_basis in ('daily', 'weekly', 'monthly')),
  currency text not null default 'USD',
  capacity text,
  tare_weight_kg numeric(10, 2),
  current_condition text not null default 'good'
    check (current_condition in ('good', 'fair', 'damaged', 'out_of_service')),
  current_location text,
  availability_status text not null default 'available'
    check (availability_status in (
      'available', 'reserved', 'loading', 'dispatched', 'in_transit',
      'received_offshore', 'in_use', 'return_requested', 'returned', 'inspection'
    )),
  commission_date date,
  last_inspection_date date,
  next_inspection_date date,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  unique (org_id, container_code)
);
create index if not exists containers_org_idx on containers(org_id);
create index if not exists containers_status_idx on containers(availability_status);

-- ------------------------------------------------------------
-- 2. Movements — one row per trip (out and back)
-- ------------------------------------------------------------

create table if not exists container_movements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  container_id uuid not null references containers(id) on delete cascade,
  project_id uuid not null references projects(id),
  offshore_site_id uuid references offshore_sites(id),
  from_location text,
  to_location text,
  dispatch_date date,
  expected_arrival_date date,
  actual_arrival_date date,
  return_date date,
  status text not null default 'reserved'
    check (status in (
      'reserved', 'loading', 'dispatched', 'in_transit', 'received_offshore',
      'in_use', 'return_requested', 'returned', 'cancelled'
    )),
  transport_reference text,
  shipping_cost numeric(14, 2) not null default 0,
  customs_port_cost numeric(14, 2) not null default 0,
  handling_cost numeric(14, 2) not null default 0,
  currency text not null default 'USD',
  -- Receipt offshore (req. 6: shortages, damage, temperature exceptions)
  received_by text,
  received_at timestamptz,
  receipt_shortages text,
  receipt_damage text,
  receipt_temperature_exceptions text,
  remarks text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
create index if not exists container_movements_org_idx on container_movements(org_id);
create index if not exists container_movements_container_idx on container_movements(container_id);
create index if not exists container_movements_project_idx on container_movements(project_id);
create index if not exists container_movements_site_idx on container_movements(offshore_site_id);

drop index if exists container_movements_one_open_idx;
create unique index container_movements_one_open_idx
  on container_movements(container_id)
  where (status not in ('returned', 'cancelled'));

-- ------------------------------------------------------------
-- 3. Load — high-level categories per movement
-- ------------------------------------------------------------

create table if not exists container_load_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  movement_id uuid not null references container_movements(id) on delete cascade,
  category text not null
    check (category in (
      'dry_food', 'chilled_food', 'frozen_food', 'beverages', 'cleaning_materials',
      'laundry_materials', 'ppe', 'catering_equipment', 'other'
    )),
  description text,
  quantity numeric(12, 2),
  unit text,
  value numeric(14, 2),
  currency text,
  temperature_requirement text,
  expiry_consideration text,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists container_load_items_movement_idx on container_load_items(movement_id);

-- ------------------------------------------------------------
-- 4. Damage / loss incidents with estimated recovery cost
-- ------------------------------------------------------------

create table if not exists container_incidents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  container_id uuid not null references containers(id) on delete cascade,
  movement_id uuid references container_movements(id) on delete set null,
  incident_type text not null check (incident_type in ('damage', 'loss')),
  description text not null,
  estimated_recovery_cost numeric(14, 2),
  currency text,
  reported_at timestamptz not null default now(),
  reported_by uuid references auth.users(id),
  is_resolved boolean not null default false,
  resolution_notes text,
  resolved_at timestamptz
);
create index if not exists container_incidents_container_idx on container_incidents(container_id);

-- ------------------------------------------------------------
-- 5. Maintenance & inspections (maintenance cost + inspection dates)
-- ------------------------------------------------------------

create table if not exists container_maintenance (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  container_id uuid not null references containers(id) on delete cascade,
  maintenance_type text not null
    check (maintenance_type in ('inspection', 'repair', 'cleaning', 'other')),
  performed_date date not null,
  cost numeric(14, 2) not null default 0,
  currency text,
  next_inspection_date date,
  condition_after text check (condition_after in ('good', 'fair', 'damaged', 'out_of_service')),
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);
create index if not exists container_maintenance_container_idx on container_maintenance(container_id);

-- ------------------------------------------------------------
-- 6. Row Level Security
-- ------------------------------------------------------------

alter table containers enable row level security;
alter table container_movements enable row level security;
alter table container_load_items enable row level security;
alter table container_incidents enable row level security;
alter table container_maintenance enable row level security;

drop policy if exists containers_select on containers;
create policy containers_select on containers for select
  using ((org_id = my_org_id() and has_permission('containers.view')) or is_platform_admin());
drop policy if exists containers_write on containers;
create policy containers_write on containers for all
  using (org_id = my_org_id() and has_permission('containers.manage'))
  with check (org_id = my_org_id() and has_permission('containers.manage'));

drop policy if exists container_movements_select on container_movements;
create policy container_movements_select on container_movements for select
  using ((org_id = my_org_id() and has_permission('containers.view')) or is_platform_admin());
drop policy if exists container_movements_write on container_movements;
create policy container_movements_write on container_movements for all
  using (org_id = my_org_id() and has_permission('containers.manage'))
  with check (org_id = my_org_id() and has_permission('containers.manage'));

drop policy if exists container_load_items_select on container_load_items;
create policy container_load_items_select on container_load_items for select
  using ((org_id = my_org_id() and has_permission('containers.view')) or is_platform_admin());
drop policy if exists container_load_items_write on container_load_items;
create policy container_load_items_write on container_load_items for all
  using (org_id = my_org_id() and has_permission('containers.manage'))
  with check (org_id = my_org_id() and has_permission('containers.manage'));

drop policy if exists container_incidents_select on container_incidents;
create policy container_incidents_select on container_incidents for select
  using ((org_id = my_org_id() and has_permission('containers.view')) or is_platform_admin());
drop policy if exists container_incidents_write on container_incidents;
create policy container_incidents_write on container_incidents for all
  using (org_id = my_org_id() and has_permission('containers.manage'))
  with check (org_id = my_org_id() and has_permission('containers.manage'));

drop policy if exists container_maintenance_select on container_maintenance;
create policy container_maintenance_select on container_maintenance for select
  using ((org_id = my_org_id() and has_permission('containers.view')) or is_platform_admin());
drop policy if exists container_maintenance_write on container_maintenance;
create policy container_maintenance_write on container_maintenance for all
  using (org_id = my_org_id() and has_permission('containers.manage'))
  with check (org_id = my_org_id() and has_permission('containers.manage'));

-- ------------------------------------------------------------
-- 7. Permissions
-- ------------------------------------------------------------

insert into permissions (key, label, description) values
  ('containers.view', 'View containers', 'View container master data, movements, load, costs and utilization'),
  ('containers.manage', 'Manage containers', 'Create/edit containers, plan and progress movements, record receipts, load, incidents and maintenance')
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_key)
select r.id, p.key
from roles r
join permissions p on p.key in ('containers.view', 'containers.manage')
where r.system_key = 'company_admin'
on conflict do nothing;

commit;
