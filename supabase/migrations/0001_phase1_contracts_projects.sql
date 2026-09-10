-- ============================================================
-- ComplianceHub — Phase 1: Contract & Project Management
--
-- Run this whole file once, top to bottom, in the Supabase SQL
-- Editor. It is written to be safe to re-run (every step either
-- checks "if not exists" or guards itself with "on conflict do
-- nothing" / "where not exists"), so if something errors partway
-- through, fix the issue and just run the file again.
--
-- Adds: contracts, contract_services, projects, contract_documents,
-- contract_status_history. Extends: number_range_configs (adds
-- 'contract'/'project' entity types), next_number_range_code()
-- (adds CTR/PRJ prefixes), offshore_sites (adds project_id).
-- Backfills: one legacy Contract per existing Client (from its
-- contract_number/dates/billing_model), one legacy Project per
-- existing Contractor (under that Contract), and links existing
-- offshore_sites to that Project. contractor_id stays on
-- offshore_sites — nothing existing is removed or renamed.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. New tables
-- ------------------------------------------------------------

create table if not exists contracts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  client_id uuid not null references clients(id),
  contract_code text,
  contract_number text,
  contract_title text not null,
  description text,
  award_date date,
  planned_start_date date,
  planned_end_date date,
  actual_start_date date,
  actual_end_date date,
  currency text,
  estimated_contract_value numeric(14, 2),
  billing_model text,
  payment_terms text,
  mobilization_notice_days integer,
  contract_manager_user_id uuid references auth.users(id),
  operations_manager_user_id uuid references auth.users(id),
  status text not null default 'draft'
    check (status in ('draft', 'awarded', 'mobilizing', 'active', 'suspended', 'completed', 'cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
create index if not exists contracts_org_id_idx on contracts(org_id);
create index if not exists contracts_client_id_idx on contracts(client_id);

create table if not exists contract_services (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  contract_id uuid not null references contracts(id) on delete cascade,
  service text not null check (service in (
    'catering', 'housekeeping', 'laundry', 'provision_supply', 'equipment_supply',
    'camp_management', 'waste_management', 'container_logistics_support', 'other'
  )),
  created_at timestamptz not null default now(),
  unique (contract_id, service)
);
create index if not exists contract_services_org_id_idx on contract_services(org_id);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  contract_id uuid not null references contracts(id),
  contractor_id uuid not null references contractors(id),
  project_code text,
  project_name text not null,
  client_reference text,
  purchase_order_number text,
  country text,
  operating_region text,
  base_port text,
  mobilization_location text,
  demobilization_location text,
  planned_start_date date,
  planned_end_date date,
  actual_start_date date,
  actual_end_date date,
  expected_pob integer,
  project_manager_user_id uuid references auth.users(id),
  operations_coordinator_user_id uuid references auth.users(id),
  status text not null default 'planned'
    check (status in ('planned', 'mobilizing', 'active', 'demobilizing', 'completed', 'cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
create index if not exists projects_org_id_idx on projects(org_id);
create index if not exists projects_contract_id_idx on projects(contract_id);
create index if not exists projects_contractor_id_idx on projects(contractor_id);

create table if not exists contract_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  contract_id uuid not null references contracts(id) on delete cascade,
  title text not null,
  document_url text,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);
create index if not exists contract_documents_contract_id_idx on contract_documents(contract_id);

create table if not exists contract_status_history (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  contract_id uuid not null references contracts(id) on delete cascade,
  old_status text,
  new_status text not null,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now(),
  note text
);
create index if not exists contract_status_history_contract_id_idx on contract_status_history(contract_id);

-- offshore_sites: link to Project, keep contractor_id as-is for
-- backward compatibility (nothing reads/writes it differently).
alter table offshore_sites add column if not exists project_id uuid references projects(id);
create index if not exists offshore_sites_project_id_idx on offshore_sites(project_id);

-- ------------------------------------------------------------
-- 2. Row Level Security — mirrors the exact pattern already used
--    on clients/contractors/offshore_sites (my_org_id() +
--    has_permission()), except SELECT here is also gated by the
--    new *.view permission (contracts/projects carry commercial
--    data that clients/offshore_sites don't, so this is stricter
--    than those tables on purpose).
-- ------------------------------------------------------------

alter table contracts enable row level security;
drop policy if exists contracts_select on contracts;
drop policy if exists contracts_write on contracts;
drop policy if exists contracts_update on contracts;
drop policy if exists contracts_delete on contracts;
create policy contracts_select on contracts for select
  using ((org_id = my_org_id() and has_permission('contracts.view')) or is_platform_admin());
create policy contracts_write on contracts for insert
  with check (org_id = my_org_id() and has_permission('contracts.manage'));
create policy contracts_update on contracts for update
  using (org_id = my_org_id() and has_permission('contracts.manage'))
  with check (org_id = my_org_id());
create policy contracts_delete on contracts for delete
  using (org_id = my_org_id() and has_permission('contracts.manage'));

alter table contract_services enable row level security;
drop policy if exists contract_services_select on contract_services;
drop policy if exists contract_services_write on contract_services;
drop policy if exists contract_services_delete on contract_services;
create policy contract_services_select on contract_services for select
  using ((org_id = my_org_id() and has_permission('contracts.view')) or is_platform_admin());
create policy contract_services_write on contract_services for insert
  with check (org_id = my_org_id() and has_permission('contracts.manage'));
create policy contract_services_delete on contract_services for delete
  using (org_id = my_org_id() and has_permission('contracts.manage'));

alter table contract_documents enable row level security;
drop policy if exists contract_documents_select on contract_documents;
drop policy if exists contract_documents_write on contract_documents;
drop policy if exists contract_documents_delete on contract_documents;
create policy contract_documents_select on contract_documents for select
  using ((org_id = my_org_id() and has_permission('contracts.view')) or is_platform_admin());
create policy contract_documents_write on contract_documents for insert
  with check (org_id = my_org_id() and has_permission('contracts.manage'));
create policy contract_documents_delete on contract_documents for delete
  using (org_id = my_org_id() and has_permission('contracts.manage'));

alter table contract_status_history enable row level security;
drop policy if exists contract_status_history_select on contract_status_history;
create policy contract_status_history_select on contract_status_history for select
  using ((org_id = my_org_id() and has_permission('contracts.view')) or is_platform_admin());
-- No insert/update/delete policy: rows are only ever written by the
-- log_contract_status_change() trigger below, which runs as
-- security definer and so bypasses RLS entirely.

alter table projects enable row level security;
drop policy if exists projects_select on projects;
drop policy if exists projects_write on projects;
drop policy if exists projects_update on projects;
drop policy if exists projects_delete on projects;
create policy projects_select on projects for select
  using ((org_id = my_org_id() and has_permission('projects.view')) or is_platform_admin());
create policy projects_write on projects for insert
  with check (org_id = my_org_id() and has_permission('projects.manage'));
create policy projects_update on projects for update
  using (org_id = my_org_id() and has_permission('projects.manage'))
  with check (org_id = my_org_id());
create policy projects_delete on projects for delete
  using (org_id = my_org_id() and has_permission('projects.manage'));

-- ------------------------------------------------------------
-- 3. Status history trigger
-- ------------------------------------------------------------

create or replace function log_contract_status_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status is distinct from old.status then
    insert into contract_status_history (contract_id, org_id, old_status, new_status, changed_by)
    values (new.id, new.org_id, old.status, new.status, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists contracts_status_history_trg on contracts;
create trigger contracts_status_history_trg
  after update of status on contracts
  for each row execute function log_contract_status_change();

-- ------------------------------------------------------------
-- 4. Number-range support for Contract/Project codes — same
--    mechanism Clients/Contractors already use.
-- ------------------------------------------------------------

alter table number_range_configs drop constraint if exists number_range_configs_entity_type_check;
alter table number_range_configs add constraint number_range_configs_entity_type_check
  check (entity_type = any (array['client', 'contractor', 'contract', 'project']));

-- Extend the code-generation function with CTR/PRJ prefixes. This
-- is a minimal-diff copy of the existing function (same auth check,
-- same insert-then-increment shape) — only the default-prefix logic
-- grows a couple more branches.
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

-- Make the config rows visible in the Number Ranges screen immediately
-- for every existing company (harmless if next_number_range_code()
-- would have lazily created them anyway — this just makes them show
-- up before the first Contract/Project is ever created).
insert into number_range_configs (org_id, entity_type, prefix, padding_length, current_number)
select id, 'contract', 'CTR', 5, 0 from companies
on conflict (org_id, entity_type) do nothing;

insert into number_range_configs (org_id, entity_type, prefix, padding_length, current_number)
select id, 'project', 'PRJ', 5, 0 from companies
on conflict (org_id, entity_type) do nothing;

-- ------------------------------------------------------------
-- 5. Permissions — contracts.view / contracts.manage /
--    contracts.view_value / projects.view / projects.manage.
--    New companies get these automatically (seed_default_roles_
--    for_company() grants company_admin every row currently in
--    `permissions`, dynamically, at signup time) — this backfills
--    the same grant onto every *existing* company's Company Admin
--    role, since that trigger only fires on new company INSERT.
-- ------------------------------------------------------------

insert into permissions (key, label, description) values
  ('contracts.view', 'View contracts', 'View contract master data, service scope, related projects and contractors'),
  ('contracts.manage', 'Manage contracts', 'Create and edit contracts, service scope, and contract documents'),
  ('contracts.view_value', 'View contract value', 'View the estimated contract value and other commercial figures on a contract'),
  ('projects.view', 'View projects', 'View project/campaign master data and their assigned offshore sites'),
  ('projects.manage', 'Manage projects', 'Create and edit projects/campaigns')
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_key)
select r.id, p.key
from roles r
join permissions p on p.key in (
  'contracts.view', 'contracts.manage', 'contracts.view_value', 'projects.view', 'projects.manage'
)
where r.system_key = 'company_admin'
on conflict do nothing;

-- ------------------------------------------------------------
-- 6. Backward-compatible backfill.
--
--    Every existing Client already carries one contract's worth
--    of data as scalar columns (contract_number/dates/billing_
--    model) — this promotes that into one real Contract row per
--    Client. Every existing Contractor becomes one Project under
--    that Contract (so its offshore sites have somewhere to
--    attach). Both are idempotent: re-running this file skips
--    clients/contractors that already got their legacy row.
--
--    This backfill runs as whatever role the SQL Editor uses
--    (not a signed-in app user), so it can't call the real
--    next_number_range_code() — that function's own authorization
--    check (`p_org_id = my_org_id()`) requires auth.uid(), which
--    is null outside the app. This session-local helper does the
--    same increment without that check; step 4 above already
--    guarantees a number_range_configs row exists for every org's
--    'contract'/'project' entity_type, so the plain update is safe.
-- ------------------------------------------------------------

create or replace function pg_temp._migration_next_code(p_org_id uuid, p_entity_type text)
returns text
language plpgsql
as $$
declare
  v_next bigint;
  v_prefix text;
  v_padding int;
begin
  update number_range_configs
  set current_number = current_number + 1,
      updated_at = now()
  where org_id = p_org_id and entity_type = p_entity_type
  returning current_number, prefix, padding_length into v_next, v_prefix, v_padding;

  return coalesce(v_prefix, '') || lpad(v_next::text, v_padding, '0');
end;
$$;

insert into contracts (
  org_id, client_id, contract_code, contract_number, contract_title,
  planned_start_date, planned_end_date, billing_model, status, notes,
  created_by, updated_by
)
select
  c.org_id,
  c.id,
  pg_temp._migration_next_code(c.org_id, 'contract'),
  c.contract_number,
  c.name || ' — Legacy Contract',
  c.contract_start_date,
  c.contract_end_date,
  c.billing_model,
  case
    when c.contract_end_date is not null and c.contract_end_date < current_date then 'completed'
    when c.contract_start_date is not null and c.contract_start_date <= current_date
         and (c.contract_end_date is null or c.contract_end_date >= current_date) then 'active'
    else 'awarded'
  end,
  'Auto-created by the Phase 1 migration to preserve this client''s existing contract_number/dates as a first-class Contract record. Review and complete the commercial details.',
  c.created_by,
  c.updated_by
from clients c
where not exists (select 1 from contracts existing where existing.client_id = c.id);

insert into projects (
  org_id, contract_id, contractor_id, project_code, project_name,
  status, notes, created_by, updated_by
)
select
  co.org_id,
  ct.id,
  co.id,
  pg_temp._migration_next_code(co.org_id, 'project'),
  co.name || ' — Legacy Project',
  case when co.is_active then 'active' else 'completed' end,
  'Auto-created by the Phase 1 migration so this contractor''s existing offshore sites have a Project to attach to. Review and complete the project details.',
  co.created_by,
  co.updated_by
from contractors co
join lateral (
  select id from contracts where contracts.client_id = co.client_id order by created_at asc limit 1
) ct on true
where not exists (select 1 from projects existing where existing.contractor_id = co.id);

update offshore_sites os
set project_id = p.id
from projects p
where p.contractor_id = os.contractor_id
  and os.contractor_id is not null
  and os.project_id is null;

commit;
