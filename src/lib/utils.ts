import { useEffect, useState } from 'react';

export const MAX_UPLOAD_MB = Number(import.meta.env.VITE_MAX_UPLOAD_MB ?? 10);
export const IMAGE_ACCEPT = 'image/jpeg,image/png,image/gif,image/webp,image/avif,image/heic,image/heif,.jpg,.jpeg,.png,.gif,.webp,.avif,.heic,.heif';
export const ONLINE_WINDOW_MS = 70_000;

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), intervalMs); return () => clearInterval(t); }, [intervalMs]);
  return now;
}

export const displayName = (p: { display_name?: string | null; username?: string; other_display_name?: string | null; other_username?: string }) =>
  p.display_name || p.other_display_name || p.username || p.other_username || 'Unknown';

export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
export function formatRemaining(ms: number) {
  if (ms <= 0) return 'expired';
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${s}s`;
}
export const isOnline = (lastSeen: string | null, now = Date.now()) => !!lastSeen && now - new Date(lastSeen).getTime() < ONLINE_WINDOW_MS;

const ERRORS: Record<string, string> = {
  rate_limited: 'You are doing that too fast. Please wait a moment.',
  conversation_expired: 'This conversation has expired.',
  not_allowed: 'You are not allowed to do that.',
  invalid_identifier: 'Enter a valid email, a phone number with country code (+91…), or a username.',
  cannot_invite_self: 'You cannot invite yourself.',
  file_too_large: `File is too large (max ${MAX_UPLOAD_MB} MB).`,
  invalid_type: 'This file type is not allowed.',
  invitation_not_found: 'This invitation is no longer available.',
  empty_message: 'Message is empty.',
};
export function friendlyError(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? String(e ?? '');
  for (const k of Object.keys(ERRORS)) if (msg.includes(k)) return ERRORS[k];
  return msg || 'Something went wrong.';
}

// ---- image validation (extension + size + magic bytes). The server re-validates via bucket limits and send_image().
const ASCII = (b: Uint8Array, s: number, e: number) => String.fromCharCode(...b.slice(s, e));
export type ImageCheck = { ok: true; mime: string; ext: string } | { ok: false; error: string };

export async function validateImage(file: File, opts: { maxMb?: number; allowed?: string[] } = {}): Promise<ImageCheck> {
  const maxMb = opts.maxMb ?? MAX_UPLOAD_MB;
  const allowed = opts.allowed ?? ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'image/heic', 'image/heif'];
  if (file.size === 0) return { ok: false, error: 'File is empty.' };
  if (file.size > maxMb * 1024 * 1024) return { ok: false, error: `File is too large (max ${maxMb} MB).` };
  const b = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  let mime = '';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) mime = 'image/jpeg';
  else if (b[0] === 0x89 && ASCII(b, 1, 4) === 'PNG') mime = 'image/png';
  else if (ASCII(b, 0, 4) === 'GIF8') mime = 'image/gif';
  else if (ASCII(b, 0, 4) === 'RIFF' && ASCII(b, 8, 12) === 'WEBP') mime = 'image/webp';
  else if (ASCII(b, 4, 8) === 'ftyp') {
    const brand = ASCII(b, 8, 12);
    if (brand === 'avif' || brand === 'avis') mime = 'image/avif';
    else if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) mime = 'image/heic';
  }
  if (!mime || !allowed.includes(mime)) return { ok: false, error: 'Unsupported or invalid image. Allowed: JPG, PNG, GIF, WebP, AVIF, HEIC.' };
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'image/heic': 'heic', 'image/heif': 'heif' }[mime]!;
  return { ok: true, mime, ext };
}
