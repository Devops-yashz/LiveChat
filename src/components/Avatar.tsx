import { useSignedUrl } from '../lib/storage';

export default function Avatar({ path, name, size = 40, online }: { path?: string | null; name: string; size?: number; online?: boolean }) {
  const url = useSignedUrl('avatars', path);
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      {url ? (
        <img src={url} alt="" className="h-full w-full rounded-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-brand-700 font-semibold text-white"
              style={{ fontSize: size * 0.4 }}>{name.slice(0, 1).toUpperCase()}</span>
      )}
      {online !== undefined && (
        <span className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white dark:border-slate-900 ${online ? 'bg-emerald-500' : 'bg-slate-400'}`}
              title={online ? 'Online' : 'Offline'} />
      )}
    </span>
  );
}
