-- ============================================================
-- ComplianceHub — Phase 16d: background job system for Bulk
-- Document Intake's classify step
--
-- Today, classifying a crew folder's files (reading each file, calling
-- the AI, running the pre-commit checks from Phase 16c) happens in the
-- browser tab's memory: close the tab or lose the connection partway
-- through a large folder and the work is gone. This migration adds the
-- tables needed to make that step a durable, server-owned job instead:
-- the browser uploads the raw files once, a server-side worker chews
-- through them in the background, and the browser (or a different
-- later browser session) just polls for progress and eventually shows
-- the review table from what's already been classified and saved.
--
-- Deliberately scoped to the CLASSIFY phase only. The review/import
-- step — a human deciding what gets attached — stays exactly as it is
-- today (Phases 16a-16c were specifically about making that gate
-- trustworthy; this does not touch it). "completed" on a job below
-- means the reviewer finished importing from it, not that any
-- auto-import happened.
--
-- Depends on Phase 4 (my_org_id(), has_permission()) and crew_profiles.
-- Run this whole file once, top to bottom, in the Supabase SQL Editor.
-- Safe to re-run.
-- ============================================================

begin;

create table if not exists bulk_intake_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  crew_id uuid not null references crew_profiles(id) on delete cascade,
  -- Descriptive only, same reasoning as bulk_intake_review_log.folder_name.
  folder_name text not null,

  total_files integer not null default 0,
  processed_files integer not null default 0,

  status text not null default 'pending'
    check (status in ('pending', 'processing', 'awaiting_review', 'completed', 'failed', 'cancelled')),
  error text,

  -- Bumped by the worker every time it finishes a batch. The job-status
  -- poll route (not just the daily cron watchdog) uses this: if a job
  -- is "processing" but hasn't heartbeat in a couple of minutes, that
  -- route re-fires the worker itself before replying, so a job
  -- self-heals the moment anyone checks on it — not just once a day.
  last_heartbeat_at timestamptz not null default now(),

  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bulk_intake_jobs_org_idx on bulk_intake_jobs(org_id);
create index if not exists bulk_intake_jobs_crew_idx on bulk_intake_jobs(crew_id);
-- Used by both the watchdog cron and the self-healing poll check above.
create index if not exists bulk_intake_jobs_stalled_idx on bulk_intake_jobs(status, last_heartbeat_at);

create table if not exists bulk_intake_job_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references bulk_intake_jobs(id) on delete cascade,
  org_id uuid not null references companies(id) on delete cascade,

  filename text not null,
  -- Path within the bulk-intake-staging bucket, org-folder-scoped the
  -- same way crew-documents/crew-photos already are: <org_id>/<job_id>/<n>-<filename>.
  storage_path text not null,
  content_type text,
  file_size_bytes bigint,

  status text not null default 'pending'
    check (status in ('pending', 'processing', 'done', 'error')),
  error text,

  -- The classify result once done — same shape as ClassifiedFile in
  -- document-intake-actions.ts (mapping, documentTypeName,
  -- notApplicable, documentNumber, issueDate, expiryDate, confidence,
  -- warnings). Kept as one jsonb blob rather than a column per field
  -- so this table doesn't have to track that type's shape over time;
  -- the panel reads it back the same way it reads the in-memory
  -- version today.
  classified jsonb,

  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists bulk_intake_job_items_job_idx on bulk_intake_job_items(job_id);
-- Used by the worker to pull the next pending batch for a job.
create index if not exists bulk_intake_job_items_pending_idx on bulk_intake_job_items(job_id, status);

alter table bulk_intake_jobs enable row level security;
alter table bulk_intake_job_items enable row level security;

drop policy if exists bulk_intake_jobs_select on bulk_intake_jobs;
create policy bulk_intake_jobs_select on bulk_intake_jobs for select
  using ((org_id = my_org_id() and has_permission('crew.bulk_intake.manage')) or is_platform_admin());

drop policy if exists bulk_intake_jobs_insert on bulk_intake_jobs;
create policy bulk_intake_jobs_insert on bulk_intake_jobs for insert
  with check (org_id = my_org_id() and has_permission('crew.bulk_intake.manage'));

-- Update is allowed from a user session too (e.g. a reviewer cancelling
-- a job, or marking it completed once import finishes) — the worker
-- itself runs under the admin client and bypasses RLS entirely, same
-- as the existing cron routes. This is public.bulk_intake_jobs, not
-- storage.objects, so has_permission() is safe to call here (0013's
-- note is specific to storage.objects policies).
drop policy if exists bulk_intake_jobs_update on bulk_intake_jobs;
create policy bulk_intake_jobs_update on bulk_intake_jobs for update
  using (org_id = my_org_id() and has_permission('crew.bulk_intake.manage'))
  with check (org_id = my_org_id() and has_permission('crew.bulk_intake.manage'));

drop policy if exists bulk_intake_job_items_select on bulk_intake_job_items;
create policy bulk_intake_job_items_select on bulk_intake_job_items for select
  using ((org_id = my_org_id() and has_permission('crew.bulk_intake.manage')) or is_platform_admin());

drop policy if exists bulk_intake_job_items_insert on bulk_intake_job_items;
create policy bulk_intake_job_items_insert on bulk_intake_job_items for insert
  with check (org_id = my_org_id() and has_permission('crew.bulk_intake.manage'));

-- No update policy for job_items under the user's own session — only
-- the admin-client worker ever moves an item from pending to done/error,
-- and that client bypasses RLS. Nothing in the browser needs to write
-- to this table directly.

-- Private bucket — same reasoning as crew-documents (0014): these are
-- the same passports/medical certificates/visas, just staged ahead of
-- review rather than already attached. Same inline-subquery RLS
-- pattern (not my_org_id()/has_permission()) per 0013's finding that
-- those SECURITY DEFINER functions misbehave inside storage.objects
-- policies specifically.
insert into storage.buckets (id, name, public)
values ('bulk-intake-staging', 'bulk-intake-staging', false)
on conflict (id) do nothing;

drop policy if exists bulk_intake_staging_select on storage.objects;
create policy bulk_intake_staging_select on storage.objects for select
  using (
    bucket_id = 'bulk-intake-staging'
    and (storage.foldername(name))[1] = (
      select profiles.org_id::text from profiles where profiles.id = auth.uid()
    )
  );

drop policy if exists bulk_intake_staging_insert on storage.objects;
create policy bulk_intake_staging_insert on storage.objects for insert
  with check (
    bucket_id = 'bulk-intake-staging'
    and (storage.foldername(name))[1] = (
      select profiles.org_id::text from profiles where profiles.id = auth.uid()
    )
  );

-- Delete is needed here (unlike crew-documents, which is append-only
-- forever) — once a job's items are all imported or rejected, its
-- staged files are cleanup, not an audit trail; crew_document_versions
-- is what keeps the ones actually attached. The admin-client cleanup
-- step can always delete regardless of this policy, but this lets a
-- user-session action do it too if that's ever simpler.
drop policy if exists bulk_intake_staging_delete on storage.objects;
create policy bulk_intake_staging_delete on storage.objects for delete
  using (
    bucket_id = 'bulk-intake-staging'
    and (storage.foldername(name))[1] = (
      select profiles.org_id::text from profiles where profiles.id = auth.uid()
    )
  );

commit;
