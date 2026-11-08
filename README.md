# LiveChat — private temporary real-time chat

React + Vite + TypeScript + Tailwind frontend · Supabase (Auth, Postgres + RLS, Realtime, Storage, Edge Functions, Cron) · WebRTC calls · Netlify hosting.

* Invite-only one-to-one chat · typing, online status, delivery/read ticks, unread counts, emoji
* Image sharing (JPG/PNG/GIF/WebP/AVIF/HEIC) + live camera capture
* **Server-enforced 24h expiry** (configurable), per-participant **End chat**, storage files deleted by a scheduled job
* Video & voice calls (WebRTC, Supabase Realtime signalling, STUN/TURN)
* Light/dark mode, responsive, no placeholder buttons

> **Security honesty:** this app is **not end-to-end encrypted** (the UI says so). Data is encrypted in transit and protected by RLS, but the project owner (Supabase admin) can technically read unexpired data. Do not market it as E2EE.

Architecture and per-phase DB notes: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## 0. What you need
* Node.js 20+ and npm
* A free Supabase account — https://supabase.com
* A free Netlify account — https://netlify.com
* Supabase CLI (no install needed, use `npx supabase …`)
* Optional: Twilio (phone OTP + SMS invites), Resend (email invites), a TURN provider (calls on mobile data / strict networks)

## 1. Create the Supabase project
1. Supabase Dashboard → **New project**. Save the database password.
2. Project **Settings → API**: copy **Project URL**, **anon public key** (frontend) and note the **project ref** (the `xxxx` in `https://xxxx.supabase.co`). The **service_role key is never used in the frontend** – Edge Functions get it automatically.

## 2. Run the database migrations
**Option A – CLI (recommended)**
```bash
npm install
npx supabase login
npx supabase link --project-ref <PROJECT_REF>
npx supabase db push
```
**Option B – SQL editor:** paste and run these files **in order**: `supabase/migrations/0001_schema.sql` → `0002_functions.sql` → `0003_rls.sql` → `0004_storage_realtime.sql`.

Check afterwards: *Storage* shows two **private** buckets (`chat-media`, `avatars`); *Database → Replication* lists `messages, invitations, conversation_participants, call_sessions` in `supabase_realtime`.

## 3. Configure Authentication
Dashboard → **Authentication**:
1. **Providers → Email**: enabled, **Confirm email = ON** (required – unverified emails must not be able to claim invitations).
2. **Providers → Phone** (only if you want mobile registration): enable it, choose Twilio (or Twilio Verify / MessageBird / Vonage) and paste its credentials, keep **Enable phone confirmations ON**. Without an SMS provider, phone sign-up/OTP will not work; email sign-up still will.
3. **URL Configuration**: *Site URL* = your Netlify URL (use `http://localhost:5173` while testing). *Redirect URLs*: add `http://localhost:5173/**` and `https://<your-site>.netlify.app/**`.
4. **Sign In / Providers → password settings**: minimum length 8+, enable leaked-password protection if your plan has it.
5. Optional: add custom SMTP (Authentication → SMTP) – the built-in email sender is heavily rate-limited.

## 4. Realtime hardening
Dashboard → **Realtime → Settings** → turn **“Allow public access” OFF**. Typing and call signalling use *private* channels (`conv:<conversation_id>`), authorised by the policies in `0004`. Row-change events (messages, invitations, calls) are filtered by table RLS.

## 5. Deploy the Edge Functions
```bash
# 1. secrets (copy the example, edit values)
cp supabase/functions/.env.example supabase/functions/.env
#    CRON_SECRET: a long random string, e.g.  openssl rand -hex 32
#    SITE_URL:    your Netlify URL
#    RESEND_* / TWILIO_*: optional (see below)
npx supabase secrets set --env-file supabase/functions/.env

# 2. deploy
npx supabase functions deploy invite
npx supabase functions deploy cleanup --no-verify-jwt
```
* `invite` – the only way invitations are created. It answers identically whether or not the target is registered. For unregistered email/phone targets it sends an email (Resend) / SMS (Twilio) **only if you configured those secrets**; otherwise the invitation is stored and the person sees it after registering with that exact email/phone.
* `cleanup` – deletes expired storage files first, then DB rows.

Test cleanup manually:
```bash
curl -i -X POST https://<PROJECT_REF>.supabase.co/functions/v1/cleanup -H "x-cron-secret: <CRON_SECRET>"
```
(should return `200` with JSON counters; without the header it returns `403`).

## 6. Schedule the cleanup
1. Dashboard → **Database → Extensions**: enable **pg_cron** and **pg_net**.
2. Open `supabase/cron.sql`, replace `<PROJECT_REF>` and `<CRON_SECRET>`, run it in the SQL editor.
3. Verify: `select * from cron.job;` and later `select * from cron.job_run_details order by start_time desc limit 5;`

Even if the job is late or down, **expired data is already invisible**: RLS checks `expires_at > now()` on every read, in the REST API and in Realtime. The job only physically deletes rows/files.

## 7. Run locally
```bash
cp .env.example .env      # fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm install
npm run dev               # http://localhost:5173
```
Camera/microphone work on `localhost` and on HTTPS only.

