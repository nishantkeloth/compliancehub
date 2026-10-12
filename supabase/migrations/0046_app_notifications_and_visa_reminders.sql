-- ============================================================
-- 0046 — In-app notification bell, visa reminders, upload failure alerts
--
--   app_notifications         one row per person per alert (the bell). Written by the
--                             daily/6-hourly jobs with the service role; each person
--                             can only read and mark-read their own.
--   visa_reminder_log         remembers which visa reminder steps have already been
--                             sent, so each step goes out once per visa.
--   notification_settings     + visa_reminders_enabled (on/off for the visa email)
--                             + last_visa_digest_sent_for (once a day guard)
--   bulk_intake_jobs          + failure_alerted_at (one failure alert per upload)
--
-- Safe to run more than once.
-- ============================================================

begin;

create table if not exists app_notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('visa', 'document', 'upload', 'action', 'system')),
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical', 'ok')),
  title text not null,
  body text,
  link text,
  -- The same alert for the same person is created once.
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (user_id, dedupe_key)
);
create index if not exists app_notifications_user_idx on app_notifications(user_id, created_at desc);
create index if not exists app_notifications_unread_idx on app_notifications(user_id) where read_at is null;

alter table app_notifications enable row level security;

drop policy if exists app_notifications_select on app_notifications;
create policy app_notifications_select on app_notifications for select
  using (user_id = auth.uid());

-- A person can mark their own notifications read (the app only ever sets read_at).
drop policy if exists app_notifications_update on app_notifications;
create policy app_notifications_update on app_notifications for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- No insert/delete policies: only the scheduled jobs (service role) create or clear them.

create table if not exists visa_reminder_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  crew_document_id uuid not null references crew_documents(id) on delete cascade,
  -- expiry = days before expiry (or stay end), entry = days before entry deadline,
  -- action = the visa has already lapsed (days_before is 0).
  kind text not null check (kind in ('expiry', 'entry', 'action')),
  days_before integer not null default 0,
  -- The date the step counts down to. A renewed visa has a new date, so it starts fresh.
  target_date date not null,
  sent_on date not null default current_date,
  created_at timestamptz not null default now(),
  unique (crew_document_id, kind, days_before, target_date)
);
create index if not exists visa_reminder_log_org_idx on visa_reminder_log(org_id);

-- Written and read only by the scheduled job (service role); no policies means no one else can.
alter table visa_reminder_log enable row level security;

alter table notification_settings add column if not exists visa_reminders_enabled boolean not null default true;
alter table notification_settings add column if not exists last_visa_digest_sent_for date;

alter table bulk_intake_jobs add column if not exists failure_alerted_at timestamptz;

commit;
