// Edge Function: invite
// Entry point for sending invitations. Always answers { ok: true } for valid requests, so the caller can
// never learn whether an email / phone number / username belongs to a registered user.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function sendEmail(to: string, from: string, text: string) {
  const key = Deno.env.get('RESEND_API_KEY');
  const sender = Deno.env.get('RESEND_FROM');
  if (!key || !sender) return console.log('email provider not configured; invitation stored only');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: sender, to, subject: `${from} invited you to a private chat`, text }),
  });
  if (!res.ok) console.error('resend failed', res.status, await res.text());
}

async function sendSms(toDigits: string, text: string) {
  const sid = Deno.env.get('TWILIO_ACCOUNT_SID');
  const token = Deno.env.get('TWILIO_AUTH_TOKEN');
  const sender = Deno.env.get('TWILIO_FROM');
  if (!sid || !token || !sender) return console.log('sms provider not configured; invitation stored only');
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + btoa(`${sid}:${token}`), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: `+${toDigits}`, From: sender, Body: text }),
  });
  if (!res.ok) console.error('twilio failed', res.status, await res.text());
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: auth } = await admin.auth.getUser(jwt);
    const user = auth?.user;
    if (!user) return json({ error: 'unauthorized' }, 401);

    const { identifier } = await req.json();
    if (typeof identifier !== 'string') return json({ error: 'invalid_identifier' }, 400);

    const { data, error } = await admin.rpc('create_invitation', { p_inviter: user.id, p_identifier: identifier });
    if (error) {
      const m = error.message ?? '';
      if (m.includes('rate_limited')) return json({ error: 'rate_limited' }, 429);
      if (m.includes('invalid_identifier')) return json({ error: 'invalid_identifier' }, 400);
      if (m.includes('cannot_invite_self')) return json({ error: 'cannot_invite_self' }, 400);
      console.error(error);
      return json({ error: 'server_error' }, 500);
    }

    // Not registered -> deliver an out-of-band invitation (email / SMS). The response stays identical.
    if (data && !data.registered && !data.duplicate && (data.email || data.phone)) {
      const { data: prof } = await admin.from('profiles').select('username').eq('id', user.id).single();
      const site = Deno.env.get('SITE_URL') ?? '';
      const text = `@${prof?.username ?? 'someone'} invited you to a private, temporary chat. Create an account with this ${
        data.email ? 'email address' : 'phone number'
      } to respond: ${site}/register`;
      if (data.email) await sendEmail(data.email, `@${prof?.username ?? 'Someone'}`, text).catch(console.error);
      else if (data.phone) await sendSms(data.phone, text).catch(console.error);
    }
    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ error: 'server_error' }, 500);
  }
});
