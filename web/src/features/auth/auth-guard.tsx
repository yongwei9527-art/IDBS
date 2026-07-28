import { useEffect } from 'react';
import { useAuth } from '../auth/use-auth';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { APP_PATHS } from '@/lib/app-paths';

type AuthRouteStatusProps = {
  message: string;
  mode: 'loading' | 'redirecting';
};

export function AuthRouteStatus({ message, mode }: AuthRouteStatusProps) {
  return (
    <main
      className="flex min-h-svh items-center justify-center bg-background p-6 text-foreground"
      role="status"
      aria-live="polite"
      data-route-status={mode}
    >
      <div className="w-full max-w-sm rounded-[var(--radius-lg)] border bg-card p-6 text-center shadow-sm">
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-primary/25 border-t-primary" aria-hidden="true" />
        <p className="text-sm font-medium">{message}</p>
      </div>
    </main>
  );
}

export function RedirectWithStatus({ to, message }: { to: string; message: string }) {
  const navigate = useNavigate();

  useEffect(() => {
    void navigate({ to: to as any, replace: true });
  }, [navigate, to]);

  return <AuthRouteStatus mode="redirecting" message={message} />;
}

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

  if (!auth.isReady) {
    return <AuthRouteStatus mode="loading" message="正在验证登录状态…" />;
  }
  if (auth.isLoggedIn) return null;
  return <AuthRouteStatus mode="redirecting" message="登录状态已失效，正在前往登录页…" />;
}
