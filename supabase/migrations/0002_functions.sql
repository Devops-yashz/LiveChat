-- 0002_functions.sql : helpers used by RLS, triggers, and RPCs (all state-changing logic lives here)


-- 0002 completion: helper functions

CREATE OR REPLACE FUNCTION public.is_participant(p_conv uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversation_participants cp
    JOIN public.conversations c ON c.id = cp.conversation_id
    WHERE cp.conversation_id = p_conv
      AND cp.user_id = auth.uid()
      AND c.expires_at > now()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active_participant(p_conv uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversation_participants cp
    JOIN public.conversations c ON c.id = cp.conversation_id
    WHERE cp.conversation_id = p_conv
      AND cp.user_id = auth.uid()
      AND cp.status = 'active'
      AND c.expires_at > now()
  );
$$;

CREATE OR REPLACE FUNCTION public.can_send(p_conv uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_active_participant(p_conv)
  AND EXISTS (
    SELECT 1
    FROM public.conversation_participants o
    WHERE o.conversation_id = p_conv
      AND o.user_id <> auth.uid()
      AND o.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.shares_conversation(p_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversation_participants a
    JOIN public.conversation_participants b
      ON b.conversation_id = a.conversation_id
    JOIN public.conversations c
      ON c.id = a.conversation_id
    WHERE a.user_id = auth.uid()
      AND a.status = 'active'
      AND b.user_id = p_uid
      AND c.expires_at > now()
  );
$$;

CREATE OR REPLACE FUNCTION public.has_invitation_with(p_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.invitations i
    WHERE i.inviter_id = p_uid
      AND i.status = 'pending'
      AND i.expires_at > now()
      AND (
        i.invitee_id = auth.uid()
        OR i.invitee_email = lower(coalesce(auth.jwt() ->> 'email', ''))
        OR i.invitee_phone = coalesce(auth.jwt() ->> 'phone', '')
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.get_retention_minutes()
RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(public.get_setting('retention_minutes')::int, 1440);
$$;

-- Message trigger function
CREATE OR REPLACE FUNCTION public.messages_before_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  conv_exp timestamptz;
  recent int;
  lim int;
BEGIN
  SELECT expires_at INTO conv_exp
  FROM public.conversations
  WHERE id = NEW.conversation_id;

  IF conv_exp IS NULL OR conv_exp <= now() THEN
    RAISE EXCEPTION 'conversation_expired';
  END IF;

  NEW.created_at := now();
  NEW.expires_at := least(
    now() + public.retention_interval(),
    conv_exp
  );

  NEW.delivered_at := NULL;
  NEW.read_at := NULL;

  IF NEW.kind <> 'system' THEN
    lim := coalesce(public.get_setting('max_messages_per_10s')::int, 20);

    SELECT count(*) INTO recent
    FROM public.messages
    WHERE sender_id = NEW.sender_id
      AND kind <> 'system'
      AND created_at > now() - interval '10 seconds';

    IF recent >= lim THEN
      RAISE EXCEPTION 'rate_limited';
    END IF;

    IF NEW.kind = 'text'
       AND char_length(btrim(coalesce(NEW.body, ''))) = 0 THEN
      RAISE EXCEPTION 'empty_message';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_before_insert_trg ON public.messages;

CREATE TRIGGER messages_before_insert_trg
BEFORE INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.messages_before_insert();


-- realtime topics look like "conv:<conversation_id>"
create or replace function public.topic_conv_ok(p_topic text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if p_topic !~ '^conv:[0-9a-f-]{36}$' then return false; end if;
  return public.is_active_participant(substr(p_topic, 6)::uuid);
exception when others then
  return false;
end $$;


-- ======================================================
-- NEW USER -> PROFILE
-- Safe, idempotent, concurrency-aware
-- ======================================================

create or replace function public.ensure_profile(
  p_uid uuid,
  p_metadata jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base text;
  v_username text;
  v_attempt int := 0;
begin
  if p_uid is null then
    raise exception 'invalid_user';
  end if;

  -- Profile already exists.
  if exists (
    select 1
    from public.profiles
    where id = p_uid
  ) then
    return;
  end if;

  -- Sanitize requested username.
  v_base := regexp_replace(
    lower(coalesce(p_metadata ->> 'username', '')),
    '[^a-z0-9_]',
    '',
    'g'
  );

  if char_length(v_base) < 3 then
    v_base := 'user';
  end if;

  v_base := left(v_base, 20);

  -- Retry on username collisions.
  loop
    v_attempt := v_attempt + 1;

    if v_attempt = 1 then
      v_username := v_base;
    else
      v_username :=
        left(v_base, 12)
        || '_'
        || substr(
          replace(gen_random_uuid()::text, '-', ''),
          1,
          6
        );
    end if;

    begin
      insert into public.profiles (
        id,
        username
      )
      values (
        p_uid,
        v_username
      )
      on conflict (id) do nothing;

      -- Check whether this user now has a profile.
      if exists (
        select 1
        from public.profiles
        where id = p_uid
      ) then
        return;
      end if;

    exception
      when unique_violation then
        -- Username already belongs to another user.
        -- Retry with a new username.
        null;
    end;

    if v_attempt >= 20 then
      raise exception 'profile_creation_failed';
    end if;
  end loop;
end;
$$;


-- ======================================================
-- AUTH USER TRIGGER FUNCTION
-- ======================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.ensure_profile(
    new.id,
    new.raw_user_meta_data
  );

  return new;
end;
$$;


-- ======================================================
-- SAFE TRIGGER CREATION
-- ======================================================

drop trigger if exists on_auth_user_created
on auth.users;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();


-- ======================================================
-- FUNCTION PRIVILEGES
-- ======================================================

revoke all on function public.ensure_profile(uuid, jsonb)
from public, anon, authenticated;

revoke all on function public.handle_new_user()
from public, anon, authenticated;


-- Backfill profiles for users who existed before this migration.
do $$
declare
  u record;
begin
  for u in
    select au.id, au.raw_user_meta_data
    from auth.users au
    left join public.profiles p on p.id = au.id
    where p.id is null
  loop
    perform public.ensure_profile(
      u.id,
      u.raw_user_meta_data
    );
  end loop;
end;
$$;

create or replace function public.username_available(
  p_username text
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    p_username ~ '^[a-z0-9_]{3,20}$'
    and not exists (
      select 1
      from public.profiles
      where username = p_username
    ),
    false
  );
$$;

create or replace function public.get_retention_minutes()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.get_setting('retention_minutes')::int,
    1440
  );
$$;
-- ============================================= message trigger (server rules)
create or replace function public.messages_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare conv_exp timestamptz; recent int; lim int;
begin
  select expires_at into conv_exp from public.conversations where id = new.conversation_id;
  if conv_exp is null or conv_exp <= now() then raise exception 'conversation_expired'; end if;

  new.created_at   := now();
  new.expires_at   := least(now() + public.retention_interval(), conv_exp);  -- server decides lifetime
  new.delivered_at := null;
  new.read_at      := null;

  if new.kind <> 'system' then
    lim := coalesce(public.get_setting('max_messages_per_10s')::int, 20);
    select count(*) into recent from public.messages
      where sender_id = new.sender_id and kind <> 'system' and created_at > now() - interval '10 seconds';
    if recent >= lim then raise exception 'rate_limited'; end if;
    if new.kind = 'text' and char_length(btrim(coalesce(new.body, ''))) = 0 then
      raise exception 'empty_message';
    end if;
  end if;
  return new;
end $$;

DROP TRIGGER IF EXISTS messages_before_insert_trg ON public.messages;

CREATE TRIGGER messages_before_insert_trg
BEFORE INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.messages_before_insert();

-- ======================================================
-- invitations

create or replace function public.create_invitation(
  p_inviter uuid,
  p_identifier text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ident text := btrim(coalesce(p_identifier, ''));
  kind text;
  target uuid;
  phone_e164 text;
  recent int;
  lim int;
  dup boolean := false;
begin
  if p_inviter is null
     or ident = ''
     or char_length(ident) > 254 then
    raise exception 'invalid_identifier';
  end if;

  lim := coalesce(
    public.get_setting('max_invites_per_hour')::int,
    20
  );

  select count(*) into recent
  from public.invitations
  where inviter_id = p_inviter
    and created_at > now() - interval '1 hour';

  if recent >= lim then
    raise exception 'rate_limited';
  end if;

  -- Email
  if ident ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then

    kind := 'email';
    ident := lower(ident);

    select id into target
    from auth.users
    where lower(email) = ident
    limit 1;

  -- Phone: normalize to E.164
  elsif ident ~ '^\+[0-9][0-9 ()-]{6,18}$' then

    kind := 'phone';

    phone_e164 := '+' ||
      regexp_replace(ident, '[^0-9]', '', 'g');

    if char_length(phone_e164) < 8
       or char_length(phone_e164) > 16 then
      raise exception 'invalid_identifier';
    end if;

    -- Supabase Auth stores the phone in E.164 format.
    select id into target
    from auth.users
    where phone = phone_e164
    limit 1;

  -- Username
  elsif ident ~ '^@?[A-Za-z0-9_]{3,20}$' then

    kind := 'username';

    select id into target
    from public.profiles
    where username = lower(ltrim(ident, '@'));

  else
    raise exception 'invalid_identifier';
  end if;

  if target is not null and target = p_inviter then
    raise exception 'cannot_invite_self';
  end if;

  -- Do not reveal whether an unknown username is registered.
  if kind = 'username' and target is null then
    return jsonb_build_object(
      'registered', false,
      'kind', kind,
      'duplicate', false
    );
  end if;

  if target is not null then

    dup := exists (
      select 1
      from public.invitations
      where inviter_id = p_inviter
        and invitee_id = target
        and status = 'pending'
        and expires_at > now()
    );

  elsif kind = 'email' then

    dup := exists (
      select 1
      from public.invitations
      where inviter_id = p_inviter
        and invitee_email = ident
        and status = 'pending'
        and expires_at > now()
    );

  else

    dup := exists (
      select 1
      from public.invitations
      where inviter_id = p_inviter
        and invitee_phone = phone_e164
        and status = 'pending'
        and expires_at > now()
    );

  end if;

  if not dup then

    insert into public.invitations (
      inviter_id,
      invitee_id,
      invitee_email,
      invitee_phone,
      target_label
    )
    values (
      p_inviter,
      target,
      case
        when target is null and kind = 'email' then ident
      end,
      case
        when target is null and kind = 'phone' then phone_e164
      end,
      left(btrim(p_identifier), 100)
    );

  end if;

  return jsonb_build_object(
    'registered', target is not null,
    'kind', kind,
    'duplicate', dup,
    'email', case when kind = 'email' then ident end,
    'phone', phone_e164
  );
end;
$$;


-- Accept / reject invitation.
-- Conversation creation and participant insertion are atomic.

create or replace function public.respond_invitation(
  p_id uuid,
  p_accept boolean
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.invitations;
  conv uuid;
  user_email text;
  user_phone text;
begin
  if auth.uid() is null then
    raise exception 'not_allowed';
  end if;

  if p_id is null or p_accept is null then
    raise exception 'invalid_request';
  end if;

  user_email := lower(
    coalesce(auth.jwt() ->> 'email', '')
  );

  user_phone := coalesce(
    auth.jwt() ->> 'phone',
    ''
  );

  select *
  into inv
  from public.invitations
  where id = p_id
    and status = 'pending'
    and expires_at > now()
  for update;

  if not found then
    raise exception 'invitation_not_found';
  end if;

  -- Prevent accepting your own invitation.
  if inv.inviter_id = auth.uid() then
    raise exception 'not_allowed';
  end if;

  -- Validate recipient identity.
  if not (
    inv.invitee_id = auth.uid()
    or (
      inv.invitee_email is not null
      and inv.invitee_email = user_email
    )
    or (
      inv.invitee_phone is not null
      and inv.invitee_phone = user_phone
    )
  ) then
    raise exception 'not_allowed';
  end if;

  if not p_accept then

    update public.invitations
    set status = 'rejected',
        responded_at = now(),
        invitee_id = auth.uid()
    where id = p_id;

    return null;
  end if;

  -- Create conversation.
  insert into public.conversations (created_by)
  values (inv.inviter_id)
  returning id into conv;

  -- Create both participants atomically.
  insert into public.conversation_participants (
    conversation_id,
    user_id
  )
  values
    (conv, inv.inviter_id),
    (conv, auth.uid());

  update public.invitations
  set status = 'accepted',
      responded_at = now(),
      invitee_id = auth.uid(),
      conversation_id = conv
  where id = p_id;

  return conv;
end;
$$;


create or replace function public.cancel_invitation(
  p_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or p_id is null then
    raise exception 'not_allowed';
  end if;

  update public.invitations
  set status = 'cancelled',
      responded_at = now()
  where id = p_id
    and inviter_id = auth.uid()
    and status = 'pending';
end;
$$;

-- ===================================================================== chat
-- "End chat": hides the conversation for ME only. The other participant is notified via a system message.
create or replace function public.end_chat(p_conv uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.conversation_participants set status = 'ended', ended_at = now()
   where conversation_id = p_conv and user_id = auth.uid() and status = 'active';
  if not found then raise exception 'not_allowed'; end if;

  update public.call_sessions set status = 'ended', ended_at = now()
   where conversation_id = p_conv and status in ('ringing','active');

  insert into public.messages (conversation_id, sender_id, kind, body)
  values (p_conv, auth.uid(), 'system', 'ended');
end $$;

create or replace function public.mark_delivered(p_conv uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active_participant(p_conv) then return; end if;
  update public.messages set delivered_at = now()
   where conversation_id = p_conv and sender_id <> auth.uid() and kind <> 'system'
     and delivered_at is null and expires_at > now();
end $$;

create or replace function public.mark_read(p_conv uuid) returns void
language plpgsql security definer set search_path = public as $$
declare receipts boolean;
begin
  if not public.is_active_participant(p_conv) then return; end if;
  update public.conversation_participants set last_read_at = now()
   where conversation_id = p_conv and user_id = auth.uid();
  select send_read_receipts into receipts from public.profiles where id = auth.uid();
  update public.messages
     set delivered_at = coalesce(delivered_at, now()),
         read_at = case when receipts then coalesce(read_at, now()) else read_at end
   where conversation_id = p_conv and sender_id <> auth.uid() and kind <> 'system'
     and expires_at > now() and (read_at is null or delivered_at is null);
end $$;

create or replace function public.heartbeat() returns void
language sql security definer set search_path = public as $$
  update public.profiles set last_seen_at = now() where id = auth.uid() and show_online_status;
$$;

-- Atomic image message: validates the uploaded object using Storage's own metadata (not client-supplied values).
create or replace function public.send_image(p_conv uuid, p_path text) returns uuid
language plpgsql security definer set search_path = public as $$
declare obj storage.objects; mid uuid; v_mime text; v_size bigint; maxb bigint;
begin
  if not public.can_send(p_conv) then raise exception 'not_allowed'; end if;
  if split_part(p_path, '/', 1) <> p_conv::text then raise exception 'invalid_path'; end if;

  select * into obj from storage.objects where bucket_id = 'chat-media' and name = p_path;
  if not found then raise exception 'file_not_found'; end if;
  if obj.owner_id is distinct from auth.uid()::text then raise exception 'not_allowed'; end if;

  v_mime := obj.metadata ->> 'mimetype';
  v_size := (obj.metadata ->> 'size')::bigint;
  maxb   := coalesce(public.get_setting('max_upload_mb')::bigint, 10) * 1024 * 1024;
  if v_mime is null or v_mime not in ('image/jpeg','image/png','image/gif','image/webp','image/avif','image/heic','image/heif') then
    raise exception 'invalid_type';
  end if;
  if v_size is null or v_size <= 0 or v_size > maxb then raise exception 'file_too_large'; end if;

  insert into public.messages (conversation_id, sender_id, kind) values (p_conv, auth.uid(), 'image') returning id into mid;
  insert into public.media_attachments (message_id, conversation_id, uploader_id, storage_path, mime_type, size_bytes, expires_at)
    select mid, p_conv, auth.uid(), p_path, v_mime, v_size, m.expires_at from public.messages m where m.id = mid;
  return mid;
end $$;

-- Dashboard / chat header data in one call (never returns email/phone).
create or replace function public.my_conversations()
returns table (
  conversation_id uuid, expires_at timestamptz, created_at timestamptz,
  other_user_id uuid, other_username text, other_display_name text, other_avatar_path text,
  other_last_seen_at timestamptz, other_status text, unread_count bigint, last_message_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, c.expires_at, c.created_at,
         o.user_id, p.username, p.display_name, p.avatar_path,
         case when p.show_online_status then p.last_seen_at end,
         o.status,
         (select count(*) from public.messages m
           where m.conversation_id = c.id and m.sender_id <> auth.uid() and m.kind <> 'system'
             and m.expires_at > now() and m.created_at > coalesce(me.last_read_at, me.joined_at)),
         (select max(m.created_at) from public.messages m where m.conversation_id = c.id and m.expires_at > now())
  from public.conversation_participants me
  join public.conversations c on c.id = me.conversation_id
  join public.conversation_participants o on o.conversation_id = c.id and o.user_id <> me.user_id
  join public.profiles p on p.id = o.user_id
  where me.user_id = auth.uid() and me.status = 'active' and c.expires_at > now()
  order by 11 desc nulls last, 3 desc
$$;

-- ======================================================
-- calls

create or replace function public.start_call(
  p_conv uuid,
  p_type text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  other uuid;
  sid uuid;
  conv_exp timestamptz;
begin
  if auth.uid() is null then
    raise exception 'not_allowed';
  end if;

  if p_conv is null
     or p_type is null
     or p_type not in ('video', 'audio') then
    raise exception 'invalid_type';
  end if;

  if not public.can_send(p_conv) then
    raise exception 'not_allowed';
  end if;

  select expires_at
  into conv_exp
  from public.conversations
  where id = p_conv
  for update;

  if conv_exp is null or conv_exp <= now() then
    raise exception 'conversation_expired';
  end if;

  select user_id
  into other
  from public.conversation_participants
  where conversation_id = p_conv
    and user_id <> auth.uid()
    and status = 'active'
  limit 1;

  if other is null then
    raise exception 'not_allowed';
  end if;

  -- Supersede an existing call.
  update public.call_sessions
  set status = 'ended',
      ended_at = now()
  where conversation_id = p_conv
    and status in ('ringing', 'active');

  insert into public.call_sessions (
    conversation_id,
    caller_id,
    callee_id,
    type,
    expires_at
  )
  values (
    p_conv,
    auth.uid(),
    other,
    p_type,
    conv_exp
  )
  returning id into sid;

  return sid;
end;
$$;


create or replace function public.respond_call(
  p_id uuid,
  p_action text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.call_sessions;
begin
  if auth.uid() is null then
    raise exception 'not_allowed';
  end if;

  if p_id is null then
    raise exception 'invalid_call';
  end if;

  if p_action is null
     or p_action not in ('accept', 'reject', 'end') then
    raise exception 'invalid_action';
  end if;

  select *
  into s
  from public.call_sessions
  where id = p_id
  for update;

  if not found then
    raise exception 'call_not_found';
  end if;

  -- Only the caller or callee may operate on this call.
  if auth.uid() not in (s.caller_id, s.callee_id) then
    raise exception 'not_allowed';
  end if;

  -- Accept.
  if p_action = 'accept' then

    if s.callee_id <> auth.uid() then
      raise exception 'not_allowed';
    end if;

    if s.status <> 'ringing' then
      raise exception 'invalid_state';
    end if;

    if s.expires_at <= now() then
      update public.call_sessions
      set status = 'missed',
          ended_at = now()
      where id = p_id;

      raise exception 'call_expired';
    end if;

    if not exists (
      select 1
      from public.conversation_participants cp
      join public.conversations c
        on c.id = cp.conversation_id
      where cp.conversation_id = s.conversation_id
        and cp.user_id = auth.uid()
        and cp.status = 'active'
        and c.expires_at > now()
    ) then
      raise exception 'not_allowed';
    end if;

    update public.call_sessions
    set status = 'active',
        answered_at = now()
    where id = p_id
      and status = 'ringing';

  -- Reject.
  elsif p_action = 'reject' then

    if s.callee_id <> auth.uid() then
      raise exception 'not_allowed';
    end if;

    if s.status <> 'ringing' then
      raise exception 'invalid_state';
    end if;

    update public.call_sessions
    set status = 'rejected',
        ended_at = now()
    where id = p_id
      and status = 'ringing';

  -- End.
  elsif p_action = 'end' then

    if s.status in ('ringing', 'active') then

      update public.call_sessions
      set status =
        case
          when s.status = 'ringing'
               and s.caller_id = auth.uid()
            then 'missed'
          when s.status = 'ringing'
            then 'rejected'
          else 'ended'
        end,
        ended_at = now()
      where id = p_id;

    end if;

  end if;
end;
$$;

-- ================================================== cleanup (service role only)
create or replace function public.conversations_to_purge(p_limit int default 100) returns setof uuid
language sql stable security definer set search_path = public as $$
  select c.id from public.conversations c
   where c.expires_at <= now()
      or not exists (select 1 from public.conversation_participants cp
                      where cp.conversation_id = c.id and cp.status = 'active')
   limit p_limit
$$;

create or replace function public.expire_stale_calls() returns void
language sql security definer set search_path = public as $$
  update public.call_sessions set status = 'missed', ended_at = now()
   where status = 'ringing' and created_at < now() - interval '2 minutes';
  update public.call_sessions set status = 'ended', ended_at = now()
   where status = 'active' and answered_at < now() - interval '12 hours';
$$;

-- ======================================================
-- privileges

revoke execute on all functions in schema public
from public, anon;

-- Internal helper: trigger/backfill only.
revoke execute on function public.ensure_profile(uuid, jsonb)
from public, anon, authenticated;

-- Username availability.
grant execute on function public.username_available(text)
to anon, authenticated;

-- RLS helper functions.
grant execute on function public.is_participant(uuid)
to authenticated;

grant execute on function public.is_active_participant(uuid)
to authenticated;

grant execute on function public.can_send(uuid)
to authenticated;

grant execute on function public.shares_conversation(uuid)
to authenticated;

grant execute on function public.has_invitation_with(uuid)
to authenticated;

grant execute on function public.storage_conv_ok(text)
to authenticated;

grant execute on function public.can_read_media(text)
to authenticated;

grant execute on function public.can_read_avatar(text)
to authenticated;

grant execute on function public.topic_conv_ok(text)
to authenticated;

-- Authenticated RPCs.
grant execute on function public.respond_invitation(uuid, boolean)
to authenticated;

grant execute on function public.cancel_invitation(uuid)
to authenticated;

grant execute on function public.end_chat(uuid)
to authenticated;

grant execute on function public.mark_delivered(uuid)
to authenticated;

grant execute on function public.mark_read(uuid)
to authenticated;

grant execute on function public.heartbeat()
to authenticated;

grant execute on function public.send_image(uuid, text)
to authenticated;

grant execute on function public.my_conversations()
to authenticated;

grant execute on function public.start_call(uuid, text)
to authenticated;

grant execute on function public.respond_call(uuid, text)
to authenticated;

-- Internal settings functions.
revoke execute on function public.get_setting(text)
from authenticated;

revoke execute on function public.retention_interval()
from authenticated;

-- Service-role-only operations.
revoke execute on function public.create_invitation(uuid, text)
from authenticated;

revoke execute on function public.conversations_to_purge(int)
from authenticated;

revoke execute on function public.expire_stale_calls()
from authenticated;

grant execute on function public.create_invitation(uuid, text)
to service_role;

grant execute on function public.conversations_to_purge(int)
to service_role;

grant execute on function public.expire_stale_calls()
to service_role;