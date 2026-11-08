
-- ============================================================
-- 0001_schema.sql
-- LiveChat: tables, constraints, indexes
-- Compatible with existing production Supabase database.
-- ============================================================

create extension if not exists pgcrypto;

-- ============================================================
-- APP SETTINGS
-- ============================================================

create table if not exists public.app_settings (
  key   text primary key,
  value text not null
);

insert into public.app_settings (key, value)
values
  ('retention_minutes', '1440'),
  ('max_messages_per_10s', '20'),
  ('max_invites_per_hour', '20'),
  ('max_upload_mb', '10')
on conflict (key) do nothing;

alter table public.app_settings enable row level security;

create or replace function public.get_setting(p_key text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select value
  from public.app_settings
  where key = p_key
$$;

create or replace function public.retention_interval()
returns interval
language sql
stable
security definer
set search_path = public
as $$
  select make_interval(
    mins => coalesce(public.get_setting('retention_minutes')::int, 1440)
  )
$$;


-- ============================================================
-- PROFILES
-- Preserve existing table, primary key and usernames.
-- ============================================================

create table if not exists public.profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  username           text not null unique
                     check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name       text check (display_name is null or char_length(display_name) <= 50),
  avatar_path        text,
  show_online_status boolean not null default true,
  send_read_receipts boolean not null default true,
  share_typing       boolean not null default true,
  last_seen_at       timestamptz,
  created_at         timestamptz not null default now()
);

-- Upgrade the existing profiles table without dropping it.

alter table public.profiles
  add column if not exists display_name text,
  add column if not exists avatar_path text,
  add column if not exists show_online_status boolean not null default true,
  add column if not exists send_read_receipts boolean not null default true,
  add column if not exists share_typing boolean not null default true,
  add column if not exists last_seen_at timestamptz;

alter table public.profiles
  alter column created_at set default now();

-- Backfill nullable timestamps before enforcing NOT NULL.

update public.profiles
set created_at = now()
where created_at is null;

alter table public.profiles
  alter column created_at set not null;

-- Ensure the username validation constraint exists.

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_username_format_check'
  ) then
    alter table public.profiles
      add constraint profiles_username_format_check
      check (username ~ '^[a-z0-9_]{3,20}$');
  end if;
end
$$;

-- Create profiles for existing Auth users who do not have one.
-- Existing profiles and usernames are never overwritten.

do $$
declare
  u record;
  base_name text;
  candidate text;
begin
  for u in
    select id, raw_user_meta_data
    from auth.users
    where not exists (
      select 1
      from public.profiles p
      where p.id = auth.users.id
    )
  loop
    base_name := regexp_replace(
      lower(coalesce(u.raw_user_meta_data ->> 'username', '')),
      '[^a-z0-9_]',
      '',
      'g'
    );

    if char_length(base_name) < 3 then
      base_name := 'user' || substr(
        replace(u.id::text, '-', ''),
        1,
        8
      );
    end if;

    base_name := left(base_name, 12);
    candidate := left(base_name, 20);

    while exists (
      select 1
      from public.profiles
      where username = candidate
    ) loop
      candidate := left(base_name, 12) || '_' ||
        substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
    end loop;

    insert into public.profiles (id, username)
    values (u.id, candidate)
    on conflict (id) do nothing;
  end loop;
end
$$;


-- ============================================================
-- INVITATIONS
-- ============================================================

create table if not exists public.invitations (
  id              uuid primary key default gen_random_uuid(),
  inviter_id      uuid not null references public.profiles (id) on delete cascade,
  invitee_id      uuid references public.profiles (id) on delete cascade,
  invitee_email   text,
  invitee_phone   text,
  target_label    text,
  status          text not null default 'pending'
                  check (status in ('pending','accepted','rejected','cancelled')),
  conversation_id uuid,
  created_at      timestamptz not null default now(),
  responded_at    timestamptz,
  expires_at      timestamptz not null default (now() + interval '7 days'),
  check (num_nonnulls(invitee_id, invitee_email, invitee_phone) >= 1)
);

