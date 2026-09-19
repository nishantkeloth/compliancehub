-- ============================================================
-- ComplianceHub — Client Crew Matrix Sharing (Increment 1)
--
-- "Send Matrix to Client" on the Staffing Plan tab: an authorized user
-- sends an approved/active crew matrix's currently-assigned crew and
-- their document status to one or more client-contact recipients, each
-- getting their own email with an editable subject/body, an Excel
-- attachment, and a recipient-bound secure link to a client-facing page
-- (app/crew-matrix-share/[token]) — same pattern as
-- candidate_resource_profile_links (migration 0017), scoped up from one
-- candidate to a whole matrix's assigned crew.
--
-- Deliberately trimmed from the full "Client Crew Matrix Sharing" spec
-- (see project doc phase11-crew-matrix-client-sharing-assessment.md):
-- Secure Online Link only (no ZIP/PDF attachment, no OTP, no sender-
-- domain verification, no background job queue), manual recipients now
-- backed by a small new client_contacts table. Every table here is
-- purely additive — rollback is a straight set of `drop table`/`drop
-- function` statements, nothing existing is altered.
--
-- Run this whole file once, top to bottom, in the Supabase SQL Editor.
-- Safe to re-run. Depends on clients, crew_matrices, crew_matrix_lines,
-- crew_profiles, document_types, companies, and has_permission()/
-- my_org_id() already existing.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. Client contacts — didn't exist anywhere before this. Managed the
--    same way the clients screen itself is (crew.manage), so no new
--    permission is needed just to maintain the list.
-- ------------------------------------------------------------

create table if not exists client_contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  full_name text not null,
  email text not null,
  title text,
  phone text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists client_contacts_org_idx on client_contacts(org_id);
create index if not exists client_contacts_client_idx on client_contacts(client_id);

alter table client_contacts enable row level security;

drop policy if exists client_contacts_select on client_contacts;
create policy client_contacts_select on client_contacts for select
  using (org_id = my_org_id() and has_permission('crew.manage'));

drop policy if exists client_contacts_write on client_contacts;
create policy client_contacts_write on client_contacts for all
  using (org_id = my_org_id() and has_permission('crew.manage'))
  with check (org_id = my_org_id() and has_permission('crew.manage'));

-- ------------------------------------------------------------
-- 2. Share packages — one immutable snapshot per "Send Matrix to
--    Client" send. Trimmed from the full spec's version: no zip/
--    encryption/template columns (not built in Increment 1).
-- ------------------------------------------------------------

create table if not exists crew_matrix_share_packages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  crew_matrix_id uuid not null references crew_matrices(id) on delete cascade,
  share_reference text not null unique,
  matrix_title_snapshot text not null,
  matrix_number_snapshot text,
  matrix_version_snapshot integer not null,
  matrix_status_at_share text not null,
  client_id uuid references clients(id),
  client_name_snapshot text,
  project_name_snapshot text,
  site_name_snapshot text,
  company_name_snapshot text,
  status text not null default 'sent' check (status in ('sent', 'partially_sent', 'failed', 'revoked', 'superseded')),
  from_address_snapshot text not null,
  from_display_name_snapshot text,
  reply_to_snapshot text,
  email_subject_snapshot text not null,
  email_body_html_snapshot text not null,
  email_body_text_snapshot text not null,
  excel_attached boolean not null default true,
  staff_count integer not null default 0,
  document_count integer not null default 0,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id),
  revocation_reason text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists crew_matrix_share_packages_org_idx on crew_matrix_share_packages(org_id);
create index if not exists crew_matrix_share_packages_matrix_idx on crew_matrix_share_packages(crew_matrix_id);

alter table crew_matrix_share_packages enable row level security;

drop policy if exists crew_matrix_share_packages_select on crew_matrix_share_packages;
create policy crew_matrix_share_packages_select on crew_matrix_share_packages for select
  using (org_id = my_org_id() and has_permission('crew.matrix.share'));

drop policy if exists crew_matrix_share_packages_insert on crew_matrix_share_packages;
create policy crew_matrix_share_packages_insert on crew_matrix_share_packages for insert
  with check (org_id = my_org_id() and has_permission('crew.matrix.share'));

-- Update is only ever a revoke (status/revoked_at/revoked_by/reason) or a
-- delivery-status rollup after sending — enforced in the server actions,
-- not by RLS, same convention as the resource-profile-link's update policy.
drop policy if exists crew_matrix_share_packages_update on crew_matrix_share_packages;
create policy crew_matrix_share_packages_update on crew_matrix_share_packages for update
  using (org_id = my_org_id() and has_permission('crew.matrix.share'))
  with check (org_id = my_org_id() and has_permission('crew.matrix.share'));

-- ------------------------------------------------------------
-- 3. Recipients — one row per person the package was sent to, each with
--    its own token (recipient-bound link) and its own delivery/open
--    tracking.
-- ------------------------------------------------------------

