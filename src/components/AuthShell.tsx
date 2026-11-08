import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import ThemeToggle from './ThemeToggle';

export default function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4">
        <Link to="/" className="flex items-center gap-2 font-semibold"><span className="text-xl">🫥</span> LiveChat</Link>
        <ThemeToggle />
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 pb-16">
        <div className="card animate-slide-up !p-7">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </main>
    </div>
  );
}

export function MethodTabs({ value, onChange }: { value: 'email' | 'phone'; onChange: (v: 'email' | 'phone') => void }) {
  return (
    <div className="mb-4 grid grid-cols-2 rounded-xl bg-slate-100 p-1 text-sm dark:bg-slate-800">
      {(['email', 'phone'] as const).map((m) => (
        <button key={m} type="button" onClick={() => onChange(m)}
          className={`rounded-lg py-1.5 font-medium capitalize transition ${value === m ? 'bg-white shadow-sm dark:bg-slate-900' : 'text-slate-500'}`}>{m}</button>
      ))}
    </div>
  );
}
