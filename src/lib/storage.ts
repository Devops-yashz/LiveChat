import { useEffect, useState } from 'react';
import { supabase } from './supabase';

const cache = new Map<string, { url: string; exp: number }>();

/** Short-lived signed URL for a private bucket object (cached for most of its lifetime). */
export async function signedUrl(bucket: string, path: string, ttl = 3600): Promise<string | null> {
  const key = `${bucket}/${path}`;
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now() + 30_000) return hit.url;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, ttl);
  if (error || !data) return null;
  cache.set(key, { url: data.signedUrl, exp: Date.now() + ttl * 1000 });
  return data.signedUrl;
}

export function useSignedUrl(bucket: string, path: string | null | undefined, ttl = 3600) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setUrl(null);
    if (path) signedUrl(bucket, path, ttl).then((u) => live && setUrl(u));
    return () => { live = false; };
  }, [bucket, path, ttl]);
  return url;
}
