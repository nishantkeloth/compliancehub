-- ============================================================
-- ComplianceHub — Staffing Plan: shareable "resource profile" link
--
-- Lets staff managing a crew matrix generate a link for one candidate
-- (scoped to one crew_matrix_line, i.e. one rank on one matrix) that a
-- CLIENT can open WITHOUT a ComplianceHub account to view that person's
-- name/nationality/rank and their status for every document type
-- required for that rank — exactly the row already shown on the
-- Staffing Plan tab, nothing more.
--
-- Same pattern as crew_document_upload_links (migration 0015): a random
-- token in a table, a SECURITY DEFINER RPC the anon role can call to
-- read a safe, narrow projection of the data, and expiry + revocation
-- instead of the link staying valid forever.
--
-- Run this whole file once, top to bottom, in the Supabase SQL Editor.
-- Safe to re-run. Depends on crew_matrix_lines / crew_matrix_line_documents
-- (phase 2), crew_documents (phase 3), and document_types already existing.
-- ============================================================

begin;

create table if not exists candidate_resource_profile_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  crew_id uuid not null references crew_profiles(id) on delete cascade,
  crew_matrix_line_id uuid not null references crew_matrix_lines(id) on delete cascade,
  token text not null unique,
  created_by uuid references auth.users(id),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists candidate_resource_profile_links_crew_idx on candidate_resource_profile_links(crew_id);
create index if not exists candidate_resource_profile_links_line_idx on candidate_resource_profile_links(crew_matrix_line_id);
create index if not exists candidate_resource_profile_links_org_idx on candidate_resource_profile_links(org_id);
create index if not exists candidate_resource_profile_links_token_idx on candidate_resource_profile_links(token);

alter table candidate_resource_profile_links enable row level security;

drop policy if exists candidate_resource_profile_links_select on candidate_resource_profile_links;
create policy candidate_resource_profile_links_select on candidate_resource_profile_links for select
  using (org_id = my_org_id() and has_permission('crew.matrix.view'));

drop policy if exists candidate_resource_profile_links_insert on candidate_resource_profile_links;
create policy candidate_resource_profile_links_insert on candidate_resource_profile_links for insert
  with check (org_id = my_org_id() and has_permission('crew.matrix.manage'));

-- Only revocation happens through this — staff can set revoked_at early.
-- Enforced in the server action itself (only ever sets revoked_at), same
-- as crew_document_upload_links_update.
drop policy if exists candidate_resource_profile_links_update on candidate_resource_profile_links;
create policy candidate_resource_profile_links_update on candidate_resource_profile_links for update
  using (org_id = my_org_id() and has_permission('crew.matrix.manage'))
  with check (org_id = my_org_id() and has_permission('crew.matrix.manage'));

-- ------------------------------------------------------------
-- get_resource_profile_preview — the one thing an unauthenticated
-- client is allowed to learn from a token: the candidate's name,
-- nationality, rank, which matrix/site this is for, and their status
-- for each document type required by that rank (most recent
-- crew_documents row per document type) — never the raw crew_profiles
-- row or anything outside that one rank's required document types.
-- ------------------------------------------------------------
create or replace function get_resource_profile_preview(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link candidate_resource_profile_links%rowtype;
  v_crew record;
  v_line record;
  v_company_name text;
  v_docs jsonb;
begin
  select * into v_link from candidate_resource_profile_links where token = p_token;

  if v_link.id is null or v_link.revoked_at is not null or v_link.expires_at < now() then
    return jsonb_build_object('valid', false);
  end if;

  select full_name, nationality into v_crew from crew_profiles where id = v_link.crew_id;
  select name into v_company_name from companies where id = v_link.org_id;

  select jr.name as job_role_name, m.title as matrix_title, m.matrix_number, os.name as site_name
    into v_line
  from crew_matrix_lines l
  join job_roles jr on jr.id = l.job_role_id
  join crew_matrices m on m.id = l.crew_matrix_id
  left join offshore_sites os on os.id = m.offshore_site_id
  where l.id = v_link.crew_matrix_line_id;

  select jsonb_agg(
    jsonb_build_object(
      'name', dt.name,
      'category', dt.category,
      'is_mandatory', d.is_mandatory,
      'tracks_number', dt.tracks_number,
      'warning_threshold_days', dt.warning_threshold_days,
      'document_number', cd.document_number,
      'issue_date', cd.issue_date,
      'expiry_date', cd.expiry_date
    )
    order by dt.category nulls last, dt.name
  )
  into v_docs
  from crew_matrix_line_documents d
  join document_types dt on dt.id = d.document_type_id
  left join lateral (
    select document_number, issue_date, expiry_date
    from crew_documents
    where crew_id = v_link.crew_id and document_type_id = d.document_type_id
    order by created_at desc
    limit 1
  ) cd on true
  where d.line_id = v_link.crew_matrix_line_id;

  return jsonb_build_object(
    'valid', true,
    'crew_name', v_crew.full_name,
    'nationality', v_crew.nationality,
    'job_role_name', v_line.job_role_name,
    'matrix_title', v_line.matrix_title,
    'matrix_number', v_line.matrix_number,
    'site_name', v_line.site_name,
    'company_name', v_company_name,
    'expires_at', v_link.expires_at,
    'documents', coalesce(v_docs, '[]'::jsonb)
  );
end;
$$;

grant execute on function get_resource_profile_preview(text) to anon, authenticated;

commit;
