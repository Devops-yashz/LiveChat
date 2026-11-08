import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { isConfigured } from './lib/supabase';
import { AuthProvider } from './lib/auth';
import { ThemeProvider } from './lib/theme';
import RequireAuth from './components/RequireAuth';
import Layout from './components/Layout';
import { PageLoader } from './components/ui';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Dashboard from './pages/Dashboard';
import Profile from './pages/Profile';
import Invite from './pages/Invite';
import Invitations from './pages/Invitations';
import PrivacySettings from './pages/PrivacySettings';
import AccountSettings from './pages/AccountSettings';

const Chat = lazy(() => import('./pages/Chat'));
const Call = lazy(() => import('./pages/Call'));

function Misconfigured() {
  return (
    <div className="mx-auto max-w-lg p-8">
      <h1 className="text-xl font-semibold">Supabase is not configured</h1>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
        Copy <code>.env.example</code> to <code>.env</code> and set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>
        (on Netlify: Site settings → Environment variables), then rebuild.
      </p>
    </div>
  );
}

export default function App() {
  if (!isConfigured) return <Misconfigured />;
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route element={<RequireAuth />}>
                <Route path="/call/:id" element={<Call />} />
                <Route element={<Layout />}>
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/chat/:id" element={<Chat />} />
                  <Route path="/invite" element={<Invite />} />
                  <Route path="/invitations" element={<Invitations />} />
                  <Route path="/profile" element={<Profile />} />
                  <Route path="/privacy" element={<PrivacySettings />} />
                  <Route path="/account" element={<AccountSettings />} />
                </Route>
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
