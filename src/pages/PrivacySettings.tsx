import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { Alert, PageLoader } from '../components/ui';

type Key = 'show_online_status' | 'send_read_receipts' | 'share_typing';
const OPTIONS: { key: Key; title: string; text: string }[] = [
  { key: 'show_online_status', title: 'Show when I am online', text: 'Contacts see a green dot while you are active. Turn this off to always appear offline.' },
  { key: 'send_read_receipts', title: 'Send read receipts', text: 'Let people know when you have read their messages.' },
  { key: 'share_typing', title: 'Share typing indicator', text: 'Show “typing…” to the other person while you write.' },
];

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? 'bg-brand-600' : 'bg-slate-300 dark:bg-slate-700'}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  );
}

export default function PrivacySettings() {
  const { profile, refreshProfile } = useAuth();
  const [minutes, setMinutes] = useState<number | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { supabase.rpc('get_retention_minutes').then(({ data }) => setMinutes(typeof data === 'number' ? data : null)); }, []);
  if (!profile) return <PageLoader />;

  async function set(key: Key, value: boolean) {
    setError('');
    const patch: Record<string, unknown> = { [key]: value };
    if (key === 'show_online_status' && !value) patch.last_seen_at = null;
    const { error: err } = await supabase.from('profiles').update(patch).eq('id', profile!.id);
    if (err) setError(err.message); else refreshProfile();
  }
  const retention = minutes === null ? '24 hours' : minutes % 60 === 0 ? `${minutes / 60} hour${minutes === 60 ? '' : 's'}` : `${minutes} minutes`;

  return (
    <div className="mx-auto max-w-xl space-y-6 animate-fade-in">
      <h1 className="text-2xl font-semibold tracking-tight">Privacy settings</h1>
      {error && <Alert kind="error">{error}</Alert>}
      <div className="card divide-y divide-slate-200 !p-0 dark:divide-slate-800">
        {OPTIONS.map((o) => (
          <div key={o.key} className="flex items-center justify-between gap-4 p-4">
            <div><p className="font-medium">{o.title}</p><p className="text-sm text-slate-500">{o.text}</p></div>
            <Toggle on={profile[o.key]} onChange={(v) => set(o.key, v)} label={o.title} />
          </div>
        ))}
      </div>
      <div className="card space-y-2 text-sm">
        <h2 className="font-semibold">How disappearing chats work</h2>
        <ul className="list-disc space-y-1.5 pl-5 text-slate-600 dark:text-slate-400">
          <li>Every message and photo is deleted from our servers within <b>{retention}</b> (server-enforced).</li>
          <li><b>End chat</b> hides the conversation on <i>your</i> side immediately. The other person is notified and keeps their copy until the shared chat expires.</li>
          <li>When the shared chat expires, it disappears for both people. Expired chats are never restored.</li>
          <li>Messages are protected in transit and by access rules, but they are <b>not end-to-end encrypted</b>.</li>
        </ul>
      </div>
    </div>
  );
}
