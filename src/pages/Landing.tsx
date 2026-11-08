import { Link, Navigate } from 'react-router-dom';
import { Clock, EyeOff, Lock, MessageCircle, Video, Timer } from 'lucide-react';
import { useAuth } from '../lib/auth';
import ThemeToggle from '../components/ThemeToggle';

const FEATURES = [
  { icon: Timer, title: 'Everything expires', text: 'Messages and photos are deleted from our servers within 24 hours. Expiry is enforced by the database, not just the app.' },
  { icon: EyeOff, title: 'You control your side', text: '“End chat” hides the conversation for you immediately. The other person is told, and the shared chat still expires for both within 24 hours.' },
  { icon: Lock, title: 'Invite-only', text: 'Nobody can message you unless you accept their invitation. We never reveal whether an email or phone number has an account.' },
  { icon: MessageCircle, title: 'Real-time chat', text: 'Typing indicators, delivery and read status, emoji, photo sharing and live camera capture.' },
  { icon: Video, title: 'Video & voice calls', text: 'Peer-to-peer WebRTC calls. Audio and video are never recorded or stored.' },
  { icon: Clock, title: 'Clear countdowns', text: 'See exactly how much time is left on every conversation.' },
];

export default function Landing() {
  const { session } = useAuth();
  if (session) return <Navigate to="/dashboard" replace />;
  return (
    <div className="min-h-full">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
        <span className="flex items-center gap-2 font-semibold"><span className="text-xl">🫥</span> LiveChat</span>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link to="/login" className="btn-ghost">Log in</Link>
          <Link to="/register" className="btn-primary">Get started</Link>
        </div>
      </header>

      <section className="mx-auto max-w-3xl px-4 pb-16 pt-14 text-center animate-slide-up">
        <p className="mb-4 inline-block rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 dark:bg-brand-900/30 dark:text-brand-200">Private · Temporary · One-to-one</p>
        <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">Conversations that <span className="bg-gradient-to-r from-brand-500 to-violet-500 bg-clip-text text-transparent">disappear</span>.</h1>
        <p className="mx-auto mt-5 max-w-xl text-lg text-slate-600 dark:text-slate-400">Chat, share photos and talk face-to-face with someone you invite. After 24 hours it is gone from our servers.</p>
        <div className="mt-8 flex justify-center gap-3">
          <Link to="/register" className="btn-primary !px-6 !py-3">Create an account</Link>
          <Link to="/login" className="btn-outline !px-6 !py-3">Log in</Link>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-4 px-4 pb-16 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, text }) => (
          <div key={title} className="card"><Icon className="h-6 w-6 text-brand-600" /><h3 className="mt-3 font-semibold">{title}</h3><p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{text}</p></div>
        ))}
      </section>

      <section className="mx-auto max-w-3xl px-4 pb-20">
        <div className="card">
          <h2 className="text-lg font-semibold">Honest privacy notes</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-600 dark:text-slate-400">
            <li>Traffic is encrypted in transit (HTTPS/WSS) and access is limited to the two participants by database rules.</li>
            <li><b>Messages are not end-to-end encrypted.</b> The service operator could technically read data that has not expired yet.</li>
            <li>A person you chat with can always screenshot, copy or save what you send. Expiry cannot undo that.</li>
            <li>Video and voice calls are peer-to-peer and are not recorded.</li>
          </ul>
        </div>
      </section>
      <footer className="pb-10 text-center text-xs text-slate-500">© {new Date().getFullYear()} LiveChat</footer>
    </div>
  );
}
