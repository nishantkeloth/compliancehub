-- ============================================================
-- ComplianceHub — Internal chat: private 1:1 direct messages
-- between colleagues at the same company, delivered instantly via
-- Supabase Realtime, shown as a floating widget (like the existing
-- "Ask ComplianceHub" AI assistant bubble).
--
-- Run this whole file once, top to bottom, in the Supabase SQL
-- Editor. Safe to re-run.
--
-- Depends on profiles (id, org_id, full_name, status — untracked,
-- live-only table, same as every other migration in this project
-- that references it) and the untracked my_org_id() RLS helper
-- (already used by every RLS policy in this codebase, e.g. see
-- 0021_phase17_roster_change_requests.sql).
--
-- Design:
--  * chat_conversations is one row per PAIR of colleagues at the
--    same company — never per-message. user_lo_id/user_hi_id store
--    the pair in a canonical (sorted) order so a unique constraint
--    can prevent ever creating two rows for the same two people
--    talking to each other. The app-facing helper
--    find_or_create_chat_conversation() takes the two ids in
--    either order and does the sorting, so callers (server
--    actions) never have to think about which one is "lo" and
--    which is "hi".
--  * chat_messages is one row per message, FK'd to the
--    conversation. Kept deliberately minimal — text body only, no
--    attachments/edits/reactions, matching what was actually asked
--    for.
--  * Unread tracking: chat_conversation_reads (one row per
--    participant per conversation) with last_read_at, updated by
--    the caller when they open/view a thread. Unread count for a
--    conversation = messages with created_at > my last_read_at
--    (or all messages if no row yet). This is the simplest
--    mechanism that supports an unread badge without adding a
--    per-message read receipt table.
--  * RLS: a user may only see/use a conversation they're a
--    participant in, and only within their own company (org_id
--    match on both sides, defence in depth even though the pair
--    should never straddle two orgs). No app-level permission
--    gate — every authenticated team member can message every
--    other team member at their own company, per the locked scope
--    ("Team-wide chat within a company" → private 1:1 DMs).
--  * Realtime: chat_messages (and chat_conversations, so a brand
--    new conversation appearing shows up live too) are added to
--    the supabase_realtime publication so INSERTs push to
--    subscribed clients immediately.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. chat_conversations
-- ------------------------------------------------------------

create table if not exists chat_conversations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  user_lo_id uuid not null references auth.users(id) on delete cascade,
  user_hi_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  constraint chat_conversations_distinct_users check (user_lo_id <> user_hi_id),
  constraint chat_conversations_ordered_pair check (user_lo_id < user_hi_id),
  constraint chat_conversations_unique_pair unique (user_lo_id, user_hi_id)
);
create index if not exists chat_conversations_org_idx on chat_conversations(org_id);
create index if not exists chat_conversations_lo_idx on chat_conversations(user_lo_id);
create index if not exists chat_conversations_hi_idx on chat_conversations(user_hi_id);

alter table chat_conversations enable row level security;

drop policy if exists chat_conversations_select on chat_conversations;
create policy chat_conversations_select on chat_conversations for select
  using (org_id = my_org_id() and auth.uid() in (user_lo_id, user_hi_id));

drop policy if exists chat_conversations_insert on chat_conversations;
create policy chat_conversations_insert on chat_conversations for insert
  with check (org_id = my_org_id() and auth.uid() in (user_lo_id, user_hi_id));

drop policy if exists chat_conversations_update on chat_conversations;
create policy chat_conversations_update on chat_conversations for update
  using (org_id = my_org_id() and auth.uid() in (user_lo_id, user_hi_id))
  with check (org_id = my_org_id() and auth.uid() in (user_lo_id, user_hi_id));

-- ------------------------------------------------------------
-- 2. chat_messages
-- ------------------------------------------------------------

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references companies(id) on delete cascade,
  conversation_id uuid not null references chat_conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id),
  body text not null check (length(trim(body)) > 0 and length(body) <= 4000),
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_conversation_idx on chat_messages(conversation_id, created_at);
create index if not exists chat_messages_org_idx on chat_messages(org_id);

alter table chat_messages enable row level security;

drop policy if exists chat_messages_select on chat_messages;
create policy chat_messages_select on chat_messages for select
  using (
    org_id = my_org_id()
    and exists (
      select 1 from chat_conversations c
      where c.id = chat_messages.conversation_id
        and auth.uid() in (c.user_lo_id, c.user_hi_id)
    )
  );

drop policy if exists chat_messages_insert on chat_messages;
create policy chat_messages_insert on chat_messages for insert
  with check (
    org_id = my_org_id()
    and sender_id = auth.uid()
    and exists (
      select 1 from chat_conversations c
      where c.id = chat_messages.conversation_id
        and auth.uid() in (c.user_lo_id, c.user_hi_id)
    )
  );

