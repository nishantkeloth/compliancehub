-- ============================================================
-- ComplianceHub — Phase 9: AI-assisted Crew Matrix generation with
-- configurable (free / paid) models
--
-- Depends on Phase 2 (crew_matrices). Run this whole file once, top to
-- bottom, in the Supabase SQL Editor. Safe to re-run.
--
-- Adds: ai_settings, ai_provider_keys (encrypted), ai_models,
-- ai_task_settings, ai_norm_overrides, ai_name_aliases, ai_usage_log,
-- ai_generations; crew_matrices.generation_method / ai_generation_id;
-- a private storage bucket for optional source-document retention;
-- permission ai.configure.
--
-- Design notes (see claude/phase9-ai-crew-matrix.md):
--  * API keys are encrypted by the app (AES-256-GCM with the
--    AI_KEY_ENCRYPTION_SECRET env var) before they reach this table and
--    are never selected by any page — only key_hint (last 4) is shown.
--  * "Free tokens over" is tracked from ai_usage_log per model per
--    month against ai_models.free_monthly_token_allowance, plus provider
--    quota errors at call time (lib/ai/router.ts).
--  * Catering norms have code defaults; only overrides are stored.
-- ============================================================

begin;

create table if not exists ai_settings (
  org_id uuid primary key references companies(id) on delete cascade,
  ai_enabled boolean not null default true,
  routing_mode text not null default 'free_then_paid'
    check (routing_mode in ('free_only', 'free_then_paid', 'paid_only')),
  monthly_paid_spend_cap numeric(12, 2),
  keep_source_documents boolean not null default false,
  max_upload_mb integer not null default 20,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create table if not exists ai_provider_keys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  provider text not null check (provider in ('anthropic', 'openai', 'google', 'groq', 'openrouter', 'ollama')),
  encrypted_key text,
  key_hint text,
  base_url text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  unique (org_id, provider)
);

create table if not exists ai_models (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  provider text not null check (provider in ('anthropic', 'openai', 'google', 'groq', 'openrouter', 'ollama')),
  model_id text not null,
  display_name text not null,
  cost_tier text not null default 'paid' check (cost_tier in ('free', 'paid')),
  input_cost_per_1k numeric(10, 6) not null default 0,
  output_cost_per_1k numeric(10, 6) not null default 0,
  free_monthly_token_allowance bigint,
  free_reset_day integer not null default 1 check (free_reset_day between 1 and 28),
  supports_documents boolean not null default false,
  max_context integer,
  is_enabled boolean not null default true,
  priority integer not null default 100,
  created_at timestamptz not null default now(),
  unique (org_id, provider, model_id)
);
create index if not exists ai_models_org_idx on ai_models(org_id);

create table if not exists ai_task_settings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  task text not null check (task in ('matrix_from_document', 'matrix_from_context', 'matrix_review')),
  routing_mode text check (routing_mode in ('free_only', 'free_then_paid', 'paid_only')),
  model_ids uuid[] not null default '{}',
  updated_at timestamptz not null default now(),
  unique (org_id, task)
);

create table if not exists ai_norm_overrides (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  norm_key text not null,
  value_text text not null,
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  unique (org_id, norm_key)
);

create table if not exists ai_name_aliases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  entity_type text not null check (entity_type in ('job_role', 'skill', 'document_type', 'rotation_template')),
  alias text not null,
  target_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);
create unique index if not exists ai_name_aliases_unique_idx on ai_name_aliases(org_id, entity_type, lower(alias));

create table if not exists ai_usage_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  task text not null,
  provider text,
  model_id text,
  cost_tier text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  estimated_cost numeric(12, 6) not null default 0,
  duration_ms integer,
  status text not null check (status in ('ok', 'error', 'skipped')),
  fallback_reason text,
  error_message text,
  user_id uuid references auth.users(id),
  crew_matrix_id uuid references crew_matrices(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_log_org_month_idx on ai_usage_log(org_id, created_at);

create table if not exists ai_generations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  task text not null,
  project_id uuid references projects(id) on delete set null,
  offshore_site_id uuid references offshore_sites(id) on delete set null,
  crew_matrix_id uuid references crew_matrices(id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'saved', 'discarded')),
  provider text,
  model_id text,
  prompt_version text,
  input_summary text,
  source_filename text,
  source_document_path text,
  raw_output jsonb,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);
create index if not exists ai_generations_org_idx on ai_generations(org_id);

alter table crew_matrices add column if not exists generation_method text not null default 'manual';
alter table crew_matrices add column if not exists ai_generation_id uuid references ai_generations(id) on delete set null;

-- ------------------------------------------------------------
-- Storage bucket for optional source-document retention (private).
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('ai-source-documents', 'ai-source-documents', false)
on conflict (id) do nothing;

