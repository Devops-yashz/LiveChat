import { useRef, useState, type FormEvent } from 'react';
import { Camera } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import Avatar from '../components/Avatar';
import { Alert, PageLoader, Spinner } from '../components/ui';
import { friendlyError, validateImage } from '../lib/utils';

export default function Profile() {
  const { profile, refreshProfile } = useAuth();
  const [username, setUsername] = useState(profile?.username ?? '');
  const [name, setName] = useState(profile?.display_name ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [avatarKey, setAvatarKey] = useState(0);

  if (!profile) return <PageLoader />;

  async function save(e: FormEvent) {
    e.preventDefault(); setMsg(null);
    const uname = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(uname)) return setMsg({ kind: 'error', text: 'Username must be 3–20 characters: a–z, 0–9 or underscore.' });
    setBusy(true);
    try {
      if (uname !== profile!.username) {
        const { data: free } = await supabase.rpc('username_available', { p_username: uname });
        if (!free) throw new Error('That username is taken.');
      }
      const { error } = await supabase.from('profiles').update({ username: uname, display_name: name.trim() || null }).eq('id', profile!.id);
      if (error) throw error.code === '23505' ? new Error('That username is taken.') : error;
      await refreshProfile(); setMsg({ kind: 'success', text: 'Profile saved.' });
    } catch (err) { setMsg({ kind: 'error', text: friendlyError(err) }); } finally { setBusy(false); }
  }

  async function upload(file: File) {
    setMsg(null);
    const v = await validateImage(file, { maxMb: 2, allowed: ['image/jpeg', 'image/png', 'image/webp'] });
    if (!v.ok) return setMsg({ kind: 'error', text: v.error });
    setBusy(true);
    try {
      const path = `${profile!.id}/${Date.now()}.${v.ext}`;
      const { error: up } = await supabase.storage.from('avatars').upload(path, file, { contentType: v.mime, upsert: false });
      if (up) throw up;
      const old = profile!.avatar_path;
      const { error } = await supabase.from('profiles').update({ avatar_path: path }).eq('id', profile!.id);
      if (error) throw error;
      if (old) await supabase.storage.from('avatars').remove([old]);
      await refreshProfile(); setAvatarKey((k) => k + 1);
      setMsg({ kind: 'success', text: 'Profile picture updated.' });
    } catch (err) { setMsg({ kind: 'error', text: friendlyError(err) }); } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-xl space-y-6 animate-fade-in">
      <h1 className="text-2xl font-semibold tracking-tight">Your profile</h1>
      <div className="card flex items-center gap-4">
        <Avatar key={avatarKey} path={profile.avatar_path} name={profile.username} size={72} />
        <div>
          <button className="btn-outline" onClick={() => fileRef.current?.click()} disabled={busy}><Camera className="h-4 w-4" /> Change picture</button>
          <p className="mt-1 text-xs text-slate-500">JPG, PNG or WebP, up to 2 MB. Only people you chat with can see it.</p>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f); }} />
        </div>
      </div>
      <form onSubmit={save} className="card space-y-4">
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        <div><label className="label" htmlFor="un">Username</label>
          <input id="un" className="input" value={username} onChange={(e) => setUsername(e.target.value)} /></div>
        <div><label className="label" htmlFor="dn">Display name (optional)</label>
          <input id="dn" className="input" value={name} maxLength={50} onChange={(e) => setName(e.target.value)} /></div>
        <button className="btn-primary" disabled={busy}>{busy ? <Spinner className="!text-white" /> : 'Save changes'}</button>
      </form>
      <p className="text-xs text-slate-500">Your email address and phone number are never shown to other users.</p>
    </div>
  );
}
