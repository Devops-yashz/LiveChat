import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Profile } from './types';

interface AuthCtx {
  session: Session | null; user: User | null; profile: Profile | null; loading: boolean;
  refreshProfile: () => Promise<void>; signOut: () => Promise<void>;
}
const Ctx = createContext<AuthCtx>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const uid = session?.user.id;
  const refreshProfile = useCallback(async () => {
    if (!uid) return setProfile(null);
    const { data } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle();
    setProfile((data as Profile) ?? null);
  }, [uid]);
  useEffect(() => { refreshProfile(); }, [refreshProfile]);

  // Presence heartbeat (skipped server-side if the user hid their online status).
  useEffect(() => {
    if (!uid) return;
    const beat = () => { if (document.visibilityState === 'visible') supabase.rpc('heartbeat'); };
    beat();
    const t = setInterval(beat, 30_000);
    document.addEventListener('visibilitychange', beat);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', beat); };
  }, [uid]);

  const signOut = useCallback(async () => { await supabase.auth.signOut(); setProfile(null); }, []);
  return <Ctx.Provider value={{ session, user: session?.user ?? null, profile, loading, refreshProfile, signOut }}>{children}</Ctx.Provider>;
}
export const useAuth = () => useContext(Ctx);

/** Pages call this to refetch when realtime says something changed. */
export const REFRESH_EVENT = 'app:refresh';
export const emitRefresh = () => window.dispatchEvent(new Event(REFRESH_EVENT));
export function useRefreshListener(fn: () => void) {
  useEffect(() => { window.addEventListener(REFRESH_EVENT, fn); return () => window.removeEventListener(REFRESH_EVENT, fn); }, [fn]);
}
