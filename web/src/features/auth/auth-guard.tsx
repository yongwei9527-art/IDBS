import { useAuth } from '../auth/use-auth';
import { useLocation } from '@tanstack/react-router';
import { Navigate } from '@tanstack/react-router';

export function RequireAuth() {
  const auth = useAuth();
  const location = useLocation();
  if (!auth.isReady) return null;
  if (!auth.isLoggedIn) {
    const search = typeof window === 'undefined' ? '' : window.location.search;
    const hash = typeof window === 'undefined' ? '' : window.location.hash;
    const redirect = `${location.pathname}${search}${hash}`;
    return <Navigate to="/login" search={{ redirect }} />;
  }
  return null;
}
