-- ============================================================
-- ComplianceHub — Phase 2: Version-Controlled Crew Matrix
--
-- Depends on Phase 1 (0001_phase1_contracts_projects.sql) — needs
-- the `projects` table. Run this whole file once, top to bottom,
-- in the Supabase SQL Editor. Safe to re-run (every step guards
-- itself with "if not exists" / "on conflict do nothing").
--
-- Adds: crew_matrices, crew_matrix_lines, crew_matrix_line_skills,
-- crew_matrix_line_documents, crew_matrix_line_competencies,
-- crew_matrix_line_client_requirements, crew_matrix_status_history.
-- Extends: number_range_configs (adds 'crew_matrix' entity type),
-- next_number_range_code() (adds CMX prefix).
-- Does NOT touch site_manning_requirements — it stays as-is and
-- becomes the seed data for the "generate first draft" action in
-- the app, not something this migration migrates automatically.
-- ============================================================

begin;

-- Needed for the "one active matrix per site for an overlapping
-- effective period" exclusion constraint below.
create extension if not exists btree_gist;

-- ------------------------------------------------------------
-- 1. Crew Matrix header
-- ------------------------------------------------------------

create table if not exists crew_matrices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  project_id uuid not null references projects(id),
  offshore_site_id uuid not null references offshore_sites(id),
  matrix_number text,
  version_number integer not null default 1,
  title text not null,
  effective_from date,
  effective_to date,
  expected_pob integer,
  total_required_headcount integer not null default 0,
  status text not null default 'draft'
    check (status in (
      'draft', 'pending_internal_approval', 'pending_client_approval',
      'approved', 'active', 'superseded', 'rejected', 'cancelled'
    )),
  prepared_by uuid references auth.users(id),
  submitted_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  client_approval_reference text,
  rejection_reason text,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
create index if not exists crew_matrices_org_id_idx on crew_matrices(org_id);
create index if not exists crew_matrices_project_id_idx on crew_matrices(project_id);
create index if not exists crew_matrices_offshore_site_id_idx on crew_matrices(offshore_site_id);
create index if not exists crew_matrices_matrix_number_idx on crew_matrices(matrix_number);

-- Only one ACTIVE matrix per site for an overlapping effective
-- period — a null effective_from/effective_to is open-ended, which
-- daterange() treats as -infinity/+infinity, so two open-ended
-- active matrices on the same site will always conflict (correct:
-- you can't have two undated "current" matrices for one site).
alter table crew_matrices drop constraint if exists crew_matrices_one_active_period_per_site;
alter table crew_matrices add constraint crew_matrices_one_active_period_per_site
  exclude using gist (
    offshore_site_id with =,
    daterange(effective_from, effective_to, '[]') with &&
  )
  where (status = 'active');

-- ------------------------------------------------------------
-- 2. Crew Matrix Lines
-- ------------------------------------------------------------

create table if not exists crew_matrix_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  crew_matrix_id uuid not null references crew_matrices(id) on delete cascade,
  line_number integer not null,
  job_role_id uuid not null references job_roles(id),
  required_headcount integer not null default 1,
  day_shift_quantity integer,
  night_shift_quantity integer,
  other_shift_quantity integer,
  rotation_template_id uuid references rotation_templates(id),
  employment_type_preference text,
  nationality_preference text,
  language_requirement text,
  minimum_experience_years numeric(4, 1),
  mobilization_lead_days integer,
  client_approval_required boolean not null default false,
  remarks text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
create index if not exists crew_matrix_lines_org_id_idx on crew_matrix_lines(org_id);
create index if not exists crew_matrix_lines_crew_matrix_id_idx on crew_matrix_lines(crew_matrix_id);

-- ------------------------------------------------------------
-- 3. Line requirements
-- ------------------------------------------------------------

create table if not exists crew_matrix_line_skills (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  line_id uuid not null references crew_matrix_lines(id) on delete cascade,
  skill_id uuid not null references skills(id),
  created_at timestamptz not null default now(),
  unique (line_id, skill_id)
);
create index if not exists crew_matrix_line_skills_line_id_idx on crew_matrix_line_skills(line_id);

create table if not exists crew_matrix_line_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  line_id uuid not null references crew_matrix_lines(id) on delete cascade,
  document_type_id uuid not null references document_types(id),
  minimum_remaining_validity_days integer,
  is_mandatory boolean not null default true,
  waiver_permitted boolean not null default false,
  created_at timestamptz not null default now(),
  unique (line_id, document_type_id)
);
create index if not exists crew_matrix_line_documents_line_id_idx on crew_matrix_line_documents(line_id);

