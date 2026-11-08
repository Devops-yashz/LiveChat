import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Camera, Check, CheckCheck, Clock, ImagePlus, LogOut, Phone, Send, Smile, Video } from 'lucide-react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { emitRefresh, useAuth } from '../lib/auth';
import type { ConversationRow, Message } from '../lib/types';
import { displayName, formatRemaining, formatTime, friendlyError, IMAGE_ACCEPT, isOnline, useNow, validateImage } from '../lib/utils';
import { signedUrl } from '../lib/storage';
import Avatar from '../components/Avatar';
import CameraCapture from '../components/CameraCapture';
import EmojiPicker from '../components/EmojiPicker';
import { Alert, Empty, Modal, PageLoader, Spinner } from '../components/ui';

export default function Chat() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { user, profile } = useAuth();
  const uid = user!.id;
  const now = useNow(1000);

  const [conv, setConv] = useState<ConversationRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [typing, setTyping] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [pendingImage, setPendingImage] = useState<{ file: File; url: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [sending, setSending] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastTypingSent = useRef(0);
  const typingTimer = useRef<ReturnType<typeof setTimeout>>();

  const loadConv = useCallback(async () => {
    const { data, error: err } = await supabase.rpc('my_conversations');
    if (err) { setError(err.message); return null; }
    const c = (data as ConversationRow[]).find((x) => x.conversation_id === id) ?? null;
    setConv(c);
    return c;
  }, [id]);

  const markSeen = useCallback(() => {
    supabase.rpc('mark_delivered', { p_conv: id });
    if (document.visibilityState === 'visible') supabase.rpc('mark_read', { p_conv: id }).then(() => emitRefresh());
  }, [id]);

  // initial load
  useEffect(() => {
    let live = true;
    (async () => {
      const c = await loadConv();
      if (!live) return;
      if (c) {
        const { data } = await supabase.from('messages').select('*').eq('conversation_id', id)
          .gt('expires_at', new Date().toISOString()).order('created_at', { ascending: true }).limit(500);
        if (live) { setMsgs((data as Message[]) ?? []); markSeen(); }
      }
      if (live) setLoading(false);
    })();
    return () => { live = false; };
  }, [id, loadConv, markSeen]);

  // realtime: DB changes (RLS-filtered) + private broadcast channel for typing
  useEffect(() => {
    const db = supabase.channel(`chat-db-${id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${id}` }, (p) => {
        const m = p.new as Message;
        setMsgs((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
        if (m.sender_id !== uid) markSeen();
        if (m.kind === 'system') loadConv();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${id}` }, (p) => {
        const m = p.new as Message;
        setMsgs((prev) => prev.map((x) => (x.id === m.id ? m : x)));
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversation_participants', filter: `conversation_id=eq.${id}` }, () => loadConv())
      .subscribe();

    let typingCh: RealtimeChannel | null = null;
    let cancelled = false;
    (async () => {
      await supabase.realtime.setAuth();
      if (cancelled) return;
      typingCh = supabase.channel(`conv:${id}`, { config: { private: true } });
      typingCh.on('broadcast', { event: 'typing' }, () => {
        setTyping(true);
        clearTimeout(typingTimer.current);
        typingTimer.current = setTimeout(() => setTyping(false), 3000);
      }).subscribe();
      channelRef.current = typingCh;
    })();

    const onVis = () => { if (document.visibilityState === 'visible') markSeen(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
      supabase.removeChannel(db);
      if (typingCh) supabase.removeChannel(typingCh);
      channelRef.current = null;
      clearTimeout(typingTimer.current);
    };
  }, [id, uid, markSeen, loadConv]);

  // expiry: leave the chat the moment it expires, and drop expired messages from the screen
  const expiresAt = conv ? new Date(conv.expires_at).getTime() : null;
  useEffect(() => { if (expiresAt && now >= expiresAt) nav('/dashboard', { replace: true }); }, [now, expiresAt, nav]);
  const visible = useMemo(() => msgs.filter((m) => new Date(m.expires_at).getTime() > now), [msgs, now]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [visible.length, typing]);

  const canSend = !!conv && conv.other_status === 'active';

  function onType(v: string) {
    setText(v);
    if (profile?.share_typing && Date.now() - lastTypingSent.current > 2000) {
      lastTypingSent.current = Date.now();
      channelRef.current?.send({ type: 'broadcast', event: 'typing', payload: {} });
    }
  }

  async function sendText() {
    const body = text.trim();
    if (!body || sending || !canSend) return;
    setSending(true); setError(''); setShowEmoji(false);
    const { data, error: err } = await supabase.from('messages')
      .insert({ conversation_id: id, sender_id: uid, kind: 'text', body }).select().single();
    setSending(false);
    if (err) return setError(friendlyError(err));
    setText('');
    const m = data as Message;
    setMsgs((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
  }

  async function pickFile(file: File) {
    setError('');
    const v = await validateImage(file);
    if (!v.ok) return setError(v.error);
    setPendingImage({ file, url: URL.createObjectURL(file) });
  }

  async function sendImage() {
    if (!pendingImage) return;
    setUploading(true); setError('');
    try {
      const v = await validateImage(pendingImage.file);
      if (!v.ok) throw new Error(v.error);
      const path = `${id}/${crypto.randomUUID()}.${v.ext}`;
      const { error: up } = await supabase.storage.from('chat-media').upload(path, pendingImage.file, { contentType: v.mime, upsert: false, cacheControl: '0' });
      if (up) throw up;
      const { data: mid, error: rpcErr } = await supabase.rpc('send_image', { p_conv: id, p_path: path });
      if (rpcErr) { await supabase.storage.from('chat-media').remove([path]); throw rpcErr; }
      const { data: row } = await supabase.from('messages').select('*').eq('id', mid).single();
      if (row) setMsgs((prev) => (prev.some((x) => x.id === (row as Message).id) ? prev : [...prev, row as Message]));
      URL.revokeObjectURL(pendingImage.url); setPendingImage(null);
    } catch (err) { setError(friendlyError(err)); } finally { setUploading(false); }
  }

  async function startCall(type: 'video' | 'audio') {
    setError('');
    const { data, error: err } = await supabase.rpc('start_call', { p_conv: id, p_type: type });
    if (err) return setError(friendlyError(err));
    nav(`/call/${data}`);
  }

  async function endChat() {
    const { error: err } = await supabase.rpc('end_chat', { p_conv: id });
    if (err) { setConfirmEnd(false); return setError(friendlyError(err)); }
    emitRefresh();
    nav('/dashboard', { replace: true });
  }

  if (loading) return <PageLoader />;
  if (!conv) return (
    <div className="mx-auto max-w-md pt-10">
      <Empty icon={<Clock className="h-8 w-8" />} title="This chat is no longer available">It may have expired or been ended. Expired chats are never restored.
        <div className="mt-4"><Link to="/dashboard" className="btn-primary">Back to chats</Link></div></Empty>
    </div>
  );

  const left = new Date(conv.expires_at).getTime() - now;
  const name = displayName(conv);
  const online = conv.other_status === 'active' && isOnline(conv.other_last_seen_at, now);

  return (
    <div className="mx-auto flex h-[calc(100dvh-9.5rem)] max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:h-[calc(100dvh-7rem)] dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-3 border-b border-slate-200 px-3 py-2.5 dark:border-slate-800">
        <Link to="/dashboard" className="btn-ghost !p-2" aria-label="Back"><ArrowLeft className="h-5 w-5" /></Link>
        <Avatar path={conv.other_avatar_path} name={name} size={38} online={conv.other_status === 'active' ? online : undefined} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium leading-tight">{name}</p>
          <p className="truncate text-xs text-slate-500">{typing ? 'typing…' : conv.other_status === 'ended' ? 'left the chat' : online ? 'online' : 'offline'}</p>
        </div>
        <span className={`hidden items-center gap-1 rounded-full px-2 py-1 text-xs sm:flex ${left < 3600_000 ? 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-200' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
          <Clock className="h-3 w-3" />{formatRemaining(left)}
        </span>
        <button className="btn-ghost !p-2" disabled={!canSend} onClick={() => startCall('audio')} aria-label="Voice call" title="Voice call"><Phone className="h-5 w-5" /></button>
        <button className="btn-ghost !p-2" disabled={!canSend} onClick={() => startCall('video')} aria-label="Video call" title="Video call"><Video className="h-5 w-5" /></button>
        <button className="btn-ghost !p-2 text-rose-600" onClick={() => setConfirmEnd(true)} aria-label="End chat" title="End chat"><LogOut className="h-5 w-5" /></button>
      </div>

      <div className="bg-brand-50 px-4 py-1.5 text-center text-xs text-brand-900 dark:bg-brand-900/20 dark:text-brand-100 sm:hidden">
        Expires in {formatRemaining(left)} · messages are deleted for everyone
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto px-3 py-4">
        <p className="mx-auto max-w-xs rounded-xl bg-slate-100 px-3 py-2 text-center text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          This chat and everything in it is deleted for both of you in {formatRemaining(left)}. Messages are not end-to-end encrypted.
        </p>
        {visible.length === 0 && <p className="pt-8 text-center text-sm text-slate-400">Say hi 👋</p>}
        {visible.map((m) => <Bubble key={m.id} m={m} mine={m.sender_id === uid} otherName={name} />)}
        {typing && <div className="flex"><span className="rounded-2xl rounded-bl-md bg-slate-100 px-4 py-2 text-slate-500 dark:bg-slate-800">• • •</span></div>}
        <div ref={bottomRef} />
      </div>

      {error && <div className="px-3 pb-2"><Alert kind="error">{error}</Alert></div>}

      {canSend ? (
        <div className="relative flex items-end gap-1.5 border-t border-slate-200 p-2.5 dark:border-slate-800">
          {showEmoji && <EmojiPicker onPick={(e) => setText((t) => t + e)} />}
          <button className="btn-ghost !p-2" onClick={() => setShowEmoji((s) => !s)} aria-label="Emoji"><Smile className="h-5 w-5" /></button>
          <button className="btn-ghost !p-2" onClick={() => fileRef.current?.click()} aria-label="Attach image"><ImagePlus className="h-5 w-5" /></button>
          <button className="btn-ghost !p-2" onClick={() => setShowCamera(true)} aria-label="Take photo"><Camera className="h-5 w-5" /></button>
          <input ref={fileRef} type="file" accept={IMAGE_ACCEPT} hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) pickFile(f); }} />
          <textarea className="input max-h-32 min-h-[42px] flex-1 resize-none" rows={1} value={text} placeholder="Message…" maxLength={4000}
            onChange={(e) => onType(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); } }} />
          <button className="btn-primary !p-2.5" onClick={sendText} disabled={!text.trim() || sending} aria-label="Send">{sending ? <Spinner className="!text-white" /> : <Send className="h-5 w-5" />}</button>
        </div>
      ) : (
        <div className="border-t border-slate-200 p-3 text-center text-sm text-slate-500 dark:border-slate-800">
          {name} has left this chat, so you can no longer send messages. You can still read it until it expires.
        </div>
      )}

      {showCamera && <CameraCapture onClose={() => setShowCamera(false)} onCapture={(f) => { setShowCamera(false); pickFile(f); }} />}

      {pendingImage && (
        <Modal title="Send this photo?" onClose={() => !uploading && (URL.revokeObjectURL(pendingImage.url), setPendingImage(null))}>
          <img src={pendingImage.url} alt="Preview" className="max-h-72 w-full rounded-xl bg-slate-100 object-contain dark:bg-slate-800"
               onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          <p className="mt-2 text-xs text-slate-500">{pendingImage.file.name} · {(pendingImage.file.size / 1024).toFixed(0)} KB. If no preview appears, your browser cannot display this format (e.g. HEIC) but it can still be sent.</p>
          <div className="mt-4 flex justify-end gap-2">
            <button className="btn-ghost" disabled={uploading} onClick={() => { URL.revokeObjectURL(pendingImage.url); setPendingImage(null); }}>Cancel</button>
            <button className="btn-primary" disabled={uploading} onClick={sendImage}>{uploading ? <Spinner className="!text-white" /> : 'Send'}</button>
          </div>
        </Modal>
      )}

      {confirmEnd && (
        <Modal title="End this chat?" onClose={() => setConfirmEnd(false)}>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-600 dark:text-slate-400">
            <li>The conversation disappears from <b>your</b> side right away and cannot be reopened.</li>
            <li>{name} is notified that you left. They keep access until the shared chat expires in {formatRemaining(left)}.</li>
            <li>Either way, all messages and photos are deleted for everyone when it expires.</li>
          </ul>
          <div className="mt-5 flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setConfirmEnd(false)}>Keep chatting</button>
            <button className="btn-danger" onClick={endChat}>End chat</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Bubble({ m, mine, otherName }: { m: Message; mine: boolean; otherName: string }) {
  if (m.kind === 'system') {
    return <p className="py-1 text-center text-xs text-slate-500">{mine ? 'You left the chat.' : `${otherName} ended their participation. They can no longer receive messages.`}</p>;
  }
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'} animate-slide-up`}>
      <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 ${mine ? 'rounded-br-md bg-brand-600 text-white' : 'rounded-bl-md bg-slate-100 dark:bg-slate-800'}`}>
        {m.kind === 'image' ? <ChatImage messageId={m.id} /> : <p className="whitespace-pre-wrap break-words text-sm">{m.body}</p>}
        <p className={`mt-0.5 flex items-center justify-end gap-1 text-[10px] ${mine ? 'text-brand-100' : 'text-slate-500'}`}>
          {formatTime(m.created_at)}
          {mine && (m.read_at ? <CheckCheck className="h-3.5 w-3.5 text-sky-300" aria-label="Read" />
            : m.delivered_at ? <CheckCheck className="h-3.5 w-3.5" aria-label="Delivered" /> : <Check className="h-3.5 w-3.5" aria-label="Sent" />)}
        </p>
      </div>
    </div>
  );
}

function ChatImage({ messageId }: { messageId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(false);
  useEffect(() => {
    let live = true;
    (async () => {
      const { data } = await supabase.from('media_attachments').select('storage_path').eq('message_id', messageId).maybeSingle();
      if (!data) return live && setFailed(true);
      const u = await signedUrl('chat-media', (data as { storage_path: string }).storage_path, 300);
      if (live) u ? setUrl(u) : setFailed(true);
    })();
    return () => { live = false; };
  }, [messageId]);

  if (failed) return <p className="text-sm italic opacity-80">Image unavailable (expired or unsupported).</p>;
  if (!url) return <div className="flex h-32 w-48 items-center justify-center"><Spinner /></div>;
  return (
    <>
      <img src={url} alt="Shared" className="max-h-64 cursor-zoom-in rounded-xl object-cover" onClick={() => setZoom(true)} onError={() => setFailed(true)} />
      {zoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setZoom(false)}>
          <img src={url} alt="Shared full size" className="max-h-full max-w-full rounded-lg" />
        </div>
      )}
    </>
  );
}
