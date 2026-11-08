# Architecture (by phase)

Principles: **the database is the authority**. The browser only has the public anon key; every state change goes through RLS-protected inserts or `SECURITY DEFINER` RPC functions that re-check membership and expiry.

## Phase 1 — Structure & UI
Vite + React Router; `Layout` (nav, toasts, incoming-call modal, one global Realtime channel), `RequireAuth`, pages for every required screen. Tailwind with class-based dark mode. No DB changes.

## Phase 2 — Authentication & profiles
Supabase Auth (email+password with confirmation, phone+password with SMS OTP, reset by email link or phone OTP).
DB: `profiles` (id → `auth.users`, unique lowercase `username`, display name, avatar path, privacy flags, `last_seen_at`). Email/phone are **not** copied into `profiles`, so no policy can leak them. Trigger `handle_new_user` creates the profile (username de-duplicated). Avatars live in a private bucket, shown through signed URLs, readable only by people you share a chat/invite with.

## Phase 3 — Invitations
DB: `invitations` (inviter, optional invitee id, or normalised email/phone for unregistered targets, status, 7-day expiry).
Flow: client → Edge Function `invite` (JWT-verified) → `create_invitation()` (service role only: rate limit 20/h, normalise identifier, look up `auth.users`, de-duplicate) → function returns `{ok:true}` regardless of existence; external email/SMS only for unregistered targets. Recipient (matched by id, or by *verified* JWT email/phone) sees it via RLS, and `respond_invitation()` atomically creates `conversations` + two `conversation_participants` rows on accept.

## Phase 4 — Real-time text
DB: `messages` (`expires_at` set by a BEFORE INSERT trigger, rate limit 20/10 s, empty/oversize checks), `delivered_at`/`read_at`, participant `last_read_at`.
Realtime: `postgres_changes` on messages (RLS-filtered) for delivery; private Broadcast channel `conv:<id>` for typing. Status ticks via `mark_delivered`/`mark_read` (read receipts respect the user’s privacy toggle). `my_conversations()` gives dashboard data incl. unread counts and online state (`last_seen_at` heartbeat every 30 s, hidden if the user opted out).

## Phase 5 — Images & camera
Private bucket `chat-media` (size + MIME limits enforced by Storage). Client validates extension, size and magic bytes, uploads to `<conversation_id>/<uuid>.<ext>` (storage policy: only active participants of that conversation). `send_image()` atomically creates the message + `media_attachments` row after validating the object’s real Storage metadata. Reading uses 5-minute signed URLs; the storage SELECT policy refuses expired attachments. Camera: `getUserMedia` after an explicit “Allow camera” tap, canvas → JPEG → same preview/validate/send path.

## Phase 6 — Temporary chat & deletion
* `conversations.expires_at = created_at + retention`; `messages.expires_at = least(now()+retention, conversation expiry)` (server trigger, client values ignored).
* Every read path checks expiry: table RLS (`is_active_participant` + `expires_at > now()`), storage policy, Realtime broadcast policy, RPCs.
* **End chat** (`end_chat`): flips *my* `conversation_participants.status` to `ended` → conversation disappears for me; ends active calls; inserts a `system` message so the other side is notified live. The other participant stays active (read-only, because `can_send` needs both active) until expiry or until they end it.
* Cleanup (`cleanup` Edge Function ← pg_cron): ① expired attachments (Storage first, then rows) ② expired messages ③ expired or fully-ended conversations (wipe the conversation’s storage folder, then cascade-delete) ④ expired invitations, stale calls. A failure to delete files keeps the DB row so the next run retries.

## Phase 7 — Calls
DB: `call_sessions` (ringing/active/ended/rejected/missed) changed only via `start_call` / `respond_call`. Incoming call = `postgres_changes` INSERT filtered by `callee_id`. Offer/answer/ICE go over the private `conv:<id>` Broadcast channel. Callee answers `ready` to caller `ping`s so neither side races the other. ICE restart on `disconnected`/`failed`. STUN/TURN from env. Media is P2P and never recorded.

## Phase 8 — Security & deployment
RLS everywhere, minimal grants (clients can’t insert/update/delete most tables), anon cannot call RPCs except `username_available`, service-only functions revoked from `authenticated`. `supabase/tests` runs a scripted RLS/expiry test. Netlify: SPA redirect, security headers, env-based config.
