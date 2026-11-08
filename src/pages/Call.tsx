import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Mic, MicOff, PhoneOff, SwitchCamera, Video, VideoOff } from 'lucide-react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { iceServers } from '../lib/webrtc';
import type { CallSession, Profile } from '../lib/types';
import Avatar from '../components/Avatar';
import { Spinner } from '../components/ui';

type Phase = 'init' | 'ringing' | 'connecting' | 'connected' | 'reconnecting' | 'ended' | 'error';
interface Signal { type: 'ping' | 'ready' | 'offer' | 'answer' | 'candidate' | 'hangup'; from: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }

/**
 * Signalling protocol (all over the private Realtime channel "conv:<conversation_id>", authorised by RLS):
 *  caller: creates call_sessions row (ringing) -> subscribes -> pings until callee answers "ready" -> sends offer
 *  callee: gets modal -> opens this page -> gets media -> subscribes -> respond_call(accept) -> answers pings with "ready"
 * Media is peer-to-peer (DTLS-SRTP). Nothing is recorded or stored.
 */
export default function Call() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const uid = user!.id;

  const [phase, setPhase] = useState<Phase>('init');
  const [error, setError] = useState('');
  const [session, setSession] = useState<CallSession | null>(null);
  const [other, setOther] = useState<Profile | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [canFlip, setCanFlip] = useState(false);
  const [seconds, setSeconds] = useState(0);

  const localVideo = useRef<HTMLVideoElement>(null);
  const remoteVideo = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chRef = useRef<RealtimeChannel | null>(null);
  const dbRef = useRef<RealtimeChannel | null>(null);
  const facingRef = useRef<'user' | 'environment'>('user');
  const finishRef = useRef<(msg?: string, leaveSilently?: boolean) => void>(() => {});
  const convRef = useRef('');
  const finishedRef = useRef(false);

  const send = useCallback((type: Signal['type'], extra: Partial<Signal> = {}) => {
    chRef.current?.send({ type: 'broadcast', event: 'rtc', payload: { type, from: uid, ...extra } });
  }, [uid]);

  useEffect(() => {
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout | typeof setInterval>[] = [];
    const queued: RTCIceCandidateInit[] = [];
    let offered = false;
    let ready = false;
    let isCaller = false;
    let disconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const teardown = () => {
      timers.forEach((t) => { clearTimeout(t as ReturnType<typeof setTimeout>); clearInterval(t as ReturnType<typeof setInterval>); });
      clearTimeout(disconnectTimer);
      streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null;
      pcRef.current?.close(); pcRef.current = null;
      if (chRef.current) supabase.removeChannel(chRef.current); chRef.current = null;
      if (dbRef.current) supabase.removeChannel(dbRef.current); dbRef.current = null;
    };

    const finish = (msg?: string, silent?: boolean) => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      teardown();
      if (msg) setError(msg);
      setPhase('ended');
      if (!silent) setTimeout(() => nav(convRef.current ? `/chat/${convRef.current}` : '/dashboard', { replace: true }), msg ? 2000 : 600);
    };
    finishRef.current = finish;

    (async () => {
      const { data: s } = await supabase.from('call_sessions').select('*').eq('id', id).maybeSingle();
      if (cancelled) return;
      if (!s) return finish('This call is no longer available.');
      const sess = s as CallSession;
      setSession(sess); convRef.current = sess.conversation_id;
      if (['ended', 'rejected', 'missed'].includes(sess.status)) return finish('This call has already ended.');
      isCaller = sess.caller_id === uid;
      const withVideo = sess.type === 'video';
      if (!withVideo) setCamOn(false);

      supabase.from('profiles').select('*').eq('id', isCaller ? sess.callee_id : sess.caller_id).maybeSingle()
        .then(({ data }) => !cancelled && setOther(data as Profile));

      // ---- local media (browser asks for permission here)
      let stream: MediaStream;
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: withVideo ? { facingMode: 'user' } : false });
      } catch {
        await supabase.rpc('respond_call', { p_id: id, p_action: isCaller ? 'end' : 'reject' });
        return finish('Microphone/camera permission is required for calls (and HTTPS must be used).');
      }
      if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
      streamRef.current = stream;
      if (localVideo.current) localVideo.current.srcObject = stream;
      if (withVideo) navigator.mediaDevices.enumerateDevices().then((d) => setCanFlip(d.filter((x) => x.kind === 'videoinput').length > 1));

      // ---- peer connection
      const pc = new RTCPeerConnection({ iceServers: iceServers() });
      pcRef.current = pc;
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      pc.ontrack = (e) => { if (remoteVideo.current) remoteVideo.current.srcObject = e.streams[0]; };
      pc.onicecandidate = (e) => { if (e.candidate) send('candidate', { candidate: e.candidate.toJSON() }); };

      const makeOffer = async (iceRestart: boolean) => {
        if (offered && !iceRestart) return;
        offered = true;
        const offer = await pc.createOffer({ iceRestart });
        await pc.setLocalDescription(offer);
        send('offer', { sdp: pc.localDescription! });
      };

      pc.oniceconnectionstatechange = () => {
        const st = pc.iceConnectionState;
        if (st === 'connected' || st === 'completed') { clearTimeout(disconnectTimer); setPhase('connected'); }
        else if (st === 'checking') setPhase((p) => (p === 'connected' ? p : 'connecting'));
        else if (st === 'disconnected') {
          setPhase('reconnecting');
          clearTimeout(disconnectTimer);
          disconnectTimer = setTimeout(() => { if (isCaller && pc.iceConnectionState !== 'connected') makeOffer(true).catch(() => {}); }, 4000);
        } else if (st === 'failed') {
          setPhase('reconnecting');
          if (isCaller) makeOffer(true).catch(() => {});
          clearTimeout(disconnectTimer);
          disconnectTimer = setTimeout(() => { if (pc.iceConnectionState !== 'connected') { supabase.rpc('respond_call', { p_id: id, p_action: 'end' }); finish('Connection lost.'); } }, 30_000);
        }
      };

      const flush = async () => { while (queued.length) await pc.addIceCandidate(queued.shift()!).catch(() => {}); };

      const onSignal = async (p: Signal) => {
        if (p.from === uid) return;
        try {
          switch (p.type) {
            case 'ping': if (!isCaller && ready) send('ready'); break;
            case 'ready': if (isCaller) await makeOffer(false); break;
            case 'offer': {
              await pc.setRemoteDescription(p.sdp!); await flush();
              const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
              send('answer', { sdp: pc.localDescription! }); setPhase((x) => (x === 'connected' ? x : 'connecting')); break;
            }
            case 'answer': await pc.setRemoteDescription(p.sdp!); await flush(); break;
            case 'candidate':
              if (pc.remoteDescription) await pc.addIceCandidate(p.candidate!).catch(() => {}); else queued.push(p.candidate!);
              break;
            case 'hangup': finish('The other person ended the call.'); break;
          }
        } catch (e) { console.error('signal error', e); }
      };

      // ---- session status updates (accepted / rejected / ended)
      dbRef.current = supabase.channel(`call-db-${id}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'call_sessions', filter: `id=eq.${id}` }, (pl) => {
          const n = pl.new as CallSession; setSession(n);
          if (n.status === 'rejected') finish('Call declined.');
          else if (n.status === 'missed' || n.status === 'ended') finish('Call ended.');
          else if (n.status === 'active' && isCaller) kick();
        }).subscribe();

      const kick = () => {
        if (offered) return;
        send('ping');
        const t = setInterval(() => { if (offered || finishedRef.current) clearInterval(t); else send('ping'); }, 1500);
        timers.push(t);
      };

      // ---- signalling channel
      await supabase.realtime.setAuth();
      if (cancelled) return;
      const ch = supabase.channel(`conv:${sess.conversation_id}`, { config: { private: true } });
      chRef.current = ch;
      ch.on('broadcast', { event: 'rtc' }, ({ payload }) => onSignal(payload as Signal));
      ch.subscribe(async (status) => {
        if (status !== 'SUBSCRIBED' || cancelled) return;
        if (isCaller) {
          setPhase('ringing');
          const { data: cur } = await supabase.from('call_sessions').select('status').eq('id', id).maybeSingle();
          if ((cur as { status: string } | null)?.status === 'active') kick();
          timers.push(setTimeout(async () => { if (!offered) { await supabase.rpc('respond_call', { p_id: id, p_action: 'end' }); finish('No answer.'); } }, 45_000));
        } else {
          ready = true; setPhase('connecting');
          if (sess.status === 'ringing') {
            const { error: e } = await supabase.rpc('respond_call', { p_id: id, p_action: 'accept' });
            if (e) return finish('Could not join the call.');
          }
          send('ready');
        }
      });

      timers.push(setInterval(() => setSeconds((x) => x + 1), 1000));
    })();

    return () => {
      cancelled = true;
      if (!finishedRef.current) { finishedRef.current = true; supabase.rpc('respond_call', { p_id: id, p_action: 'end' }).then(() => {}); chRef.current?.send({ type: 'broadcast', event: 'rtc', payload: { type: 'hangup', from: uid } }); }
      teardown();
    };
  }, [id, uid, nav, send]);

  async function hangUp() {
    send('hangup');
    await supabase.rpc('respond_call', { p_id: id, p_action: 'end' });
    finishRef.current(undefined);
  }
  function toggleMic() { const t = streamRef.current?.getAudioTracks()[0]; if (t) { t.enabled = !t.enabled; setMicOn(t.enabled); } }
  function toggleCam() { const t = streamRef.current?.getVideoTracks()[0]; if (t) { t.enabled = !t.enabled; setCamOn(t.enabled); } }
  async function flipCamera() {
    const pc = pcRef.current, old = streamRef.current;
    if (!pc || !old) return;
    const next = facingRef.current === 'user' ? 'environment' : 'user';
    try {
      const ns = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: next } }, audio: false });
      const track = ns.getVideoTracks()[0];
      await pc.getSenders().find((s) => s.track?.kind === 'video')?.replaceTrack(track);
      old.getVideoTracks().forEach((t) => { t.stop(); old.removeTrack(t); });
      old.addTrack(track);
      facingRef.current = next;
      if (localVideo.current) localVideo.current.srcObject = old;
      setCamOn(true);
    } catch { setError('Could not switch camera.'); }
  }

  const isVideo = session?.type === 'video';
  const name = other?.display_name || other?.username || 'Call';
  const label = { init: 'Starting…', ringing: `Calling ${name}…`, connecting: 'Connecting…', connected: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`, reconnecting: 'Reconnecting…', ended: 'Call ended', error: 'Error' }[phase];

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-slate-950 text-white">
      <div className="relative flex-1 overflow-hidden">
        <video ref={remoteVideo} autoPlay playsInline className={`h-full w-full object-cover ${isVideo && phase === 'connected' ? '' : 'invisible'}`} />
        {!(isVideo && phase === 'connected') && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
            <Avatar path={other?.avatar_path} name={name} size={112} />
            <p className="text-xl font-semibold">{name}</p>
            <p className="flex items-center gap-2 text-slate-300">{['init', 'ringing', 'connecting', 'reconnecting'].includes(phase) && <Spinner className="!text-slate-300" />}{label}</p>
          </div>
        )}
        {isVideo && phase === 'connected' && <p className="absolute left-4 top-4 rounded-full bg-black/50 px-3 py-1 text-sm">{name} · {label}</p>}
        {phase === 'reconnecting' && isVideo && <p className="absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-amber-500 px-3 py-1 text-sm text-black">Reconnecting…</p>}
        {isVideo && (
          <video ref={localVideo} autoPlay playsInline muted
            className={`absolute bottom-4 right-4 h-36 w-28 rounded-xl border border-white/20 bg-black object-cover shadow-lg sm:h-44 sm:w-32 ${camOn ? '' : 'opacity-30'}`} />
        )}
        {!isVideo && <video ref={localVideo} autoPlay playsInline muted className="hidden" />}
        {error && <p className="absolute inset-x-4 bottom-4 rounded-xl bg-rose-600 px-4 py-2 text-center text-sm">{error}</p>}
      </div>
      <div className="flex items-center justify-center gap-4 bg-slate-900 px-4 py-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
        <button onClick={toggleMic} className={`rounded-full p-4 ${micOn ? 'bg-slate-700 hover:bg-slate-600' : 'bg-white text-slate-900'}`} aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'}>{micOn ? <Mic className="h-6 w-6" /> : <MicOff className="h-6 w-6" />}</button>
        {isVideo && <button onClick={toggleCam} className={`rounded-full p-4 ${camOn ? 'bg-slate-700 hover:bg-slate-600' : 'bg-white text-slate-900'}`} aria-label={camOn ? 'Turn camera off' : 'Turn camera on'}>{camOn ? <Video className="h-6 w-6" /> : <VideoOff className="h-6 w-6" />}</button>}
        {isVideo && canFlip && <button onClick={flipCamera} className="rounded-full bg-slate-700 p-4 hover:bg-slate-600" aria-label="Switch camera"><SwitchCamera className="h-6 w-6" /></button>}
        <button onClick={hangUp} className="rounded-full bg-rose-600 p-4 hover:bg-rose-700" aria-label="End call"><PhoneOff className="h-6 w-6" /></button>
      </div>
    </div>
  );
}
