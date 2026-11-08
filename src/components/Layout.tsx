import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate, Link } from 'react-router-dom';
import { Inbox, LayoutDashboard, LogOut, Phone, PhoneOff, Settings, ShieldCheck, User, UserPlus, Video, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { emitRefresh, useAuth, useRefreshListener } from '../lib/auth';
import type { CallSession, Profile } from '../lib/types';
import ThemeToggle from './ThemeToggle';
import Avatar from './Avatar';
import { friendlyError } from '../lib/utils';

const NAV = [
  { to: '/dashboard', label: 'Chats', icon: LayoutDashboard },
  { to: '/invite', label: 'Invite', icon: UserPlus },
  { to: '/invitations', label: 'Invitations', icon: Inbox },
  { to: '/profile', label: 'Profile', icon: User },
  { to: '/privacy', label: 'Privacy', icon: ShieldCheck },
  { to: '/account', label: 'Account', icon: Settings },
];

interface Toast { id: number; text: string }

export default function Layout() {
  const { user, profile, signOut } = useAuth();
  const nav = useNavigate();
  const uid = user!.id;
  const [pending, setPending] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [incoming, setIncoming] = useState<{ call: CallSession; caller: Profile | null } | null>(null);

  const toast = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);

  const loadPending = useCallback(async () => {
    const { count } = await supabase.from('invitations').select('id', { count: 'exact', head: true })
      .eq('status', 'pending').neq('inviter_id', uid).gt('expires_at', new Date().toISOString());
    setPending(count ?? 0);
  }, [uid]);
  useEffect(() => { loadPending(); }, [loadPending]);
  useRefreshListener(loadPending);

  const showIncoming = useCallback(async (call: CallSession) => {
    const { data } = await supabase.from('profiles').select('*').eq('id', call.caller_id).maybeSingle();
    setIncoming({ call, caller: (data as Profile) ?? null });
  }, []);

  // One realtime channel for app-wide notifications. Every event passes through RLS first.
  useEffect(() => {
    // pick up a call that is already ringing (e.g. page opened right after the call started)
    supabase.from('call_sessions').select('*').eq('callee_id', uid).eq('status', 'ringing')
      .gt('created_at', new Date(Date.now() - 45_000).toISOString()).order('created_at', { ascending: false }).limit(1)
      .then(({ data }) => { if (data?.[0]) showIncoming(data[0] as CallSession); });

    const ch = supabase.channel(`global-${uid}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'invitations' }, (p) => {
        if ((p.new as { inviter_id: string }).inviter_id !== uid) toast('You received a new chat invitation.');
        loadPending(); emitRefresh();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'invitations' }, () => { loadPending(); emitRefresh(); })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conversation_participants' }, (p) => {
        if ((p.new as { user_id: string }).user_id !== uid) toast('Your invitation was accepted — a new chat is ready.');
        emitRefresh();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversation_participants' }, (p) => {
        const n = p.new as { user_id: string; status: string };
        if (n.user_id !== uid && n.status === 'ended') toast('Someone ended their participation in a chat.');
        emitRefresh();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'call_sessions', filter: `callee_id=eq.${uid}` }, (p) => showIncoming(p.new as CallSession))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'call_sessions', filter: `callee_id=eq.${uid}` }, (p) => {
        const c = p.new as CallSession;
        setIncoming((cur) => (cur && cur.call.id === c.id && c.status !== 'ringing' ? null : cur));
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [uid, loadPending, toast, showIncoming]);

  async function rejectCall() {
    if (!incoming) return;
    const id = incoming.call.id; setIncoming(null);
    const { error } = await supabase.rpc('respond_call', { p_id: id, p_action: 'reject' });
    if (error) toast(friendlyError(error));
  }
  function acceptCall() {
    if (!incoming) return;
    const id = incoming.call.id; setIncoming(null);
    nav(`/call/${id}`);
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <Link to="/dashboard" className="flex items-center gap-2 font-semibold"><span className="text-xl">🫥</span> LiveChat</Link>
          <nav className="ml-4 hidden gap-1 md:flex">
            {NAV.map(({ to, label }) => (
              <NavLink key={to} to={to} className={({ isActive }) => `relative rounded-lg px-3 py-1.5 text-sm ${isActive ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-900/30 dark:text-brand-200' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
                {label}
                {to === '/invitations' && pending > 0 && <span className="ml-1.5 rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">{pending}</span>}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {profile && <span className="hidden items-center gap-2 text-sm sm:flex"><Avatar path={profile.avatar_path} name={profile.username} size={28} />@{profile.username}</span>}
            <ThemeToggle />
            <button className="btn-ghost !p-2" onClick={signOut} aria-label="Sign out" title="Sign out"><LogOut className="h-5 w-5" /></button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 pb-24 md:pb-6"><Outlet /></main>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden dark:border-slate-800 dark:bg-slate-950/95">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} className={({ isActive }) => `relative flex flex-col items-center gap-0.5 py-2 text-[10px] ${isActive ? 'text-brand-600 dark:text-brand-300' : 'text-slate-500'}`}>
            <Icon className="h-5 w-5" />{label}
            {to === '/invitations' && pending > 0 && <span className="absolute right-3 top-1 h-2 w-2 rounded-full bg-rose-600" />}
          </NavLink>
        ))}
      </nav>

      <div className="pointer-events-none fixed inset-x-0 top-16 z-50 flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto flex max-w-sm items-center gap-3 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-lg animate-slide-up dark:bg-slate-100 dark:text-slate-900">
            {t.text}
            <button aria-label="Dismiss" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}><X className="h-4 w-4" /></button>
          </div>
        ))}
      </div>

      {incoming && (
        <div className="fixed inset-x-0 top-4 z-[60] mx-auto w-[calc(100%-2rem)] max-w-sm animate-slide-up rounded-2xl bg-slate-900 p-4 text-white shadow-2xl">
          <div className="flex items-center gap-3">
            <Avatar path={incoming.caller?.avatar_path} name={incoming.caller?.username ?? '?'} size={44} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{incoming.caller?.display_name || incoming.caller?.username || 'Incoming call'}</p>
              <p className="text-xs text-slate-300">Incoming {incoming.call.type} call…</p>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button className="btn-danger flex-1" onClick={rejectCall}><PhoneOff className="h-4 w-4" /> Decline</button>
            <button className="btn flex-1 bg-emerald-600 text-white hover:bg-emerald-700" onClick={acceptCall}>
              {incoming.call.type === 'video' ? <Video className="h-4 w-4" /> : <Phone className="h-4 w-4" />} Accept
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
