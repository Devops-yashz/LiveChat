export function iceServers(): RTCIceServer[] {
  const split = (s?: string) => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const list: RTCIceServer[] = [{ urls: split(import.meta.env.VITE_STUN_URLS ?? 'stun:stun.l.google.com:19302') }];
  const turn = split(import.meta.env.VITE_TURN_URL);
  if (turn.length) list.push({ urls: turn, username: import.meta.env.VITE_TURN_USERNAME, credential: import.meta.env.VITE_TURN_CREDENTIAL });
  return list;
}