create table if not exists crew_matrix_line_competencies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  line_id uuid not null references crew_matrix_lines(id) on delete cascade,
  competency_name text not null,
  minimum_grade text,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists crew_matrix_line_competencies_line_id_idx on crew_matrix_line_competencies(line_id);

create table if not exists crew_matrix_line_client_requirements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  line_id uuid not null references crew_matrix_lines(id) on delete cascade,
  requirement_text text not null,
  is_mandatory boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists crew_matrix_line_client_requirements_line_id_idx on crew_matrix_line_client_requirements(line_id);

-- ------------------------------------------------------------
-- 4. Status history (audit trail)
-- ------------------------------------------------------------

create table if not exists crew_matrix_status_history (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  crew_matrix_id uuid not null references crew_matrices(id) on delete cascade,
  old_status text,
  new_status text not null,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now(),
  comment text
);
create index if not exists crew_matrix_status_history_crew_matrix_id_idx on crew_matrix_status_history(crew_matrix_id);

create or replace function log_crew_matrix_status_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status is distinct from old.status then
    insert into crew_matrix_status_history (crew_matrix_id, org_id, old_status, new_status, changed_by, comment)
    values (new.id, new.org_id, old.status, new.status, auth.uid(), new.rejection_reason);
  end if;
  return new;
end;
$$;

drop trigger if exists crew_matrices_status_history_trg on crew_matrices;
create trigger crew_matrices_status_history_trg
  after update of status on crew_matrices
  for each row execute function log_crew_matrix_status_change();

-- When a matrix becomes 'active', supersede any other version that
-- shares its matrix_number and is currently 'active' — runs BEFORE
-- the exclusion constraint above is checked, so the old version is
-- out of the way before the new one's period is validated.
create or replace function supersede_previous_active_matrix()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status = 'active' and (old.status is distinct from 'active') and new.matrix_number is not null then
    update crew_matrices
    set status = 'superseded', updated_at = now(), updated_by = new.updated_by
    where matrix_number = new.matrix_number
      and id <> new.id
      and status = 'active';
  end if;
  return new;
end;
$$;

drop trigger if exists crew_matrices_supersede_trg on crew_matrices;
create trigger crew_matrices_supersede_trg
  before update of status on crew_matrices
  for each row execute function supersede_previous_active_matrix();

