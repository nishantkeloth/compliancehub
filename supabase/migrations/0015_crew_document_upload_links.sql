-- ============================================================
-- ComplianceHub — Phase 13 (cont.): self-upload link for crew members
--
-- Lets a staff member (crew.documents.manage) generate a link for a
-- specific crew member, scoped to specific document types, that the
-- crew member can open WITHOUT a ComplianceHub account to upload their
-- own documents. Mirrors the existing invite-link pattern already in
-- this project (see app/accept-invite/[token] and the get_invite_preview
-- / redeem_invite RPCs it calls) — a random token in a table, a
-- SECURITY DEFINER RPC the anon role can call to preview it, and the
-- actual write happening through a server action using the service-role
-- client (never anon RLS on storage.objects, which would have to be
-- open to the public internet with no token check of its own).
--
-- Trust boundary: the crew member is NOT authenticated. Every self
-- upload therefore lands as a new crew_document_versions row (source =
-- 'self_upload') that does NOT update the parent crew_documents row
-- (document_number/issue_date/expiry_date) until a staff member
-- reviews and approves it — same "AI proposes, person confirms"
-- principle used for the AI auto-read, just with a human on both ends
-- this time. The review decision is its own insert-only table
-- (crew_document_version_reviews), not a column flipped on
-- crew_document_versions, so that table stays fully append-only exactly
-- like the versions themselves and every other facts-not-state table
-- in this project (readiness_snapshots, boarding_confirmations,
-- signoff_confirmations). "Pending" is simply "no review row yet" for
-- a self_upload version — nothing stored for the common case.
--
-- crew_document_upload_links is ordinary mutable operational state
-- (not a fact log), so unlike the tables above it does get a normal
-- update policy — solely so staff can revoke a link early.
--
-- Run this whole file once, top to bottom, in the Supabase SQL Editor.
-- Safe to re-run. Depends on 0014 (crew_document_versions, crew-documents
-- storage bucket) already being applied.
-- ============================================================

begin;

create table if not exists crew_document_upload_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  crew_id uuid not null references crew_profiles(id) on delete cascade,
  token text not null unique,
  created_by uuid references auth.users(id),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists crew_document_upload_links_crew_idx on crew_document_upload_links(crew_id);
create index if not exists crew_document_upload_links_org_idx on crew_document_upload_links(org_id);
create index if not exists crew_document_upload_links_token_idx on crew_document_upload_links(token);

-- Traceability: which link (if any) produced a given self-uploaded
-- version. Nullable — every version created any other way leaves it null.
-- Must come after the table above exists, for the FK.
alter table crew_document_versions add column if not exists upload_link_id uuid references crew_document_upload_links(id);

alter table crew_document_upload_links enable row level security;

drop policy if exists crew_document_upload_links_select on crew_document_upload_links;
create policy crew_document_upload_links_select on crew_document_upload_links for select
  using (org_id = my_org_id() and (has_permission('crew.documents.view') or has_permission('crew.documents.manage')));

drop policy if exists crew_document_upload_links_insert on crew_document_upload_links;
create policy crew_document_upload_links_insert on crew_document_upload_links for insert
  with check (org_id = my_org_id() and has_permission('crew.documents.manage'));

-- Only revocation happens through this — staff can set revoked_at early.
-- The server action only ever sets revoked_at, nothing else, but RLS
-- can't easily restrict which columns an UPDATE touches, so this is
-- enforced in the action itself (revokeDocumentUploadLink), same as
-- every other permission check in this codebase.
drop policy if exists crew_document_upload_links_update on crew_document_upload_links;
create policy crew_document_upload_links_update on crew_document_upload_links for update
  using (org_id = my_org_id() and has_permission('crew.documents.manage'))
  with check (org_id = my_org_id() and has_permission('crew.documents.manage'));

create table if not exists crew_document_upload_link_items (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references crew_document_upload_links(id) on delete cascade,
  document_type_id uuid not null references document_types(id),
  unique (link_id, document_type_id)
);
create index if not exists crew_document_upload_link_items_link_idx on crew_document_upload_link_items(link_id);