-- Keep chat_conversations.last_message_at current so conversation
-- lists can sort "most recently active" without a join+aggregate.
create or replace function touch_chat_conversation_last_message()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update chat_conversations
  set last_message_at = new.created_at
  where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists chat_messages_touch_conversation_trg on chat_messages;
create trigger chat_messages_touch_conversation_trg
  after insert on chat_messages
  for each row execute function touch_chat_conversation_last_message();

-- ------------------------------------------------------------
-- 3. chat_conversation_reads — per-participant "read up to" marker,
--    drives the unread badge.
-- ------------------------------------------------------------

create table if not exists chat_conversation_reads (
  conversation_id uuid not null references chat_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

alter table chat_conversation_reads enable row level security;

drop policy if exists chat_conversation_reads_select on chat_conversation_reads;
create policy chat_conversation_reads_select on chat_conversation_reads for select
  using (user_id = auth.uid());

drop policy if exists chat_conversation_reads_upsert on chat_conversation_reads;
create policy chat_conversation_reads_upsert on chat_conversation_reads for insert
  with check (user_id = auth.uid());

drop policy if exists chat_conversation_reads_update on chat_conversation_reads;
create policy chat_conversation_reads_update on chat_conversation_reads for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ------------------------------------------------------------
-- 4. find_or_create_chat_conversation — the one write path for
--    "start (or resume) a DM with this colleague". Callers pass
--    the two user ids in either order; this sorts them into
--    user_lo_id/user_hi_id and either returns the existing row or
--    creates it. security definer + explicit org/membership checks
--    inside, so a single well-audited function can do the insert
--    even though the RLS insert policy above also independently
--    protects direct inserts.
-- ------------------------------------------------------------

create or replace function find_or_create_chat_conversation(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_me uuid := auth.uid();
  v_my_org uuid;
  v_other_org uuid;
  v_lo uuid;
  v_hi uuid;
  v_id uuid;
begin
  if v_me is null then
    raise exception 'Not authenticated';
  end if;
  if p_other_user_id = v_me then
    raise exception 'Cannot start a conversation with yourself';
  end if;

  select org_id into v_my_org from profiles where id = v_me;
  select org_id into v_other_org from profiles where id = p_other_user_id;

  if v_my_org is null or v_other_org is null or v_my_org <> v_other_org then
    raise exception 'That person is not at your company';
  end if;

  if v_me < p_other_user_id then
    v_lo := v_me; v_hi := p_other_user_id;
  else
    v_lo := p_other_user_id; v_hi := v_me;
  end if;

  select id into v_id from chat_conversations where user_lo_id = v_lo and user_hi_id = v_hi;
  if v_id is not null then
    return v_id;
  end if;

  insert into chat_conversations (org_id, user_lo_id, user_hi_id)
  values (v_my_org, v_lo, v_hi)
  returning id into v_id;

  return v_id;
end;
$$;

-- ------------------------------------------------------------
-- 4b. mark_conversation_read / chat_unread_counts — the read-state
--    helpers the widget needs: one to stamp "I've seen this thread
--    up to now" when a thread is opened, one to compute the unread
--    badge for every conversation in a single round trip instead of
--    N queries (one per conversation) from the app layer.
-- ------------------------------------------------------------

create or replace function mark_conversation_read(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'Not authenticated';
  end if;
  if not exists (
    select 1 from chat_conversations
    where id = p_conversation_id and v_me in (user_lo_id, user_hi_id)
  ) then
    raise exception 'Not a participant in that conversation';
  end if;

  insert into chat_conversation_reads (conversation_id, user_id, last_read_at)
  values (p_conversation_id, v_me, now())
  on conflict (conversation_id, user_id)
  do update set last_read_at = excluded.last_read_at;
end;
$$;

create or replace function chat_unread_counts()
returns table (conversation_id uuid, unread_count bigint)
language sql
security definer
set search_path to 'public'
stable
as $$
  select m.conversation_id, count(*)::bigint as unread_count
  from chat_messages m
  join chat_conversations c on c.id = m.conversation_id
  left join chat_conversation_reads r
    on r.conversation_id = m.conversation_id and r.user_id = auth.uid()
  where auth.uid() in (c.user_lo_id, c.user_hi_id)
    and m.sender_id <> auth.uid()
    and m.created_at > coalesce(r.last_read_at, 'epoch'::timestamptz)
  group by m.conversation_id;
$$;

-- ------------------------------------------------------------
-- 5. Realtime — register the tables so inserts push to subscribed
--    clients immediately. Wrapped so re-running this file doesn't
--    error if they're already registered.
-- ------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'chat_messages'
  ) then
    execute 'alter publication supabase_realtime add table chat_messages';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'chat_conversations'
  ) then
    execute 'alter publication supabase_realtime add table chat_conversations';
  end if;
end $$;

commit;
