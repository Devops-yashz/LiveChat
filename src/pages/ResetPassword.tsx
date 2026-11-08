import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import AuthShell from '../components/AuthShell';
import { Alert, PageLoader, Spinner } from '../components/ui';

export default function ResetPassword() {
  const { session, loading } = useAuth();
  const nav = useNavigate();
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (loading) return <PageLoader />;
  if (!session) return (
    <AuthShell title="Link expired"><Alert kind="warn">This reset link is invalid or has expired.</Alert><Link to="/forgot-password" className="btn-primary mt-4 w-full">Request a new link</Link></AuthShell>
  );

  async function submit(e: FormEvent) {
    e.preventDefault(); setError('');
    if (pw.length < 8) return setError('Password must be at least 8 characters.');
    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (err) return setError(err.message);
    nav('/dashboard', { replace: true });
  }
  return (
    <AuthShell title="Choose a new password">
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert kind="error">{error}</Alert>}
        <input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password (min 8 characters)" autoComplete="new-password" required />
        <button className="btn-primary w-full" disabled={busy}>{busy ? <Spinner className="!text-white" /> : 'Update password'}</button>
      </form>
    </AuthShell>
  );
}