alter table crew_document_upload_link_items enable row level security;

drop policy if exists crew_document_upload_link_items_select on crew_document_upload_link_items;
create policy crew_document_upload_link_items_select on crew_document_upload_link_items for select
  using (
    exists (
      select 1 from crew_document_upload_links l
      where l.id = link_id and l.org_id = my_org_id()
        and (has_permission('crew.documents.view') or has_permission('crew.documents.manage'))
    )
  );

drop policy if exists crew_document_upload_link_items_insert on crew_document_upload_link_items;
create policy crew_document_upload_link_items_insert on crew_document_upload_link_items for insert
  with check (
    exists (
      select 1 from crew_document_upload_links l
      where l.id = link_id and l.org_id = my_org_id() and has_permission('crew.documents.manage')
    )
  );
-- No update/delete — a link's requested types are fixed at creation; to
-- change them, revoke and send a new link.

create table if not exists crew_document_version_reviews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  crew_document_version_id uuid not null references crew_document_versions(id) on delete cascade,
  decision text not null check (decision in ('approved', 'rejected')),
  note text,
  reviewed_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists crew_document_version_reviews_version_idx on crew_document_version_reviews(crew_document_version_id);
create unique index if not exists crew_document_version_reviews_one_per_version on crew_document_version_reviews(crew_document_version_id);

alter table crew_document_version_reviews enable row level security;

drop policy if exists crew_document_version_reviews_select on crew_document_version_reviews;
create policy crew_document_version_reviews_select on crew_document_version_reviews for select
  using (org_id = my_org_id() and (has_permission('crew.documents.view') or has_permission('crew.documents.manage')));

drop policy if exists crew_document_version_reviews_insert on crew_document_version_reviews;
create policy crew_document_version_reviews_insert on crew_document_version_reviews for insert
  with check (org_id = my_org_id() and has_permission('crew.documents.manage'));
-- Insert-only, and the unique index above means a version can only ever
-- be reviewed once — a mistaken decision is fixed by uploading a
-- corrected version, not by editing the review.

-- ------------------------------------------------------------
-- get_document_upload_link_preview — the one thing an unauthenticated
-- crew member is allowed to learn from a token: whose link it is, which
-- company, which document types were requested (and whether each
-- already has a current file), and whether the link is still valid.
-- Mirrors get_invite_preview's shape (a single "valid" boolean plus the
-- safe-to-show fields, never the raw crew/company row).
-- ------------------------------------------------------------
create or replace function get_document_upload_link_preview(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link crew_document_upload_links%rowtype;
  v_crew_name text;
  v_company_name text;
  v_items jsonb;
begin
  select * into v_link from crew_document_upload_links where token = p_token;

  if v_link.id is null or v_link.revoked_at is not null or v_link.expires_at < now() then
    return jsonb_build_object('valid', false);
  end if;

  select full_name into v_crew_name from crew_profiles where id = v_link.crew_id;
  select name into v_company_name from companies where id = v_link.org_id;

  select jsonb_agg(
    jsonb_build_object(
      'document_type_id', dt.id,
      'name', dt.name,
      'category', dt.category,
      'has_current_file', exists (
        select 1 from crew_documents cd
        join crew_document_versions v on v.crew_document_id = cd.id
        where cd.crew_id = v_link.crew_id and cd.document_type_id = dt.id
      )
    )
    order by dt.name
  )
  into v_items
  from crew_document_upload_link_items li
  join document_types dt on dt.id = li.document_type_id
  where li.link_id = v_link.id;

  return jsonb_build_object(
    'valid', true,
    'crew_name', v_crew_name,
    'company_name', v_company_name,
    'expires_at', v_link.expires_at,
    'items', coalesce(v_items, '[]'::jsonb)
  );
end;
$$;

grant execute on function get_document_upload_link_preview(text) to anon, authenticated;

commit;