## 8. Deploy on Netlify
**Git (recommended):** push this folder to GitHub → Netlify → *Add new site → Import from Git*. Build settings are read from `netlify.toml` (`npm run build`, publish `dist`, SPA redirect, security headers).
Then **Site configuration → Environment variables**, add:

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | your project URL |
| `VITE_SUPABASE_ANON_KEY` | anon public key |
| `VITE_MAX_UPLOAD_MB` | `10` |
| `VITE_STUN_URLS` | `stun:stun.l.google.com:19302` |
| `VITE_TURN_URL`, `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL` | your TURN server (see §9) |

Trigger a redeploy (env vars are baked in at build time). **CLI alternative:** `npx netlify-cli deploy --build --prod`.
Finally add the Netlify URL to Supabase **Auth → URL Configuration** (step 3) and set `SITE_URL` secret (step 5) to it.

## 9. TURN server (reliable calls across networks)
STUN alone fails on many mobile/corporate networks. Pick one:
* A hosted TURN service (Metered, Twilio Network Traversal, Cloudflare Calls TURN) – copy URL/username/credential into the `VITE_TURN_*` variables (`VITE_TURN_URL` may be comma-separated, e.g. `turn:host:3478,turns:host:5349`).
* Self-hosted **coturn** with `use-auth-secret` or a long-term user.

⚠ Anything in `VITE_*` is public to every logged-in user. Static TURN credentials can therefore be abused for bandwidth. For production, use a provider that issues **short-lived credentials** and fetch them from an Edge Function instead of baking them in.

## 10. Configuration knobs (server side, in the SQL editor)
```sql
update app_settings set value = '1440' where key = 'retention_minutes';   -- 24h default; affects NEW conversations/messages
update app_settings set value = '10'   where key = 'max_upload_mb';       -- also change bucket limit + VITE_MAX_UPLOAD_MB
update app_settings set value = '20'   where key = 'max_messages_per_10s';
update app_settings set value = '20'   where key = 'max_invites_per_hour';
-- bucket limit (bytes): update storage.buckets set file_size_limit = 10485760 where id = 'chat-media';
```

## 11. Test checklist (use two browsers / one normal + one incognito)
1. Register user A and user B (verify email). Log in on both.
2. A → **Invite** → B’s email. Response never says whether B exists. B → **Invitations** → Accept. Both land in the chat.
3. Typing indicator, ticks (✓ sent, ✓✓ delivered, blue ✓✓ read), online dot, unread badge on the dashboard.
4. Send emoji, a JPG, a HEIC, and a camera photo (grant permission when asked). Try a `.exe` renamed to `.jpg` → rejected.
5. **End chat** as A → A’s chat LiveChates; B gets a toast + system line and cannot send, but can still read.
6. **Expiry test:** `update app_settings set value='3' where key='retention_minutes';`, create a new chat, wait 3 minutes → both are kicked out, messages gone via API *immediately*; within the cron interval storage files and rows are deleted (check Storage → `chat-media`). Set it back to `1440` afterwards.
7. Video and voice call between two devices on different networks; mute, camera off, flip camera, hang up. Kill Wi-Fi for 10s to see reconnect.
8. DB security test (no Supabase needed): see `supabase/tests/` — it runs RLS/expiry checks against a throwaway local Postgres:
```bash
createdb t && psql t -f supabase/tests/mock_supabase.sql
for f in supabase/migrations/*.sql; do psql t -v ON_ERROR_STOP=1 -f $f; done
psql t -f supabase/tests/rls_smoke_test.sql
```

## 12. Troubleshooting
| Symptom | Fix |
|---|---|
| “Supabase is not configured” | Env vars missing → set them and rebuild/restart. |
| Sign-up works but no email | Built-in SMTP is rate-limited → configure custom SMTP. |
| Phone OTP never arrives | SMS provider not configured in Auth → Providers → Phone. |
| Invitation to a new email never arrives | Set `RESEND_*` secrets and redeploy `invite`; or tell them to register with that email. |
| Typing/calls don’t connect | Check step 4 policies exist (`0004`), user is an *active* participant, and `supabase.realtime.setAuth()` ran (page refresh). |
| Calls connect on Wi-Fi but not mobile data | Add TURN (§9). |
| Images don’t upload | File over limit, wrong type, or bucket limits differ from `VITE_MAX_UPLOAD_MB`. |
| Cleanup never runs | `select * from cron.job_run_details` – check URL/secret in `cron.sql`; Edge Function logs in the dashboard. |
| Deep links 404 on Netlify | Make sure `netlify.toml` / `public/_redirects` are deployed. |

## 13. Known limitations (be honest with your users)
* **No end-to-end encryption.** Implementing it properly (key exchange, multi-device keys, encrypted media, recovery) is a separate project; nothing here claims it.
* Anyone can screenshot or save what you send. Expiry can’t undo that.
* Server-side image validation uses Storage’s MIME check + size limits + `send_image()` metadata checks; it does not inspect pixel data. Add virus/content scanning if you need it.
* HEIC/AVIF previews depend on the browser (Safari shows HEIC; others show a “can’t preview” fallback but the file is still delivered).
* When **both** people end a chat, the whole conversation is purged by the next cleanup run (nobody can see it anyway).
* Message lifetime = `min(now + retention, conversation expiry)`; the conversation itself expires `retention` after it was created, so a chat started at 9:00 ends at 9:00 next day for both.
* Account deletion and push notifications are not implemented.
