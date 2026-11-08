import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock, Inbox, MessageSquarePlus, MessagesSquare, Users } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth, useRefreshListener } from '../lib/auth';
import type { ConversationRow } from '../lib/types';
import { displayName, formatRemaining, isOnline, useNow } from '../lib/utils';
import Avatar from '../components/Avatar';
import { Alert, Empty, PageLoader } from '../components/ui';

export default function Dashboard() {
  const { profile } = useAuth();
  const [convs, setConvs] = useState<ConversationRow[] | null>(null);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState('');
  const now = useNow(1000);

  const load = useCallback(async () => {
    const [c, i] = await Promise.all([
      supabase.rpc('my_conversations'),
      supabase.from('invitations').select('id', { count: 'exact', head: true }).eq('status', 'pending').neq('inviter_id', profile?.id ?? '').gt('expires_at', new Date().toISOString()),
    ]);
    if (c.error) setError(c.error.message); else setConvs(c.data as ConversationRow[]);
    setPending(i.count ?? 0);
  }, [profile?.id]);

  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load]);
  useRefreshListener(load);

  if (!convs && !error) return <PageLoader />;
  const active = (convs ?? []).filter((c) => new Date(c.expires_at).getTime() > now);
  const online = active.filter((c) => c.other_status === 'active' && isOnline(c.other_last_seen_at, now));

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Hi{profile ? `, ${profile.display_name || profile.username}` : ''} 👋</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Every chat expires automatically. Ending a chat hides it only on your side.</p>
        </div>
        <Link to="/invite" className="btn-primary"><MessageSquarePlus className="h-4 w-4" /> New chat</Link>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat icon={<MessagesSquare className="h-5 w-5" />} label="Active chats" value={active.length} />
        <Link to="/invitations"><Stat icon={<Inbox className="h-5 w-5" />} label="Pending invitations" value={pending} highlight={pending > 0} /></Link>
        <Stat icon={<Users className="h-5 w-5" />} label="Online contacts" value={online.length} />
      </div>

      {online.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-500">Online now</h2>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {online.map((c) => (
              <Link key={c.conversation_id} to={`/chat/${c.conversation_id}`} className="flex w-20 shrink-0 flex-col items-center gap-1 text-center text-xs">
                <Avatar path={c.other_avatar_path} name={displayName(c)} size={48} online />
                <span className="w-full truncate">{displayName(c)}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-500">Conversations</h2>
        {active.length === 0 ? (
          <Empty icon={<MessagesSquare className="h-8 w-8" />} title="No active chats">
            <Link to="/invite" className="text-brand-600">Invite someone</Link> to start a private conversation.
          </Empty>
        ) : (
          <ul className="space-y-2">
            {active.map((c) => {
              const left = new Date(c.expires_at).getTime() - now;
              return (
                <li key={c.conversation_id}>
                  <Link to={`/chat/${c.conversation_id}`} className="card flex items-center gap-3 !p-4 transition hover:border-brand-300">
                    <Avatar path={c.other_avatar_path} name={displayName(c)} online={c.other_status === 'active' ? isOnline(c.other_last_seen_at, now) : undefined} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{displayName(c)} <span className="font-normal text-slate-400">@{c.other_username}</span></p>
                      <p className={`flex items-center gap-1 text-xs ${left < 3600_000 ? 'text-rose-600' : 'text-slate-500'}`}>
                        <Clock className="h-3 w-3" /> {formatRemaining(left)} left
                        {c.other_status === 'ended' && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300">they left</span>}
                      </p>
                    </div>
                    {c.unread_count > 0 && <span className="rounded-full bg-brand-600 px-2 py-0.5 text-xs font-semibold text-white">{c.unread_count}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ icon, label, value, highlight }: { icon: React.ReactNode; label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`card flex items-center gap-3 !p-4 ${highlight ? 'border-brand-300 dark:border-brand-700' : ''}`}>
      <span className="rounded-xl bg-brand-50 p-2.5 text-brand-600 dark:bg-brand-900/30">{icon}</span>
      <div><p className="text-2xl font-semibold leading-none">{value}</p><p className="mt-1 text-xs text-slate-500">{label}</p></div>
    </div>
  );
}
