import { useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { Alert, Spinner } from '../components/ui';

export default function AccountSettings() {
  const { user, signOut } = useAuth();
  const loc = useLocation();
  const [pw, setPw] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(
    (loc.state as { setPassword?: boolean } | null)?.setPassword ? { kind: 'info', text: 'You are verified. Choose a new password below.' } : null);

  async function changePassword(e: FormEvent) {
    e.preventDefault(); setMsg(null);
    if (pw.length < 8) return setMsg({ kind: 'error', text: 'Password must be at least 8 characters.' });
    setBusy('pw');
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy('');
    setMsg(error ? { kind: 'error', text: error.message } : { kind: 'success', text: 'Password updated.' });
    if (!error) setPw('');
  }
  async function changeEmail(e: FormEvent) {
    e.preventDefault(); setMsg(null); setBusy('email');
    const { error } = await supabase.auth.updateUser({ email: email.trim() });
    setBusy('');
    setMsg(error ? { kind: 'error', text: error.message } : { kind: 'success', text: 'Check both your old and new inbox to confirm the change.' });
  }

  return (
    <div className="mx-auto max-w-xl space-y-6 animate-fade-in">
      <h1 className="text-2xl font-semibold tracking-tight">Account settings</h1>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <div className="card text-sm">
        <p className="text-slate-500">Signed in as</p>
        <p className="font-medium">{user?.email || (user?.phone ? `+${user.phone}` : '—')}</p>
        <p className="mt-1 text-xs text-slate-500">Only you can see this.</p>
      </div>
      <form onSubmit={changePassword} className="card space-y-3">
        <h2 className="font-semibold">Change password</h2>
        <input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password" autoComplete="new-password" required />
        <button className="btn-primary" disabled={busy === 'pw'}>{busy === 'pw' ? <Spinner className="!text-white" /> : 'Update password'}</button>
      </form>
      {user?.email && (
        <form onSubmit={changeEmail} className="card space-y-3">
          <h2 className="font-semibold">Change email</h2>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="new@example.com" required />
          <button className="btn-outline" disabled={busy === 'email'}>{busy === 'email' ? <Spinner /> : 'Send confirmation'}</button>
        </form>
      )}
      <div className="card space-y-3">
        <h2 className="font-semibold">Sessions</h2>
        <div className="flex flex-wrap gap-2">
          <button className="btn-outline" onClick={signOut}>Sign out</button>
          <button className="btn-danger" onClick={async () => { await supabase.auth.signOut({ scope: 'global' }); }}>Sign out everywhere</button>
        </div>
      </div>
    </div>
  );
}
