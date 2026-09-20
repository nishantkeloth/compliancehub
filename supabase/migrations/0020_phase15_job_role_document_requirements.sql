-- ============================================================
-- ComplianceHub — Phase 15: reusable per-job-role document
-- requirement templates, with an optional per-client override.
--
-- Run this whole file once, top to bottom, in the Supabase SQL
-- Editor. Safe to re-run.
--
-- Context (see claude/phase13-ahm-walkthrough-call-clarifications.md,
-- section 4): today a crew matrix line's required documents only
-- exist as ad-hoc rows on `crew_matrix_line_documents`, entered by
-- hand on every single matrix. There's no "Cook always needs these
-- documents" template anywhere, so every new matrix line starts from
-- a blank required-document list. This migration adds that template,
-- plus a per-client override for cases like "COVID vaccination is
-- required for Qatar clients but not others".
--
-- Design:
--  * A template row with client_id = null is an org-wide default for
--    a job role.
--  * A template row with client_id set overrides (by document type)
--    or adds to the org-wide default for that one client. Setting
--    is_excluded = true on a client-scoped row drops a document type
--    the org-wide default would otherwise require, for that client
--    only — e.g. a client that explicitly doesn't need a document
--    every other client does.
--  * Effective template for (job_role, client) = every org-wide row,
--    with each client-scoped row (if any) either replacing the
--    org-wide row for that document type (is_excluded = false) or
--    removing it (is_excluded = true). Applied in
--    app/crew/matrices/actions.ts's seedLineDocumentsFromTemplate().
--  * Applied only at the moment a crew_matrix_line is first created
--    (from a manning requirement, from "generate draft from manning",
--    or added manually) — never retroactively. Same reasoning as
--    Phase 12's mobilization checklist templates: editing a role's
--    template later must never silently change a matrix already in
--    progress. The seeded crew_matrix_line_documents rows are a copy,
--    freely editable afterward per line exactly as today.
--  * No new permission — gated on crew.manage throughout, the same
--    permission that already protects every other Crew Setup table
--    (job_roles, document_types, skills, rotation_templates).
-- ============================================================

begin;

create table if not exists job_role_document_requirements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  job_role_id uuid not null references job_roles(id) on delete cascade,
  client_id uuid references clients(id) on delete cascade,
  document_type_id uuid not null references document_types(id) on delete cascade,
  is_mandatory boolean not null default true,
  minimum_remaining_validity_days integer,
  is_excluded boolean not null default false,
  sort_order integer not null default 0,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint job_role_document_requirements_excluded_needs_client
    check (is_excluded = false or client_id is not null)
);
create index if not exists job_role_document_requirements_org_idx on job_role_document_requirements(org_id);
create index if not exists job_role_document_requirements_role_idx on job_role_document_requirements(job_role_id);
create index if not exists job_role_document_requirements_client_idx on job_role_document_requirements(client_id);

-- One org-wide default row per (role, document type)...
create unique index if not exists job_role_document_requirements_global_uq
  on job_role_document_requirements(job_role_id, document_type_id) where client_id is null;
-- ...and one override row per (role, client, document type). Partial
-- indexes rather than a single UNIQUE(job_role_id, client_id,
-- document_type_id) because NULL client_id values wouldn't collide
-- against each other under a plain unique constraint.
create unique index if not exists job_role_document_requirements_client_uq
  on job_role_document_requirements(job_role_id, client_id, document_type_id) where client_id is not null;

alter table job_role_document_requirements enable row level security;
drop policy if exists job_role_document_requirements_all on job_role_document_requirements;
create policy job_role_document_requirements_all on job_role_document_requirements for all
  using (org_id = my_org_id() and has_permission('crew.manage'))
  with check (org_id = my_org_id() and has_permission('crew.manage'));

commit;
