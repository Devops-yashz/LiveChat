import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import AuthShell, { MethodTabs } from '../components/AuthShell';
import { Alert, Spinner } from '../components/ui';

export default function Login() {
  const { session } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [method, setMethod] = useState<'email' | 'phone'>('email');
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const from = (loc.state as { from?: string } | null)?.from ?? '/dashboard';

  if (session) return <Navigate to={from} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault(); setError(''); setBusy(true);
    const creds = method === 'email' ? { email: id.trim(), password } : { phone: id.replace(/[\s()-]/g, ''), password };
    const { error: err } = await supabase.auth.signInWithPassword(creds);
    setBusy(false);
    if (err) return setError(err.message.toLowerCase().includes('confirm') ? 'Please verify your email or phone first.' : 'Invalid credentials.');
    nav(from, { replace: true });
  }

  return (
    <AuthShell title="Welcome back" subtitle="Log in to your private chats.">
      <MethodTabs value={method} onChange={setMethod} />
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert kind="error">{error}</Alert>}
        <div><label className="label" htmlFor="id">{method === 'email' ? 'Email' : 'Mobile number'}</label>
          <input id="id" className="input" type={method === 'email' ? 'email' : 'tel'} value={id} onChange={(e) => setId(e.target.value)} placeholder={method === 'phone' ? '+919876543210' : ''} required /></div>
        <div><label className="label" htmlFor="pw">Password</label>
          <input id="pw" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></div>
        <button className="btn-primary w-full" disabled={busy}>{busy ? <Spinner className="!text-white" /> : 'Log in'}</button>
        <div className="flex justify-between text-sm"><Link className="text-brand-600" to="/forgot-password">Forgot password?</Link><Link className="text-brand-600" to="/register">Create account</Link></div>
      </form>
    </AuthShell>
  );
}
