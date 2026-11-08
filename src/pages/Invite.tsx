import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Send, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth, useRefreshListener } from '../lib/auth';
import type { Invitation } from '../lib/types';
import { Alert, Empty, Spinner } from '../components/ui';
import { friendlyError } from '../lib/utils';

export default function Invite() {
  const { user } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState<Invitation[]>([]);

  const load = useCallback(async () => {
    const { data } = await supabase.from('invitations').select('*').eq('inviter_id', user!.id).order('created_at', { ascending: false }).limit(20);
    setSent((data as Invitation[]) ?? []);
  }, [user]);
  useEffect(() => { load(); }, [load]);
  useRefreshListener(load);

  async function submit(e: FormEvent) {
    e.preventDefault(); setError(''); setNotice(''); setBusy(true);
    const { error: err } = await supabase.functions.invoke('invite', { body: { identifier: identifier.trim() } });
    setBusy(false);
    if (err) {
      let code = '';
      try { code = (await (err as unknown as { context: Response }).context.json()).error; } catch { /* ignore */ }
      return setError(friendlyError({ message: code || err.message }));
    }
    setNotice('Invitation sent. If this person can be reached, they will get it — and the chat starts only if they accept.');
    setIdentifier(''); load();
  }

  async function cancel(id: string) {
    await supabase.rpc('cancel_invitation', { p_id: id }); load();
  }

  return (
    <div className="mx-auto max-w-xl space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Invite someone</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Use their registered email, phone number (with country code) or username. Unregistered people get an email/SMS invitation if delivery is configured.</p>
      </div>
      <form onSubmit={submit} className="card space-y-4">
        {error && <Alert kind="error">{error}</Alert>}
        {notice && <Alert kind="success">{notice}</Alert>}
        <div>
          <label className="label" htmlFor="who">Email, phone or username</label>
          <input id="who" className="input" value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="friend@example.com · +919876543210 · @username" required />
        </div>
        <button className="btn-primary w-full" disabled={busy || !identifier.trim()}>{busy ? <Spinner className="!text-white" /> : <><Send className="h-4 w-4" /> Send invitation</>}</button>
        <p className="text-xs text-slate-500">For privacy, you will not be told whether this person already has an account.</p>
      </form>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-500">Sent invitations</h2>
        {sent.length === 0 ? <Empty title="Nothing sent yet" /> : (
          <ul className="space-y-2">
            {sent.map((i) => (
              <li key={i.id} className="card flex items-center justify-between !p-3 text-sm">
                <div className="min-w-0"><p className="truncate font-medium">{i.target_label}</p>
                  <p className="text-xs text-slate-500">{new Date(i.created_at).toLocaleString()} · {i.status === 'rejected' ? 'declined' : i.status}</p></div>
                {i.status === 'pending' && <button className="btn-ghost !p-2" onClick={() => cancel(i.id)} aria-label="Cancel invitation"><X className="h-4 w-4" /></button>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