create index if not exists invitations_invitee_idx
  on public.invitations (invitee_id)
  where status = 'pending';

create index if not exists invitations_inviter_idx
  on public.invitations (inviter_id, created_at desc);

create index if not exists invitations_email_idx
  on public.invitations (invitee_email)
  where status = 'pending';

create index if not exists invitations_phone_idx
  on public.invitations (invitee_phone)
  where status = 'pending';

create index if not exists invitations_expires_idx
  on public.invitations (expires_at);


-- ============================================================
-- CONVERSATIONS
-- ============================================================

create table if not exists public.conversations (
  id         uuid primary key default gen_random_uuid(),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default
    (now() + public.retention_interval())
);

create index if not exists conversations_expires_idx
  on public.conversations (expires_at);


-- ============================================================
-- CONVERSATION PARTICIPANTS
-- ============================================================

create table if not exists public.conversation_participants (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  status          text not null default 'active'
                  check (status in ('active','ended')),
  joined_at       timestamptz not null default now(),
  ended_at        timestamptz,
  last_read_at    timestamptz,
  unique (conversation_id, user_id)
);

create index if not exists cp_user_idx
  on public.conversation_participants (user_id)
  where status = 'active';

create index if not exists cp_conv_idx
  on public.conversation_participants (conversation_id);


-- ============================================================
-- MESSAGES
-- Replace old empty bigint-based legacy table.
-- Never use CASCADE: unexpected dependencies must stop migration.
-- ============================================================

do $$
begin
  if to_regclass('public.messages') is not null then

    if exists (select 1 from public.messages limit 1) then
      raise exception
        'Migration stopped: legacy messages table contains data. Preserve and migrate it before replacement.';
    end if;

    drop table public.messages;
  end if;
end
$$;

create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid not null references public.profiles (id) on delete cascade,
  kind            text not null default 'text'
                  check (kind in ('text','image','system')),
  body            text check (body is null or char_length(body) <= 4000),
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  delivered_at    timestamptz,
  read_at         timestamptz
);

create index messages_conv_created_idx
  on public.messages (conversation_id, created_at);

create index messages_expires_idx
  on public.messages (expires_at);

create index messages_sender_idx
  on public.messages (sender_id, created_at desc);


-- ============================================================
-- MEDIA ATTACHMENTS
-- ============================================================

create table if not exists public.media_attachments (
  id              uuid primary key default gen_random_uuid(),
  message_id      uuid not null references public.messages (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  uploader_id     uuid not null references public.profiles (id) on delete cascade,
  storage_path    text not null unique,
  mime_type       text not null,
  size_bytes      bigint not null check (size_bytes > 0),
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null
);

create index if not exists media_message_idx
  on public.media_attachments (message_id);

create index if not exists media_expires_idx
  on public.media_attachments (expires_at);

create index if not exists media_conv_idx
  on public.media_attachments (conversation_id);


-- ============================================================
-- CALL SESSIONS
-- Audio/video is peer-to-peer. No media recording or storage.
-- ============================================================

create table if not exists public.call_sessions (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  caller_id       uuid not null references public.profiles (id) on delete cascade,
  callee_id       uuid not null references public.profiles (id) on delete cascade,
  type            text not null default 'video'
                  check (type in ('video','audio')),
  status          text not null default 'ringing'
                  check (status in ('ringing','active','ended','rejected','missed')),
  created_at      timestamptz not null default now(),
  answered_at     timestamptz,
  ended_at        timestamptz,
  expires_at      timestamptz not null
);

create index if not exists call_conv_idx
  on public.call_sessions (conversation_id);

create index if not exists call_callee_idx
  on public.call_sessions (callee_id, status);


-- ============================================================
-- END 0001_schema.sql
-- ============================================================