create table if not exists crew_matrix_share_recipients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  share_package_id uuid not null references crew_matrix_share_packages(id) on delete cascade,
  client_contact_id uuid references client_contacts(id),
  recipient_name text not null,
  recipient_email text not null,
  token text not null unique,
  token_expires_at timestamptz not null,
  revoked_at timestamptz,
  delivery_status text not null default 'pending' check (delivery_status in ('pending', 'sent', 'failed')),
  provider_message_id text,
  send_error text,
  first_opened_at timestamptz,
  last_opened_at timestamptz,
  view_count integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists crew_matrix_share_recipients_org_idx on crew_matrix_share_recipients(org_id);
create index if not exists crew_matrix_share_recipients_package_idx on crew_matrix_share_recipients(share_package_id);
create index if not exists crew_matrix_share_recipients_token_idx on crew_matrix_share_recipients(token);

alter table crew_matrix_share_recipients enable row level security;

drop policy if exists crew_matrix_share_recipients_select on crew_matrix_share_recipients;
create policy crew_matrix_share_recipients_select on crew_matrix_share_recipients for select
  using (org_id = my_org_id() and has_permission('crew.matrix.share'));

drop policy if exists crew_matrix_share_recipients_insert on crew_matrix_share_recipients;
create policy crew_matrix_share_recipients_insert on crew_matrix_share_recipients for insert
  with check (org_id = my_org_id() and has_permission('crew.matrix.share'));

drop policy if exists crew_matrix_share_recipients_update on crew_matrix_share_recipients;
create policy crew_matrix_share_recipients_update on crew_matrix_share_recipients for update
  using (org_id = my_org_id() and has_permission('crew.matrix.share'))
  with check (org_id = my_org_id() and has_permission('crew.matrix.share'));

-- ------------------------------------------------------------
-- 4. Staff + documents — the immutable snapshot itself. The public page
--    reads exclusively from these two tables (via the RPC below), never
--    live crew_profiles/crew_documents, so later edits to a person's
--    record never change what a client who already has the link sees.
-- ------------------------------------------------------------

create table if not exists crew_matrix_share_staff (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  share_package_id uuid not null references crew_matrix_share_packages(id) on delete cascade,
  crew_id uuid references crew_profiles(id) on delete set null,
  job_role_name_snapshot text not null,
  display_order integer not null default 0,
  staff_snapshot_json jsonb not null
);
create index if not exists crew_matrix_share_staff_org_idx on crew_matrix_share_staff(org_id);
create index if not exists crew_matrix_share_staff_package_idx on crew_matrix_share_staff(share_package_id);

alter table crew_matrix_share_staff enable row level security;

drop policy if exists crew_matrix_share_staff_select on crew_matrix_share_staff;
create policy crew_matrix_share_staff_select on crew_matrix_share_staff for select
  using (org_id = my_org_id() and has_permission('crew.matrix.share'));

drop policy if exists crew_matrix_share_staff_insert on crew_matrix_share_staff;
create policy crew_matrix_share_staff_insert on crew_matrix_share_staff for insert
  with check (org_id = my_org_id() and has_permission('crew.matrix.share'));

create table if not exists crew_matrix_share_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  share_package_id uuid not null references crew_matrix_share_packages(id) on delete cascade,
  share_staff_id uuid not null references crew_matrix_share_staff(id) on delete cascade,
  document_type_id uuid references document_types(id),
  display_order integer not null default 0,
  document_snapshot_json jsonb not null
);
create index if not exists crew_matrix_share_documents_org_idx on crew_matrix_share_documents(org_id);
create index if not exists crew_matrix_share_documents_staff_idx on crew_matrix_share_documents(share_staff_id);

alter table crew_matrix_share_documents enable row level security;

drop policy if exists crew_matrix_share_documents_select on crew_matrix_share_documents;
create policy crew_matrix_share_documents_select on crew_matrix_share_documents for select
  using (org_id = my_org_id() and has_permission('crew.matrix.share'));

drop policy if exists crew_matrix_share_documents_insert on crew_matrix_share_documents;
create policy crew_matrix_share_documents_insert on crew_matrix_share_documents for insert
  with check (org_id = my_org_id() and has_permission('crew.matrix.share'));

-- ------------------------------------------------------------
-- 5. Events — append-only audit trail (created/sent/send_failed/viewed/
--    revoked), following the app's existing convention of a dedicated
--    fact table per workflow rather than one generic audit_log.
-- ------------------------------------------------------------

create table if not exists crew_matrix_share_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  share_package_id uuid not null references crew_matrix_share_packages(id) on delete cascade,
  recipient_id uuid references crew_matrix_share_recipients(id) on delete cascade,
  event_type text not null,
  actor_user_id uuid references auth.users(id),
  outcome text,
  detail text,
  occurred_at timestamptz not null default now()
);
create index if not exists crew_matrix_share_events_package_idx on crew_matrix_share_events(share_package_id);
create index if not exists crew_matrix_share_events_org_idx on crew_matrix_share_events(org_id);

