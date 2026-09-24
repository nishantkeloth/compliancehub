-- ============================================================
-- ComplianceHub — Named, reusable document requirement templates.
--
-- Run this whole file once, top to bottom, in the Supabase SQL
-- Editor. Safe to re-run.
--
-- Context: Phase 15 (0020_phase15_job_role_document_requirements.sql)
-- gave every job role one org-wide default document checklist (with
-- an optional per-client override), silently applied to every new
-- crew matrix line for that role. That's still in place and untouched
-- by this migration.
--
-- What's new here: a role can now also have several NAMED, reusable
-- checklists to choose between by hand — e.g. "ADNOC Standard" vs
-- "ADNOC VIP" for the same Camp Boss role — picked explicitly on a
-- Manning Line inside a crew matrix (see applyDocumentTemplateToLine
-- in app/crew/matrices/actions.ts), rather than the one silent
-- default. A template belongs to exactly one job role. Applying one
-- writes a normal (freely editable afterward) set of
-- crew_matrix_line_documents rows, same as picking each checkbox by
-- hand — this only saves the initial data entry.
-- ============================================================

begin;

create table if not exists document_requirement_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  name text not null,
  job_role_id uuid not null references job_roles(id) on delete cascade,
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists document_requirement_templates_org_idx on document_requirement_templates(org_id);
create index if not exists document_requirement_templates_role_idx on document_requirement_templates(job_role_id);
-- Same template name reused across different roles is fine ("ADNOC
-- document requirement" for Camp Boss AND, separately, for Cook) —
-- only an exact duplicate for the same role is blocked.
create unique index if not exists document_requirement_templates_role_name_uq
  on document_requirement_templates(job_role_id, name);

alter table document_requirement_templates enable row level security;
drop policy if exists document_requirement_templates_all on document_requirement_templates;
create policy document_requirement_templates_all on document_requirement_templates for all
  using (org_id = my_org_id() and has_permission('crew.manage'))
  with check (org_id = my_org_id() and has_permission('crew.manage'));

create table if not exists document_requirement_template_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  template_id uuid not null references document_requirement_templates(id) on delete cascade,
  document_type_id uuid not null references document_types(id) on delete cascade,
  is_mandatory boolean not null default true,
  minimum_remaining_validity_days integer,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (template_id, document_type_id)
);
create index if not exists document_requirement_template_items_template_idx on document_requirement_template_items(template_id);

alter table document_requirement_template_items enable row level security;
drop policy if exists document_requirement_template_items_all on document_requirement_template_items;
create policy document_requirement_template_items_all on document_requirement_template_items for all
  using (org_id = my_org_id() and has_permission('crew.manage'))
  with check (org_id = my_org_id() and has_permission('crew.manage'));

commit;
