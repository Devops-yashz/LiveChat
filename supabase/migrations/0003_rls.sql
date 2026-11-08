
-- ============================================================
-- 0003_rls.sql
-- LiveChat: Row Level Security
-- ============================================================

-- Enable RLS

alter table public.app_settings enable row level security;
alter table public.profiles enable row level security;
alter table public.invitations enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages enable row level security;
alter table public.media_attachments enable row level security;
alter table public.call_sessions enable row level security;

-- ============================================================
-- REMOVE OLD POLICIES
-- Important when upgrading from the old LiveChat schema.
-- ============================================================

drop policy if exists "Authenticated users can read messages"
on public.messages;

drop policy if exists "Users can send their own messages"
on public.messages;

drop policy if exists "Anyone can check usernames"
on public.profiles;

drop policy if exists "Users can create their own profile"
on public.profiles;

drop policy if exists "Users can update their own profile"
on public.profiles;

drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_update_own on public.profiles;

drop policy if exists invitations_select on public.invitations;

drop policy if exists conversations_select on public.conversations;

drop policy if exists participants_select
on public.conversation_participants;

drop policy if exists messages_select on public.messages;
drop policy if exists messages_insert on public.messages;

drop policy if exists media_select on public.media_attachments;
drop policy if exists calls_select on public.call_sessions;

-- ============================================================
-- PROFILES
-- ============================================================

create policy profiles_select
on public.profiles
for select
to authenticated
using (
  id = (select auth.uid())
  or public.shares_conversation(id)
  or public.has_invitation_with(id)
);

create policy profiles_update_own
on public.profiles
for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

-- Public username availability is handled by the
-- username_available() function, not unrestricted profile reads.

-- ============================================================
-- INVITATIONS
-- ============================================================

create policy invitations_select
on public.invitations
for select
to authenticated
using (
  inviter_id = (select auth.uid())
  or invitee_id = (select auth.uid())
  or invitee_email =
    lower(coalesce((select auth.jwt() ->> 'email'), ''))
  or invitee_phone =
    coalesce((select auth.jwt() ->> 'phone'), '')
);

-- ============================================================
-- CONVERSATIONS
-- ============================================================

create policy conversations_select
on public.conversations
for select
to authenticated
using (
  public.is_active_participant(id)
);

-- ============================================================
-- CONVERSATION PARTICIPANTS
-- ============================================================

create policy participants_select
on public.conversation_participants
for select
to authenticated
using (
  public.is_participant(conversation_id)
);

-- ============================================================
-- MESSAGES
-- ============================================================

create policy messages_select
on public.messages
for select
to authenticated
using (
  public.is_active_participant(conversation_id)
  and expires_at > now()
);

create policy messages_insert
on public.messages
for insert
to authenticated
with check (
  kind = 'text'
  and sender_id = (select auth.uid())
  and public.can_send(conversation_id)
);

-- ============================================================
-- MEDIA ATTACHMENTS
-- ============================================================

create policy media_select
on public.media_attachments
for select
to authenticated
using (
  public.is_active_participant(conversation_id)
  and expires_at > now()
);

-- ============================================================
-- CALL SESSIONS
-- ============================================================

create policy calls_select
on public.call_sessions
for select
to authenticated
using (
  (
    caller_id = (select auth.uid())
    or callee_id = (select auth.uid())
  )
  and expires_at > now()
);

-- ============================================================
-- TABLE PRIVILEGES
-- ============================================================

revoke all on public.app_settings
from anon, authenticated;

revoke all on all tables in schema public
from anon;

revoke insert, delete, truncate
on public.profiles,
   public.invitations,
   public.conversations,
   public.conversation_participants,
   public.media_attachments,
   public.call_sessions
from anon, authenticated;

revoke update, delete, truncate
on public.messages
from anon, authenticated;

revoke insert, update, delete
on public.profiles
from anon;

grant select, update
on public.profiles
to authenticated;

grant select
on public.invitations,
   public.conversations,
   public.conversation_participants,
   public.messages,
   public.media_attachments,
   public.call_sessions
to authenticated;

grant insert
on public.messages
to authenticated;

grant update (
  username,
  display_name,
  avatar_path,
  show_online_status,
  send_read_receipts,
  share_typing,
  last_seen_at
)
on public.profiles
to authenticated;

-- ============================================================
-- END 0003
-- ============================================================
