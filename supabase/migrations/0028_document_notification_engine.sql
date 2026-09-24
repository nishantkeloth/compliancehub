-- ============================================================
-- ComplianceHub — Phase 14: Document Notification Engine &
-- Configurable Operations Dashboard
--
-- Run this whole file once, top to bottom, in the Supabase SQL Editor.
-- Safe to re-run (every create/insert is guarded).
--
-- Adds:
--   notification_settings      — org-level: configured recipient email
--                                 list, escalation window, digest toggle.
--   dashboard_module_settings  — org-level: which dashboard modules an
--                                 admin has enabled (document_expiry,
--                                 crew_matrix, inspections_actions).
--   document_notifications     — durable per-document expiry alert
--                                 record (this is what makes the
--                                 dashboard queryable — previously
--                                 expiry status was only ever computed
--                                 on the fly, nothing recorded that an
--                                 alert had already fired).
--   permission notifications.manage — admin-only, gates both settings
--                                 pages. Granted to company_admin,
--                                 same pattern as ai.configure
--                                 (0009_phase9_ai_crew_matrix.sql).
--
-- See claude/phase14-document-notification-engine-proposal.md for the
-- full design rationale.
-- ============================================================

begin;

create table if not exists notification_settings (
  org_id uuid primary key references companies(id) on delete cascade,
  recipient_emails text[] not null default '{}',
  escalate_after_days integer not null default 3,
  digest_enabled boolean not null default true,
  last_digest_sent_for date,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create table if not exists dashboard_module_settings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  module_key text not null check (module_key in ('document_expiry', 'crew_matrix', 'inspections_actions')),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  unique (org_id, module_key)
);

create table if not exists document_notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  crew_id uuid not null references crew_profiles(id) on delete cascade,
  crew_document_id uuid not null references crew_documents(id) on delete cascade,
  document_type_id uuid references document_types(id) on delete set null,
  severity text not null check (severity in ('warning', 'critical', 'expired')),
  days_remaining integer,
  first_detected_at timestamptz not null default now(),
  last_notified_at timestamptz,
  notified_count integer not null default 0,
  status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  acknowledged_by uuid references auth.users(id),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  escalated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- At most one OPEN notification per document at a time — the daily sweep
-- updates severity/days_remaining on that row in place as a document
-- moves through warning -> critical -> expired, and auto-resolves it the
-- moment the document is renewed. If the same document later expires
-- again (next renewal cycle), a fresh row is created, so history of past
-- notifications is preserved rather than overwritten.
create unique index if not exists document_notifications_one_open_idx
  on document_notifications(crew_document_id) where status = 'open';
create index if not exists document_notifications_org_idx on document_notifications(org_id);
create index if not exists document_notifications_crew_idx on document_notifications(crew_id);
create index if not exists document_notifications_status_idx on document_notifications(org_id, status);

/* ================= Permission ================= */

insert into permissions (key, label, description) values
  ('notifications.manage', 'Notifications & Dashboard', 'Configure the document-expiry notification engine (recipient emails, escalation window) and which modules appear on the operations dashboard. Admin-only by default.')
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_key)
select r.id, p.key from roles r join permissions p on p.key = 'notifications.manage'
where r.system_key = 'company_admin'
on conflict do nothing;

/* ================= Default module rollout ================= */

-- Every existing org gets all three modules enabled by default — an
-- admin can turn any of them off afterwards from Notification Settings.
insert into dashboard_module_settings (org_id, module_key, enabled)
select c.id, m.module_key, true
from companies c
cross join (values ('document_expiry'), ('crew_matrix'), ('inspections_actions')) as m(module_key)
on conflict (org_id, module_key) do nothing;

/* ================= RLS ================= */

alter table notification_settings enable row level security;
alter table dashboard_module_settings enable row level security;
alter table document_notifications enable row level security;

-- notification_settings: only admins with notifications.manage can see
-- or change the recipient list / escalation window.
create policy notification_settings_select on notification_settings for select
  using ((org_id = my_org_id() and has_permission('notifications.manage')) or is_platform_admin());

create policy notification_settings_write on notification_settings for all
  using (org_id = my_org_id() and has_permission('notifications.manage'))
  with check (org_id = my_org_id() and has_permission('notifications.manage'));

-- dashboard_module_settings: every org member can READ which modules are
-- enabled (needed to render the dashboard for anyone), only admins can
-- change the toggles.
create policy dashboard_module_settings_select on dashboard_module_settings for select
  using (org_id = my_org_id() or is_platform_admin());

create policy dashboard_module_settings_write on dashboard_module_settings for all
  using (org_id = my_org_id() and has_permission('notifications.manage'))
  with check (org_id = my_org_id() and has_permission('notifications.manage'));

-- document_notifications: viewable by anyone who can already see crew
-- documents or is a notifications admin; only document-managers or
-- notifications admins can acknowledge/resolve.
create policy document_notifications_select on document_notifications for select
  using (
    (org_id = my_org_id() and (has_permission('crew.documents.view') or has_permission('notifications.manage')))
    or is_platform_admin()
  );

create policy document_notifications_write on document_notifications for all
  using (org_id = my_org_id() and (has_permission('crew.documents.manage') or has_permission('notifications.manage')))
  with check (org_id = my_org_id() and (has_permission('crew.documents.manage') or has_permission('notifications.manage')));

commit;
