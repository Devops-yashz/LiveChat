import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';

export const Spinner = ({ className = '' }: { className?: string }) => <Loader2 className={`h-5 w-5 animate-spin text-brand-600 ${className}`} />;

export const PageLoader = () => (
  <div className="flex h-full min-h-[40vh] items-center justify-center"><Spinner className="h-7 w-7" /></div>
);

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-300 px-6 py-10 text-center dark:border-slate-700">
      {icon && <div className="text-slate-400">{icon}</div>}
      <p className="font-medium">{title}</p>
      {children && <div className="text-sm text-slate-500 dark:text-slate-400">{children}</div>}
    </div>
  );
}

export function Alert({ kind = 'info', children }: { kind?: 'info' | 'error' | 'success' | 'warn'; children: ReactNode }) {
  const styles = {
    info: 'bg-brand-50 text-brand-900 dark:bg-brand-900/30 dark:text-brand-100',
    error: 'bg-rose-50 text-rose-800 dark:bg-rose-900/30 dark:text-rose-200',
    success: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200',
    warn: 'bg-amber-50 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100',
  }[kind];
  return <div role={kind === 'error' ? 'alert' : 'status'} className={`rounded-xl px-4 py-3 text-sm ${styles}`}>{children}</div>;
}

export function Modal({ children, onClose, title }: { children: ReactNode; onClose?: () => void; title?: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 animate-fade-in sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}
           className="card w-full max-w-md animate-slide-up shadow-xl">
        {title && <h2 className="mb-3 text-lg font-semibold">{title}</h2>}
        {children}
      </div>
    </div>
  );
}
