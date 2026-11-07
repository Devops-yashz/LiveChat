// Live chat server. Everything lives in memory: restart the server and all data is gone.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
// Optional SMS verification via Twilio Verify. Leave these unset to skip verification.
const { TWILIO_ACCOUNT_SID: SID, TWILIO_AUTH_TOKEN: TOK, TWILIO_VERIFY_SID: VSID } = process.env;
const VERIFY = !!(SID && TOK && VSID);
const lastCode = new Map(); // phone -> time of last code request
async function twilio(endpoint, params) {
  const r = await fetch(`https://verify.twilio.com/v2/Services/${VSID}/${endpoint}`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${SID}:${TOK}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params)
  });
  return r.json();
}
const IDLE_WIPE_MS = 10 * 60 * 1000; // chat is wiped if both people stay offline this long

const users = new Map();    // phone -> {phone,name,about,color,salt,hash,blocked:Set}
const chats = new Map();    // id -> {id,a,b,from,status:'pending'|'active',messages:[],offlineSince}
const sessions = new Map(); // token -> phone
const sockets = new Map();  // phone -> Set<ws>

const rid = () => crypto.randomBytes(12).toString('hex');
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
const phoneOf = p => { p = String(p || '').replace(/[\s\-()]/g, ''); return /^\+\d{8,15}$/.test(p) ? p : null; };
const clean = (s, n) => String(s || '').trim().slice(0, n);
const online = p => (sockets.get(p) || new Set()).size > 0;
const pub = u => ({ phone: u.phone, name: u.name, about: u.about, color: u.color, online: online(u.phone) });
const other = (c, me) => (c.a === me ? c.b : c.a);
const send = (ws, o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
const tell = (p, o) => (sockets.get(p) || []).forEach(ws => send(ws, o));
const chatBetween = (x, y) => [...chats.values()].find(c => (c.a === x && c.b === y) || (c.a === y && c.b === x));

function stateFor(p) {
  const u = users.get(p);
  return {
    t: 'state',
    me: { phone: u.phone, name: u.name, about: u.about, color: u.color },
    blocked: [...u.blocked],
    chats: [...chats.values()].filter(c => c.a === p || c.b === p).map(c => ({
      id: c.id, from: c.from, status: c.status, messages: c.messages, peer: pub(users.get(other(c, p)))
    }))
  };
}
const push = p => users.has(p) && tell(p, stateFor(p));
const related = p => [...chats.values()].filter(c => c.a === p || c.b === p).map(c => other(c, p));
const pushWithRelated = p => { push(p); related(p).forEach(push); };

function attach(ws, p) {
  ws.phone = p;
  if (!sockets.has(p)) sockets.set(p, new Set());
  sockets.get(p).add(ws);
  const token = rid(); sessions.set(token, p);
  send(ws, { t: 'auth', token });
  pushWithRelated(p);
}
function detach(ws) {
  const p = ws.phone; if (!p) return;
  ws.phone = null;
  sockets.get(p)?.delete(ws);
  related(p).forEach(push);
}
function removeChat(c) { chats.delete(c.id); push(c.a); push(c.b); }

async function handle(ws, m) {
  const t = m.t;
  if (t === 'sendcode') {
    const phone = phoneOf(m.phone);
    if (!phone) return send(ws, { t: 'error', msg: 'Enter a phone number with country code, like +919876543210.' });
    if (users.has(phone)) return send(ws, { t: 'error', msg: 'This number already has an account. Log in instead.' });
    if (Date.now() - (lastCode.get(phone) || 0) < 60000) return send(ws, { t: 'error', msg: 'Wait a minute before asking for another code.' });
    lastCode.set(phone, Date.now());
    const r = await twilio('Verifications', { To: phone, Channel: 'sms' });
    return r.status === 'pending' ? send(ws, { t: 'codesent' }) : send(ws, { t: 'error', msg: 'Could not send the code. Check the number.' });
  }
  if (t === 'register') {
    const phone = phoneOf(m.phone), name = clean(m.name, 30), pw = String(m.password || '');
    if (!phone) return send(ws, { t: 'error', msg: 'Enter a phone number with country code, like +919876543210.' });
    if (!name) return send(ws, { t: 'error', msg: 'Enter your name.' });
    if (pw.length < 6) return send(ws, { t: 'error', msg: 'Password must be at least 6 characters.' });
    if (users.has(phone)) return send(ws, { t: 'error', msg: 'This number already has an account. Log in instead.' });
    if (VERIFY) {
      const r = await twilio('VerificationCheck', { To: phone, Code: clean(m.code, 10) });
      if (r.status !== 'approved') return send(ws, { t: 'error', msg: 'Wrong or expired code.' });
    }
    const salt = rid();
    const color = `hsl(${Math.floor(Math.random() * 360)} 55% 42%)`;
    users.set(phone, { phone, name, about: 'Hey there, I am using LiveChat', color, salt, hash: hashPw(pw, salt), blocked: new Set() });
    return attach(ws, phone);
  }
  if (t === 'login') {
    const u = users.get(phoneOf(m.phone));
    const ok = u && crypto.timingSafeEqual(Buffer.from(hashPw(String(m.password || ''), u.salt)), Buffer.from(u.hash));
    if (!ok) return send(ws, { t: 'error', msg: 'Wrong phone number or password.' });
    return attach(ws, u.phone);
  }
  if (t === 'resume') {
    const p = sessions.get(m.token);
    if (p && users.has(p)) { ws.phone = p; if (!sockets.has(p)) sockets.set(p, new Set()); sockets.get(p).add(ws); send(ws, { t: 'auth', token: m.token }); return pushWithRelated(p); }
    return send(ws, { t: 'nologin' });
  }

  const me = ws.phone; if (!me) return send(ws, { t: 'nologin' });
  const mu = users.get(me);

  if (t === 'invite') {
    const to = phoneOf(m.phone);
    if (!to || to === me) return send(ws, { t: 'error', msg: 'Enter a valid phone number with country code.' });
    const target = users.get(to);
    if (!target) return send(ws, { t: 'notfound', phone: to });
    if (mu.blocked.has(to)) return send(ws, { t: 'error', msg: 'You blocked this person. Unblock them in Settings first.' });
    if (chatBetween(me, to)) return send(ws, { t: 'error', msg: 'You already have a chat or pending request with this person.' });
    if (target.blocked.has(me)) return send(ws, { t: 'info', msg: 'Request sent.' }); // do not reveal blocks
    const id = rid();
    chats.set(id, { id, a: me, b: to, from: me, status: 'pending', messages: [] });
    push(me); push(to);
    tell(to, { t: 'info', msg: `${mu.name} wants to chat with you.` });
    return send(ws, { t: 'info', msg: 'Request sent.' });
  }
  const c = chats.get(m.chatId);
  const mine = c && (c.a === me || c.b === me);

  if (t === 'respond' && mine && c.status === 'pending' && c.from !== me) {
    if (m.accept) {
      c.status = 'active';
      c.messages.push({ id: rid(), system: true, text: 'Chat started. Messages disappear when the chat ends.', ts: Date.now() });
      push(c.a); push(c.b);
    } else {
      removeChat(c);
      tell(c.from, { t: 'info', msg: `${mu.name} declined your request.` });
    }
    return;
  }
  if (t === 'msg' && mine && c.status === 'active') {
    const text = clean(m.text, 2000);
    const image = typeof m.image === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(m.image) && m.image.length < 450000 ? m.image : null;
    if (!text && !image) return;
    const msg = { id: rid(), from: me, text, image, ts: Date.now() };
    c.messages.push(msg); if (c.messages.length > 200) c.messages.shift();
    return [c.a, c.b].forEach(p => tell(p, { t: 'msg', chatId: c.id, message: msg }));
  }
  if (t === 'typing' && mine && c.status === 'active') return tell(other(c, me), { t: 'typing', chatId: c.id });
  if (t === 'end' && mine) {
    removeChat(c);
    return tell(other(c, me), { t: 'info', msg: c.status === 'pending' ? `${mu.name} cancelled the request.` : `${mu.name} ended the chat. History deleted.` });
  }
  if (t === 'block') {
    const p = phoneOf(m.phone); if (!p || p === me) return;
    mu.blocked.add(p); const x = chatBetween(me, p); if (x) removeChat(x);
    return push(me);
  }
  if (t === 'unblock') { mu.blocked.delete(phoneOf(m.phone)); return push(me); }
  if (t === 'profile') {
    mu.name = clean(m.name, 30) || mu.name; mu.about = clean(m.about, 80);
    if (/^hsl\(\d{1,3} 55% 42%\)$/.test(m.color)) mu.color = m.color;
    return pushWithRelated(me);
  }
  if (t === 'password') {
    if (hashPw(String(m.old || ''), mu.salt) !== mu.hash) return send(ws, { t: 'error', msg: 'Current password is wrong.' });
    if (String(m.new || '').length < 6) return send(ws, { t: 'error', msg: 'New password must be at least 6 characters.' });
    mu.salt = rid(); mu.hash = hashPw(String(m.new), mu.salt);
    for (const [k, v] of sessions) if (v === me) sessions.delete(k); // sign out other devices
    send(ws, { t: 'info', msg: 'Password changed.' });
    return attach(ws, me);
  }
  if (t === 'logout') {
    sessions.delete(m.token); detach(ws); return send(ws, { t: 'nologin' });
  }
  if (t === 'delete') {
    const peers = related(me);
    [...chats.values()].filter(x => x.a === me || x.b === me).forEach(x => chats.delete(x.id));
    for (const [k, v] of sessions) if (v === me) sessions.delete(k);
    (sockets.get(me) || []).forEach(s => { s.phone = null; send(s, { t: 'nologin' }); });
    sockets.delete(me); users.delete(me); peers.forEach(push);
  }
}

// Serve the single page
const server = http.createServer((req, res) => {
  fs.readFile(path.join(__dirname, 'public', 'index.html'), (err, data) => {
    if (err) { res.writeHead(500); return res.end('Missing public/index.html'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
    res.end(data);
  });
});
const wss = new WebSocketServer({ server, maxPayload: 600 * 1024 });
wss.on('connection', ws => {
  ws.phone = null; ws.hits = 0;
  send(ws, { t: 'hello', verify: VERIFY });
  const tick = setInterval(() => (ws.hits = 0), 1000);
  ws.on('message', raw => {
    if (++ws.hits > 20) return; // basic flood protection
    let m; try { m = JSON.parse(raw); } catch { return; }
    handle(ws, m).catch(e => { console.error(e); send(ws, { t: 'error', msg: 'Something went wrong.' }); });
  });
  ws.on('close', () => { clearInterval(tick); detach(ws); });
});

// Wipe chats when both people have been offline for a while
setInterval(() => {
  for (const c of chats.values()) {
    if (online(c.a) || online(c.b)) { c.offlineSince = null; continue; }
    c.offlineSince = c.offlineSince || Date.now();
    if (Date.now() - c.offlineSince > IDLE_WIPE_MS) chats.delete(c.id);
  }
}, 60 * 1000);

server.listen(PORT, () => console.log(`LiveChat running at http://localhost:${PORT}`));
