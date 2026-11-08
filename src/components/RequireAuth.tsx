import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { PageLoader } from './ui';

export default function RequireAuth() {
  const { session, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <PageLoader />;
  if (!session) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  return <Outlet />;
}
