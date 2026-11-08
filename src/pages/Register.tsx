import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import AuthShell, { MethodTabs } from '../components/AuthShell';
import { Alert, Spinner } from '../components/ui';
import { friendlyError } from '../lib/utils';

export default function Register() {
  const nav = useNavigate();
  const [method, setMethod] = useState<'email' | 'phone'>('email');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [stage, setStage] = useState<'form' | 'otp' | 'check-email'>('form');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault(); setError('');
    const uname = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(uname)) return setError('Username must be 3–20 characters: lowercase letters, numbers or underscore.');
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (method === 'phone' && !/^\+[0-9]{8,15}$/.test(phone.replace(/[\s()-]/g, ''))) return setError('Enter your phone number with country code, e.g. +919876543210.');
    setBusy(true);
    try {
      const { data: free, error: e1 } = await supabase.rpc('username_available', { p_username: uname });
      if (e1) throw e1;
      if (!free) throw new Error('That username is taken.');
      if (method === 'email') {
        const { data, error: e2 } = await supabase.auth.signUp({ email: email.trim(), password, options: { data: { username: uname }, emailRedirectTo: `${window.location.origin}/login` } });
        if (e2) throw e2;
        if (data.session) nav('/dashboard'); else setStage('check-email');
      } else {
        const { error: e2 } = await supabase.auth.signUp({ phone: phone.replace(/[\s()-]/g, ''), password, options: { data: { username: uname } } });
        if (e2) throw e2;
        setStage('otp');
      }
    } catch (err) { setError(friendlyError(err)); } finally { setBusy(false); }
  }

  async function verify(e: FormEvent) {
    e.preventDefault(); setError(''); setBusy(true);
    const { error: err } = await supabase.auth.verifyOtp({ phone: phone.replace(/[\s()-]/g, ''), token: otp.trim(), type: 'sms' });
    setBusy(false);
    if (err) return setError('Invalid or expired code.');
    nav('/dashboard');
  }

  if (stage === 'check-email') return (
    <AuthShell title="Check your inbox" subtitle={`We sent a verification link to ${email}.`}>
      <Alert kind="success">Open the link to verify your email, then log in.</Alert>
      <Link to="/login" className="btn-primary mt-4 w-full">Go to login</Link>
    </AuthShell>
  );

  if (stage === 'otp') return (
    <AuthShell title="Verify your phone" subtitle={`Enter the 6-digit code sent to ${phone}.`}>
      <form onSubmit={verify} className="space-y-4">
        {error && <Alert kind="error">{error}</Alert>}
        <input className="input text-center text-lg tracking-widest" inputMode="numeric" maxLength={6} autoFocus value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="123456" />
        <button className="btn-primary w-full" disabled={busy || otp.length < 6}>{busy ? <Spinner className="!text-white" /> : 'Verify'}</button>
      </form>
    </AuthShell>
  );

  return (
    <AuthShell title="Create your account" subtitle="Register with your email or mobile number.">
      <MethodTabs value={method} onChange={setMethod} />
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert kind="error">{error}</Alert>}
        <div><label className="label" htmlFor="u">Username</label>
          <input id="u" className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" placeholder="your_name" required /></div>
        {method === 'email'
          ? <div><label className="label" htmlFor="e">Email</label><input id="e" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></div>
          : <div><label className="label" htmlFor="p">Mobile number</label><input id="p" type="tel" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" placeholder="+919876543210" required /></div>}
        <div><label className="label" htmlFor="pw">Password</label>
          <input id="pw" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} required /></div>
        <button className="btn-primary w-full" disabled={busy}>{busy ? <Spinner className="!text-white" /> : 'Create account'}</button>
        <p className="text-center text-sm text-slate-500">Already registered? <Link className="font-medium text-brand-600" to="/login">Log in</Link></p>
      </form>
    </AuthShell>
  );
}
