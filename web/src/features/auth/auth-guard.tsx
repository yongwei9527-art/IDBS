import { useEffect } from 'react';
import { useAuth } from '../auth/use-auth';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { APP_PATHS } from '@/lib/app-paths';

function stripBasepath(pathname: string) {
  const value = String(pathname || '');
  if (value === '/v5') return '/';
  if (value.startsWith('/v5/')) return value.slice(3) || '/';
  return value || '/';
}

function buildPostLoginRedirect(pathname: string, search: string, hash: string) {
  const routePath = stripBasepath(pathname);
  if (!routePath || routePath === '/' || routePath === '/login' || routePath.startsWith('/login?') || routePath.startsWith('/login/')) {
    return APP_PATHS.devices;
  }
  return `${routePath}${search || ''}${hash || ''}`;
}

/**
 * Redirect unauthenticated users to login once.
 * Uses navigate() in an effect to avoid TanStack Router Navigate re-render loops (React #185).
 */
export function RequireAuth() {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!auth.isReady || auth.isLoggedIn) return;
    if (typeof window === 'undefined') return;

    const browserPath = window.location.pathname;
    const routePath = stripBasepath(browserPath);
    if (routePath === '/login' || routePath.startsWith('/login/') || routePath.startsWith('/login?')) return;

    const redirect = buildPostLoginRedirect(browserPath, window.location.search, window.location.hash);
    navigate({ to: APP_PATHS.login, search: { redirect }, replace: true } as any);
  }, [auth.isReady, auth.isLoggedIn, navigate, location.pathname, location.search, location.hash]);

  if (!auth.isReady) return null;
  if (auth.isLoggedIn) return null;
  return <div className="min-h-svh bg-background" aria-busy="true" />;
}