-- ------------------------------------------------------------
-- 5. Row Level Security
--
--    Lines and requirement tables: select = crew.matrix.view,
--    write = crew.matrix.manage (only draft content is ever
--    written to these — enforced at the app layer, since RLS
--    can't see "is this matrix currently in draft").
--
--    crew_matrices itself: select = crew.matrix.view; write is
--    allowed for ANY of the matrix permissions (manage / submit /
--    approve_internal / approve_client) because each workflow
--    action (submit, approve, reject, activate) is itself an
--    UPDATE of this table performed by a role that may only hold
--    the narrower permission for that one action. Which specific
--    permission a given transition requires is enforced in the
--    server action, not by RLS — RLS here is the broad backstop
--    (org match + "holds some crew-matrix permission"), same
--    division of labor as contracts.manage in Phase 1.
-- ------------------------------------------------------------

alter table crew_matrices enable row level security;
drop policy if exists crew_matrices_select on crew_matrices;
drop policy if exists crew_matrices_write on crew_matrices;
drop policy if exists crew_matrices_update on crew_matrices;
drop policy if exists crew_matrices_delete on crew_matrices;
create policy crew_matrices_select on crew_matrices for select
  using ((org_id = my_org_id() and has_permission('crew.matrix.view')) or is_platform_admin());
create policy crew_matrices_write on crew_matrices for insert
  with check (org_id = my_org_id() and has_permission('crew.matrix.manage'));
create policy crew_matrices_update on crew_matrices for update
  using (
    org_id = my_org_id() and (
      has_permission('crew.matrix.manage')
      or has_permission('crew.matrix.submit')
      or has_permission('crew.matrix.approve_internal')
      or has_permission('crew.matrix.approve_client')
    )
  )
  with check (org_id = my_org_id());
create policy crew_matrices_delete on crew_matrices for delete
  using (org_id = my_org_id() and has_permission('crew.matrix.manage'));

alter table crew_matrix_lines enable row level security;
drop policy if exists crew_matrix_lines_select on crew_matrix_lines;
drop policy if exists crew_matrix_lines_write on crew_matrix_lines;
drop policy if exists crew_matrix_lines_update on crew_matrix_lines;
drop policy if exists crew_matrix_lines_delete on crew_matrix_lines;
create policy crew_matrix_lines_select on crew_matrix_lines for select
  using ((org_id = my_org_id() and has_permission('crew.matrix.view')) or is_platform_admin());
create policy crew_matrix_lines_write on crew_matrix_lines for insert
  with check (org_id = my_org_id() and has_permission('crew.matrix.manage'));
create policy crew_matrix_lines_update on crew_matrix_lines for update
  using (org_id = my_org_id() and has_permission('crew.matrix.manage'))
  with check (org_id = my_org_id());
create policy crew_matrix_lines_delete on crew_matrix_lines for delete
  using (org_id = my_org_id() and has_permission('crew.matrix.manage'));

-- Same select/write/delete shape for the four line-requirement
-- tables — no per-field update needed, requirements are added or
-- removed, not edited in place (matches contract_services' pattern
-- from Phase 1), except documents which also gets an update policy
-- since its validity-days/mandatory/waiver fields are edited.
do $$
declare
  t text;
begin
  foreach t in array array['crew_matrix_line_skills', 'crew_matrix_line_competencies', 'crew_matrix_line_client_requirements']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_select on %I', t, t);
    execute format('drop policy if exists %I_write on %I', t, t);
    execute format('drop policy if exists %I_delete on %I', t, t);
    execute format(
      'create policy %I_select on %I for select using ((org_id = my_org_id() and has_permission(''crew.matrix.view'')) or is_platform_admin())',
      t, t
    );
    execute format(
      'create policy %I_write on %I for insert with check (org_id = my_org_id() and has_permission(''crew.matrix.manage''))',
      t, t
    );
    execute format(
      'create policy %I_delete on %I for delete using (org_id = my_org_id() and has_permission(''crew.matrix.manage''))',
      t, t
    );
  end loop;
end $$;

alter table crew_matrix_line_documents enable row level security;
drop policy if exists crew_matrix_line_documents_select on crew_matrix_line_documents;
drop policy if exists crew_matrix_line_documents_write on crew_matrix_line_documents;
drop policy if exists crew_matrix_line_documents_update on crew_matrix_line_documents;
drop policy if exists crew_matrix_line_documents_delete on crew_matrix_line_documents;
create policy crew_matrix_line_documents_select on crew_matrix_line_documents for select
  using ((org_id = my_org_id() and has_permission('crew.matrix.view')) or is_platform_admin());
create policy crew_matrix_line_documents_write on crew_matrix_line_documents for insert
  with check (org_id = my_org_id() and has_permission('crew.matrix.manage'));
create policy crew_matrix_line_documents_update on crew_matrix_line_documents for update
  using (org_id = my_org_id() and has_permission('crew.matrix.manage'))
  with check (org_id = my_org_id());
create policy crew_matrix_line_documents_delete on crew_matrix_line_documents for delete
  using (org_id = my_org_id() and has_permission('crew.matrix.manage'));

alter table crew_matrix_status_history enable row level security;
drop policy if exists crew_matrix_status_history_select on crew_matrix_status_history;
create policy crew_matrix_status_history_select on crew_matrix_status_history for select
  using ((org_id = my_org_id() and has_permission('crew.matrix.view')) or is_platform_admin());
-- No write policy: only the trigger (security definer) inserts here.

-- ------------------------------------------------------------
-- 6. Number-range support for Matrix codes (CMX00001, ...) — same
--    mechanism Contracts/Projects use.
-- ------------------------------------------------------------

alter table number_range_configs drop constraint if exists number_range_configs_entity_type_check;
alter table number_range_configs add constraint number_range_configs_entity_type_check
  check (entity_type = any (array['client', 'contractor', 'contract', 'project', 'crew_matrix']));

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
select id, 'crew_matrix', 'CMX', 5, 0 from companies
on conflict (org_id, entity_type) do nothing;

-- ------------------------------------------------------------
-- 7. Permissions
-- ------------------------------------------------------------

insert into permissions (key, label, description) values
  ('crew.matrix.view', 'View crew matrices', 'View vessel crew matrices, their lines, requirements, and approval history'),
  ('crew.matrix.manage', 'Manage crew matrices', 'Create and edit draft crew matrices, their lines and requirements; create new versions'),
  ('crew.matrix.submit', 'Submit crew matrices for approval', 'Submit a draft crew matrix into the internal approval workflow'),
  ('crew.matrix.approve_internal', 'Give internal approval on crew matrices', 'Approve, reject, or return for correction at the internal approval stage'),
  ('crew.matrix.approve_client', 'Record client approval on crew matrices', 'Record client approval/rejection and activate an approved crew matrix')
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_key)
select r.id, p.key
from roles r
join permissions p on p.key in (
  'crew.matrix.view', 'crew.matrix.manage', 'crew.matrix.submit',
  'crew.matrix.approve_internal', 'crew.matrix.approve_client'
)
where r.system_key = 'company_admin'
on conflict do nothing;

commit;
