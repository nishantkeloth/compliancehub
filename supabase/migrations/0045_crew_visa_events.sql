
-- ============================================================
-- ComplianceHub — Visa change log for the Visas tab on the crew profile
--
-- Depends on 0044 (visa fields), 0004 (my_org_id(), has_permission()).
-- Run this whole file once, top to bottom, in the Supabase SQL Editor.
-- Safe to re-run.
--
-- Every change to a visa (recorded, status changed, dates changed, entry
-- recorded...) adds one row here, with who and when. The Visas tab merges
-- this log with the uploaded file versions into one History timeline.
-- The log is append-only: no update, no delete.
-- History starts when this is installed; visas recorded earlier show their
-- file versions only.
-- ============================================================

begin;

create table if not exists crew_visa_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  crew_id uuid not null references crew_profiles(id) on delete cascade,
  crew_document_id uuid not null references crew_documents(id) on delete cascade,
  event_type text not null,
  summary text not null,
  old_value text,
  new_value text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists crew_visa_events_crew_idx on crew_visa_events(crew_id, created_at desc);
create index if not exists crew_visa_events_doc_idx on crew_visa_events(crew_document_id, created_at desc);

alter table crew_visa_events enable row level security;

drop policy if exists crew_visa_events_select on crew_visa_events;
create policy crew_visa_events_select on crew_visa_events for select
  using ((org_id = my_org_id() and (has_permission('crew.documents.view') or has_permission('crew.documents.manage'))) or is_platform_admin());

drop policy if exists crew_visa_events_insert on crew_visa_events;
create policy crew_visa_events_insert on crew_visa_events for insert
  with check (org_id = my_org_id() and has_permission('crew.documents.manage'));

-- No update or delete policies: the log is append-only.

commit;
