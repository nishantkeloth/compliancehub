-- ============================================================
-- ComplianceHub — Client Compliance Reports (Phase 10)
--
-- The recurring manual process this replaces: AHM periodically builds a
-- per-vessel crew roster + document-compliance workbook (e.g. the "Mag
-- Ares - QE Crew Matrix" file) by hand and emails it to the client
-- (QatarEnergy). This migration adds:
--
--   1. report_templates   — one reusable client-specific (optionally
--      site-specific) column mapping, built once through a UI, not a
--      code change per client. columns is an ordered jsonb array of
--      {source, header, group_header?, date_format?} — `source` is
--      resolved against live crew/document data by
--      lib/reports/report-columns.ts at generate time.
--   2. report_send_packages / report_send_recipients — an immutable
--      audit trail of every send: who, when, to whom, the generated
--      file itself (kept in storage, not just logged), and a frozen
--      snapshot of the rows that were sent — so a client dispute can be
--      resolved from the actual record rather than recomputed live
--      data that may have since changed.
--   3. job_roles.is_key_officer — the Officer/Rating split the sample
--      client file needs for its "KO Days Onboard" / "Ratings Days
--      Onboard" columns. Confirmed nothing like this existed anywhere
--      (see phase10 requirement doc, section 3).
--
-- Deliberately out of scope for this increment (see the two open design
-- questions this was shipped against: single sending domain, mandatory
-- human review before every send — both decided as the simpler default
-- for v1, revisit if that changes): no recipient-bound secure link or
-- client-facing view page (unlike crew_matrix_share_*, nothing here
-- needs a client-visitable page — the client just gets the email +
-- attachment), no scheduling/automation (Phase 10 doc's "Step B").
--
-- Run this whole file once, top to bottom, in the Supabase SQL Editor.
-- Safe to re-run. Depends on clients, offshore_sites, job_roles,
-- client_contacts (migration 0018), companies, and
-- has_permission()/my_org_id() already existing.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. Officer vs Rating classification on job roles.
-- ------------------------------------------------------------

alter table job_roles add column if not exists is_key_officer boolean not null default false;
comment on column job_roles.is_key_officer is
  'Key Officer vs Rating, for client reports that split continuous days-onboard caps by seniority (e.g. "KO Days Onboard" vs "Ratings Days Onboard"). Set from Crew Setup > Job Roles.';

-- ------------------------------------------------------------
-- 2. Report templates — the per-client (optionally per-site) column
--    mapping. offshore_site_id null = applies to every site for that
--    client; set = overrides the client-level template for just that
--    one site/vessel. Resolution order lives in app/reports/actions.ts.
-- ------------------------------------------------------------

create table if not exists report_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  offshore_site_id uuid references offshore_sites(id) on delete cascade,
  name text not null,
  columns jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists report_templates_org_idx on report_templates(org_id);
create index if not exists report_templates_client_idx on report_templates(client_id);
create index if not exists report_templates_site_idx on report_templates(offshore_site_id);

alter table report_templates enable row level security;

drop policy if exists report_templates_select on report_templates;
create policy report_templates_select on report_templates for select
  using (org_id = my_org_id() and has_permission('crew.report.send'));

drop policy if exists report_templates_write on report_templates;
create policy report_templates_write on report_templates for all
  using (org_id = my_org_id() and has_permission('crew.report.send'))
  with check (org_id = my_org_id() and has_permission('crew.report.send'));

-- ------------------------------------------------------------
-- 3. Send packages — one immutable row per "Generate & Send", mirroring
--    crew_matrix_share_packages' snapshot convention (migration 0018)
--    minus the parts this feature doesn't need (no token/portal: the
--    client never visits ComplianceHub, they just get the email).
-- ------------------------------------------------------------

create table if not exists report_send_packages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  report_template_id uuid references report_templates(id) on delete set null,
  offshore_site_id uuid references offshore_sites(id) on delete set null,
  client_id uuid references clients(id) on delete set null,
  site_name_snapshot text not null,
  client_name_snapshot text,
  template_name_snapshot text,
  row_count integer not null default 0,
  flagged_count integer not null default 0,
  status text not null default 'sent' check (status in ('sent', 'partially_sent', 'failed')),
  from_address_snapshot text not null,
  from_display_name_snapshot text,
  reply_to_snapshot text,
  email_subject_snapshot text not null,
  email_body_snapshot text not null,
  storage_path text not null,
  file_name text not null,
  rows_snapshot jsonb not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists report_send_packages_org_idx on report_send_packages(org_id);
create index if not exists report_send_packages_site_idx on report_send_packages(offshore_site_id);
create index if not exists report_send_packages_client_idx on report_send_packages(client_id);

alter table report_send_packages enable row level security;

drop policy if exists report_send_packages_select on report_send_packages;
create policy report_send_packages_select on report_send_packages for select
  using (org_id = my_org_id() and has_permission('crew.report.send'));

drop policy if exists report_send_packages_insert on report_send_packages;
create policy report_send_packages_insert on report_send_packages for insert
  with check (org_id = my_org_id() and has_permission('crew.report.send'));

-- Update is only ever the post-send delivery-status rollup — enforced in
-- the server action, not by RLS, same convention as crew_matrix_share_packages.
drop policy if exists report_send_packages_update on report_send_packages;
create policy report_send_packages_update on report_send_packages for update
  using (org_id = my_org_id() and has_permission('crew.report.send'))
  with check (org_id = my_org_id() and has_permission('crew.report.send'));

-- ------------------------------------------------------------
-- 4. Recipients — one row per person a send went to.
-- ------------------------------------------------------------

create table if not exists report_send_recipients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  send_package_id uuid not null references report_send_packages(id) on delete cascade,
  client_contact_id uuid references client_contacts(id),
  recipient_name text not null,
  recipient_email text not null,
  delivery_status text not null default 'pending' check (delivery_status in ('pending', 'sent', 'failed')),
  provider_message_id text,
  send_error text,
  created_at timestamptz not null default now()
);
create index if not exists report_send_recipients_org_idx on report_send_recipients(org_id);
create index if not exists report_send_recipients_package_idx on report_send_recipients(send_package_id);

