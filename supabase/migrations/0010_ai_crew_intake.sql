-- ============================================================
-- ComplianceHub — Phase 12: AI-assisted crew onboarding intake
-- (CV / passport / ID scan → draft crew profile + documents)
--
-- Depends on Phase 9 (ai_* infrastructure, lib/ai/router.ts) and the
-- crew_profiles / crew_documents tables (Phase 2 / crew profiles).
-- Run this whole file once, top to bottom, in the Supabase SQL Editor.
-- Safe to re-run.
--
-- Adds: crew_intake_generations (a sibling of ai_generations, scoped to
-- a crew profile instead of a matrix). Reuses the existing
-- ai-source-documents storage bucket and its RLS policies (Phase 9) — no
-- new bucket, no new permission.
--
-- Design notes:
--  * Gated by crew.matrix.manage, the same permission every other AI
--    feature's ai_* tables already require (see phase9 RLS policies) —
--    not crew.manage. This is a deliberate choice: crew.manage gates
--    creating the crew profile itself, crew.documents.manage gates the
--    documents, and crew.matrix.manage gates the AI extraction step.
--    A user needs all three to complete the full intake flow end to
--    end; Company Admin already has all three.
--  * task = 'crew_intake' has no row in ai_task_settings (that table's
--    check constraint only allows the three matrix tasks) — it simply
--    falls back to the company's default routing_mode, same as
--    crew_assistant (see lib/ai/router.ts).
-- ============================================================

begin;

create table if not exists crew_intake_generations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'saved', 'discarded')),
  provider text,
  model_id text,
  prompt_version text,
  input_summary text,
  source_filenames text[] not null default '{}',
  source_document_paths text[] not null default '{}',
  raw_output jsonb,
  crew_profile_id uuid references crew_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);
create index if not exists crew_intake_generations_org_idx on crew_intake_generations(org_id);

alter table crew_intake_generations enable row level security;

drop policy if exists crew_intake_generations_all on crew_intake_generations;
create policy crew_intake_generations_all on crew_intake_generations for all
  using (org_id = my_org_id() and has_permission('crew.matrix.manage'))
  with check (org_id = my_org_id() and has_permission('crew.matrix.manage'));

commit;