alter table crew_matrix_share_events enable row level security;

drop policy if exists crew_matrix_share_events_select on crew_matrix_share_events;
create policy crew_matrix_share_events_select on crew_matrix_share_events for select
  using (org_id = my_org_id() and has_permission('crew.matrix.share'));

drop policy if exists crew_matrix_share_events_insert on crew_matrix_share_events;
create policy crew_matrix_share_events_insert on crew_matrix_share_events for insert
  with check (org_id = my_org_id() and has_permission('crew.matrix.share'));

-- ------------------------------------------------------------
-- 6. Number range — share_reference gets a human-friendly SHR-00001
--    code the same way clients/matrices already do. number_range_configs
--    has a check constraint on entity_type (last widened in migration
--    0003) that doesn't know about this new entity type yet — widen it
--    the same way each earlier migration that added one did.
-- ------------------------------------------------------------

alter table number_range_configs drop constraint if exists number_range_configs_entity_type_check;
alter table number_range_configs add constraint number_range_configs_entity_type_check
  check (entity_type = any (array['client', 'contractor', 'contract', 'project', 'crew_matrix', 'mobilization', 'crew_matrix_share']));

insert into number_range_configs (org_id, entity_type, prefix, padding_length, current_number)
select id, 'crew_matrix_share', 'SHR', 5, 0 from companies
on conflict (org_id, entity_type) do nothing;

-- ------------------------------------------------------------
-- 7. get_crew_matrix_share_preview — the one thing an unauthenticated
--    recipient is allowed to learn from a token: the package's matrix
--    summary plus the snapshotted staff/document rows for THAT
--    package — never a live query against crew_profiles/crew_documents,
--    never another package's data. Also records the open (first/last
--    opened, view_count) and a 'viewed' event.
-- ------------------------------------------------------------

create or replace function get_crew_matrix_share_preview(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient crew_matrix_share_recipients%rowtype;
  v_package crew_matrix_share_packages%rowtype;
  v_staff jsonb;
begin
  select * into v_recipient from crew_matrix_share_recipients where token = p_token;

  if v_recipient.id is null or v_recipient.revoked_at is not null or v_recipient.token_expires_at < now() then
    return jsonb_build_object('valid', false);
  end if;

  select * into v_package from crew_matrix_share_packages where id = v_recipient.share_package_id;

  if v_package.id is null or v_package.revoked_at is not null then
    return jsonb_build_object('valid', false);
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'share_staff_id', s.id,
      'staff', s.staff_snapshot_json,
      'documents', (
        select coalesce(jsonb_agg(d.document_snapshot_json order by d.display_order, d.id), '[]'::jsonb)
        from crew_matrix_share_documents d
        where d.share_staff_id = s.id
      )
    )
    order by s.display_order, s.id
  )
  into v_staff
  from crew_matrix_share_staff s
  where s.share_package_id = v_package.id;

  update crew_matrix_share_recipients
  set first_opened_at = coalesce(first_opened_at, now()),
      last_opened_at = now(),
      view_count = view_count + 1
  where id = v_recipient.id;

  insert into crew_matrix_share_events (org_id, share_package_id, recipient_id, event_type, outcome)
  values (v_package.org_id, v_package.id, v_recipient.id, 'viewed', 'success');

  return jsonb_build_object(
    'valid', true,
    'share_reference', v_package.share_reference,
    'matrix_title', v_package.matrix_title_snapshot,
    'matrix_number', v_package.matrix_number_snapshot,
    'matrix_version', v_package.matrix_version_snapshot,
    'matrix_status_at_share', v_package.matrix_status_at_share,
    'client_name', v_package.client_name_snapshot,
    'project_name', v_package.project_name_snapshot,
    'site_name', v_package.site_name_snapshot,
    'company_name', v_package.company_name_snapshot,
    'recipient_name', v_recipient.recipient_name,
    'expires_at', v_recipient.token_expires_at,
    'staff', coalesce(v_staff, '[]'::jsonb)
  );
end;
$$;

grant execute on function get_crew_matrix_share_preview(text) to anon, authenticated;

-- ------------------------------------------------------------
-- 8. Permission — separate from crew.matrix.manage/view on purpose:
--    being able to edit or view a matrix internally does not imply
--    permission to send its crew's document status to an external
--    client. Granted to company_admin only at migration time, same as
--    every other new permission in this app; assign to other roles from
--    Team → Roles.
-- ------------------------------------------------------------

insert into permissions (key, label, description) values
  ('crew.matrix.share', 'Send crew matrices to clients', 'Send an approved/active crew matrix''s assigned crew and document status to external client-contact recipients via a secure link, and manage its sharing history')
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_key)
select r.id, p.key from roles r join permissions p on p.key = 'crew.matrix.share'
where r.system_key = 'company_admin'
on conflict do nothing;

commit;
