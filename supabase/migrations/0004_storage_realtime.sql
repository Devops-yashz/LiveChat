
-- ============================================================
-- 0004_storage_realtime.sql
-- LiveChat: private storage buckets and realtime
-- ============================================================

-- ============================================================
-- STORAGE BUCKETS
-- ============================================================

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values
(
  'chat-media',
  'chat-media',
  false,
  10485760,
  array[
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/avif',
    'image/heic',
    'image/heif'
  ]
),
(
  'avatars',
  'avatars',
  false,
  2097152,
  array[
    'image/jpeg',
    'image/png',
    'image/webp'
  ]
)
on conflict (id)
do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ============================================================
-- REMOVE EXISTING POLICIES
-- ============================================================

drop policy if exists chat_media_insert
on storage.objects;

drop policy if exists chat_media_select
on storage.objects;

drop policy if exists avatars_select
on storage.objects;

drop policy if exists avatars_insert
on storage.objects;

drop policy if exists avatars_update
on storage.objects;

drop policy if exists avatars_delete
on storage.objects;

-- ============================================================
-- CHAT MEDIA
-- ============================================================

create policy chat_media_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'chat-media'
  and public.storage_conv_ok(name)
);

create policy chat_media_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'chat-media'
  and public.can_read_media(name)
);

-- No client update/delete permissions for chat media.

-- ============================================================
-- AVATARS
-- ============================================================

create policy avatars_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'avatars'
  and public.can_read_avatar(name)
);

create policy avatars_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and split_part(name, '/', 1) = (select auth.uid())::text
);

create policy avatars_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'avatars'
  and split_part(name, '/', 1) = (select auth.uid())::text
)
with check (
  bucket_id = 'avatars'
  and split_part(name, '/', 1) = (select auth.uid())::text
);

create policy avatars_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'avatars'
  and split_part(name, '/', 1) = (select auth.uid())::text
);

-- ============================================================
-- REALTIME PUBLICATION
-- ============================================================

-- Add tables only if they are not already in publication.

do $$
declare
  tbl text;
begin

  foreach tbl in array array[
    'messages',
    'invitations',
    'conversation_participants',
    'call_sessions'
  ]
  loop

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = tbl
    ) then

      execute format(
        'alter publication supabase_realtime add table public.%I',
        tbl
      );

    end if;

  end loop;

end;
$$;

-- ============================================================
-- REALTIME BROADCAST AUTHORIZATION
-- ============================================================

drop policy if exists "conv members can receive broadcast"
on realtime.messages;

drop policy if exists "conv members can send broadcast"
on realtime.messages;

create policy "conv members can receive broadcast"
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and public.topic_conv_ok((select realtime.topic()))
);

create policy "conv members can send broadcast"
on realtime.messages
for insert
to authenticated
with check (
  realtime.messages.extension = 'broadcast'
  and public.topic_conv_ok((select realtime.topic()))
);

-- ============================================================
-- END 0004
-- ============================================================
