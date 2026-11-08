import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import AuthShell, { MethodTabs } from '../components/AuthShell';
import { Alert, Spinner } from '../components/ui';

export default function ForgotPassword() {
  const nav = useNavigate();
  const [method, setMethod] = useState<'email' | 'phone'>('email');
  const [value, setValue] = useState('');
  const [otp, setOtp] = useState('');
  const [stage, setStage] = useState<'form' | 'sent' | 'otp'>('form');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const phone = value.replace(/[\s()-]/g, '');

  async function submit(e: FormEvent) {
    e.preventDefault(); setError(''); setBusy(true);
    if (method === 'email') {
      await supabase.auth.resetPasswordForEmail(value.trim(), { redirectTo: `${window.location.origin}/reset-password` });
      setStage('sent'); // same message whether or not the account exists
    } else {
      await supabase.auth.signInWithOtp({ phone, options: { shouldCreateUser: false } });
      setStage('otp');
    }
    setBusy(false);
  }

  async function verify(e: FormEvent) {
    e.preventDefault(); setError(''); setBusy(true);
    const { error: err } = await supabase.auth.verifyOtp({ phone, token: otp.trim(), type: 'sms' });
    setBusy(false);
    if (err) return setError('Invalid or expired code.');
    nav('/account', { state: { setPassword: true } });
  }

  if (stage === 'sent') return (
    <AuthShell title="Check your inbox">
      <Alert kind="success">If an account exists for that email, a reset link is on its way.</Alert>
      <Link to="/login" className="btn-outline mt-4 w-full">Back to login</Link>
    </AuthShell>
  );
  if (stage === 'otp') return (
    <AuthShell title="Enter the code" subtitle="If that number has an account, we sent a 6-digit code. After verifying you can set a new password in Account settings.">
      <form onSubmit={verify} className="space-y-4">
        {error && <Alert kind="error">{error}</Alert>}
        <input className="input text-center text-lg tracking-widest" inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="123456" autoFocus />
        <button className="btn-primary w-full" disabled={busy || otp.length < 6}>{busy ? <Spinner className="!text-white" /> : 'Verify'}</button>
      </form>
    </AuthShell>
  );
  return (
    <AuthShell title="Reset your password" subtitle="We’ll send a link or a code.">
      <MethodTabs value={method} onChange={setMethod} />
      <form onSubmit={submit} className="space-y-4">
        <input className="input" type={method === 'email' ? 'email' : 'tel'} value={value} onChange={(e) => setValue(e.target.value)} placeholder={method === 'email' ? 'you@example.com' : '+919876543210'} required />
        <button className="btn-primary w-full" disabled={busy}>{busy ? <Spinner className="!text-white" /> : 'Continue'}</button>
        <Link className="block text-center text-sm text-brand-600" to="/login">Back to login</Link>
      </form>
    </AuthShell>
  );
}