alter table report_send_recipients enable row level security;

drop policy if exists report_send_recipients_select on report_send_recipients;
create policy report_send_recipients_select on report_send_recipients for select
  using (org_id = my_org_id() and has_permission('crew.report.send'));

drop policy if exists report_send_recipients_insert on report_send_recipients;
create policy report_send_recipients_insert on report_send_recipients for insert
  with check (org_id = my_org_id() and has_permission('crew.report.send'));

drop policy if exists report_send_recipients_update on report_send_recipients;
create policy report_send_recipients_update on report_send_recipients for update
  using (org_id = my_org_id() and has_permission('crew.report.send'))
  with check (org_id = my_org_id() and has_permission('crew.report.send'));

-- ------------------------------------------------------------
-- 5. Permission + storage bucket for the generated files.
-- ------------------------------------------------------------

insert into permissions (key, label, description) values
  ('crew.report.send', 'Build and send client compliance reports', 'Create/edit report templates, generate a client compliance report for a vessel, review it, and send it to client contacts. Also grants viewing the send history/audit trail.')
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_key)
select r.id, p.key from roles r join permissions p on p.key = 'crew.report.send'
where r.system_key = 'company_admin'
on conflict do nothing;

-- Storage RLS policies must NOT call has_permission()/my_org_id() inside
-- storage.objects policies (confirmed misbehaving there — see migration
-- 0013's note, repeated at 0035) — use the inline profiles subquery
-- instead.
insert into storage.buckets (id, name, public)
values ('client-reports', 'client-reports', false)
on conflict (id) do nothing;

drop policy if exists client_reports_select on storage.objects;
create policy client_reports_select on storage.objects for select
  using (
    bucket_id = 'client-reports'
    and (storage.foldername(name))[1] = (
      select profiles.org_id::text from profiles where profiles.id = auth.uid()
    )
  );

drop policy if exists client_reports_insert on storage.objects;
create policy client_reports_insert on storage.objects for insert
  with check (
    bucket_id = 'client-reports'
    and (storage.foldername(name))[1] = (
      select profiles.org_id::text from profiles where profiles.id = auth.uid()
    )
  );

commit;
