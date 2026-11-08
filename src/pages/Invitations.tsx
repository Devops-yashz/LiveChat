import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Inbox, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { emitRefresh, useAuth, useRefreshListener } from '../lib/auth';
import type { Invitation, Profile } from '../lib/types';
import Avatar from '../components/Avatar';
import { Alert, Empty, PageLoader } from '../components/ui';
import { friendlyError } from '../lib/utils';

export default function Invitations() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [items, setItems] = useState<(Invitation & { inviter?: Profile })[] | null>(null);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data } = await supabase.from('invitations').select('*').eq('status', 'pending').neq('inviter_id', user!.id)
      .gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false });
    const list = (data as Invitation[]) ?? [];
    const ids = [...new Set(list.map((i) => i.inviter_id))];
    const { data: profs } = ids.length ? await supabase.from('profiles').select('*').in('id', ids) : { data: [] };
    const map = new Map(((profs as Profile[]) ?? []).map((p) => [p.id, p]));
    setItems(list.map((i) => ({ ...i, inviter: map.get(i.inviter_id) })));
  }, [user]);
  useEffect(() => { load(); }, [load]);
  useRefreshListener(load);

  async function respond(id: string, accept: boolean) {
    setBusyId(id); setError('');
    const { data, error: err } = await supabase.rpc('respond_invitation', { p_id: id, p_accept: accept });
    setBusyId('');
    if (err) return setError(friendlyError(err));
    emitRefresh();
    if (accept && data) nav(`/chat/${data}`); else load();
  }

  if (!items) return <PageLoader />;
  return (
    <div className="mx-auto max-w-xl space-y-4 animate-fade-in">
      <h1 className="text-2xl font-semibold tracking-tight">Invitations</h1>
      {error && <Alert kind="error">{error}</Alert>}
      {items.length === 0 ? <Empty icon={<Inbox className="h-8 w-8" />} title="No pending invitations">New invitations appear here instantly.</Empty> : (
        <ul className="space-y-3">
          {items.map((i) => (
            <li key={i.id} className="card flex items-center gap-3 animate-slide-up">
              <Avatar path={i.inviter?.avatar_path} name={i.inviter?.username ?? '?'} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{i.inviter?.display_name || i.inviter?.username || 'Someone'}</p>
                <p className="text-xs text-slate-500">@{i.inviter?.username ?? 'unknown'} invited you · {new Date(i.created_at).toLocaleString()}</p>
              </div>
              <button className="btn-ghost !p-2" disabled={busyId === i.id} onClick={() => respond(i.id, false)} aria-label="Reject"><X className="h-5 w-5" /></button>
              <button className="btn-primary !p-2" disabled={busyId === i.id} onClick={() => respond(i.id, true)} aria-label="Accept"><Check className="h-5 w-5" /></button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-slate-500">A chat only starts after you accept. Accepted chats expire for both people within the retention period.</p>
    </div>
  );
}