drop policy if exists ai_source_documents_select on storage.objects;
create policy ai_source_documents_select on storage.objects for select
  using (bucket_id = 'ai-source-documents' and (storage.foldername(name))[1] = my_org_id()::text and has_permission('crew.matrix.view'));
drop policy if exists ai_source_documents_insert on storage.objects;
create policy ai_source_documents_insert on storage.objects for insert
  with check (bucket_id = 'ai-source-documents' and (storage.foldername(name))[1] = my_org_id()::text and has_permission('crew.matrix.manage'));

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
alter table ai_settings enable row level security;
alter table ai_provider_keys enable row level security;
alter table ai_models enable row level security;
alter table ai_task_settings enable row level security;
alter table ai_norm_overrides enable row level security;
alter table ai_name_aliases enable row level security;
alter table ai_usage_log enable row level security;
alter table ai_generations enable row level security;

-- Settings / models / task routing / norms: readable by anyone who can
-- create a matrix (the generator needs them), writable by ai.configure.
drop policy if exists ai_settings_select on ai_settings;
create policy ai_settings_select on ai_settings for select
  using ((org_id = my_org_id() and (has_permission('crew.matrix.manage') or has_permission('ai.configure'))) or is_platform_admin());
drop policy if exists ai_settings_write on ai_settings;
create policy ai_settings_write on ai_settings for all
  using (org_id = my_org_id() and has_permission('ai.configure'))
  with check (org_id = my_org_id() and has_permission('ai.configure'));

drop policy if exists ai_provider_keys_select on ai_provider_keys;
create policy ai_provider_keys_select on ai_provider_keys for select
  using (org_id = my_org_id() and (has_permission('crew.matrix.manage') or has_permission('ai.configure')));
drop policy if exists ai_provider_keys_write on ai_provider_keys;
create policy ai_provider_keys_write on ai_provider_keys for all
  using (org_id = my_org_id() and has_permission('ai.configure'))
  with check (org_id = my_org_id() and has_permission('ai.configure'));

drop policy if exists ai_models_select on ai_models;
create policy ai_models_select on ai_models for select
  using ((org_id = my_org_id() and (has_permission('crew.matrix.manage') or has_permission('ai.configure'))) or is_platform_admin());
drop policy if exists ai_models_write on ai_models;
create policy ai_models_write on ai_models for all
  using (org_id = my_org_id() and has_permission('ai.configure'))
  with check (org_id = my_org_id() and has_permission('ai.configure'));

drop policy if exists ai_task_settings_select on ai_task_settings;
create policy ai_task_settings_select on ai_task_settings for select
  using (org_id = my_org_id() and (has_permission('crew.matrix.manage') or has_permission('ai.configure')));
drop policy if exists ai_task_settings_write on ai_task_settings;
create policy ai_task_settings_write on ai_task_settings for all
  using (org_id = my_org_id() and has_permission('ai.configure'))
  with check (org_id = my_org_id() and has_permission('ai.configure'));

drop policy if exists ai_norm_overrides_select on ai_norm_overrides;
create policy ai_norm_overrides_select on ai_norm_overrides for select
  using (org_id = my_org_id() and (has_permission('crew.matrix.manage') or has_permission('ai.configure')));
drop policy if exists ai_norm_overrides_write on ai_norm_overrides;
create policy ai_norm_overrides_write on ai_norm_overrides for all
  using (org_id = my_org_id() and has_permission('ai.configure'))
  with check (org_id = my_org_id() and has_permission('ai.configure'));

drop policy if exists ai_name_aliases_all on ai_name_aliases;
create policy ai_name_aliases_all on ai_name_aliases for all
  using (org_id = my_org_id() and has_permission('crew.matrix.manage'))
  with check (org_id = my_org_id() and has_permission('crew.matrix.manage'));

drop policy if exists ai_usage_log_select on ai_usage_log;
create policy ai_usage_log_select on ai_usage_log for select
  using ((org_id = my_org_id() and (has_permission('crew.matrix.manage') or has_permission('ai.configure'))) or is_platform_admin());
drop policy if exists ai_usage_log_insert on ai_usage_log;
create policy ai_usage_log_insert on ai_usage_log for insert
  with check (org_id = my_org_id() and has_permission('crew.matrix.manage'));

drop policy if exists ai_generations_all on ai_generations;
create policy ai_generations_all on ai_generations for all
  using (org_id = my_org_id() and has_permission('crew.matrix.manage'))
  with check (org_id = my_org_id() and has_permission('crew.matrix.manage'));

-- ------------------------------------------------------------
-- Permission
-- ------------------------------------------------------------
insert into permissions (key, label, description) values
  ('ai.configure', 'Configure AI', 'Manage AI providers, API keys, models, routing (free / paid), catering norms and see AI usage')
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_key)
select r.id, p.key from roles r join permissions p on p.key = 'ai.configure'
where r.system_key = 'company_admin'
on conflict do nothing;

commit;
