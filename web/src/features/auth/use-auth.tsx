import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import {
  authApi,
  type AuthBundle,
  type Me,
  type RegisterPayload,
  type RegisterPendingResult
} from '@/lib/auth-api';
import { tokenStore, type ApiError } from '@/lib/api';

interface AuthState {
  me: Me | null;
  role: string | null;
  permissions: string[];
  passwordResetRequired: boolean;
  isLoggedIn: boolean;
  isReady: boolean;
  loginUser: (phone: string, password: string) => Promise<AuthBundle>;
  registerUser: (payload: RegisterPayload) => Promise<AuthBundle | RegisterPendingResult>;
  completeRequiredPasswordReset: (currentPassword: string, newPassword: string) => Promise<void>;
  logout: () => void;
  hasPerm: (p: string) => boolean;
  refresh: () => Promise<void>;
}

const AuthCtx = createContext<AuthState | null>(null);

function decodeTokenMe(token: string | null): Me | null {
  if (!token) return null;
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
    const json = decodeURIComponent(
      Array.from(atob(padded), (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
    );
    const data = JSON.parse(json) as {
      sub?: string;
      name?: string;
      role?: string;
      perms?: string[];
      password_reset_required?: boolean;
    };
    if (!data.sub || !data.role) return null;
    return {
      id: data.sub,
      name: data.name || '用户',
      role: data.role,
      permissions: Array.isArray(data.perms) ? data.perms : [],
      password_reset_required: data.password_reset_required === true
    };
  } catch {
    return null;
  }
}

function isAuthExpiredError(error: unknown) {
  return typeof error === 'object' && error !== null && (error as ApiError).status === 401;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [isReady, setIsReady] = useState(false);

  const refresh = useCallback(async () => {
    let token = tokenStore.get();
    try {
      if (!token) token = await authApi.refreshToken();
      if (!token) {
        setMe(null);
        return;
      }
      const m = await authApi.getMe();
      setMe(m);
    } catch (error) {
      if (isAuthExpiredError(error)) {
        setMe(null);
      } else {
        const fallback = decodeTokenMe(tokenStore.get() || token);
        setMe((prev) => prev ?? fallback);
      }
    } finally {
      setIsReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    const onPasswordResetRequired = () => void refresh();
    window.addEventListener('laboratory-management-system:password-reset-required', onPasswordResetRequired);
    return () => window.removeEventListener('laboratory-management-system:password-reset-required', onPasswordResetRequired);
  }, [refresh]);
  const loginUser = useCallback(async (phone: string, password: string) => {
    const bundle = await authApi.loginUser(phone, password);
    await refresh();
    return bundle;
  }, [refresh]);
  const registerUser = useCallback(async (payload: RegisterPayload) => {
    const result = await authApi.registerUser(payload);
    if ('access_token' in result) await refresh();
    return result;
  }, [refresh]);

  const completeRequiredPasswordReset = useCallback(async (currentPassword: string, newPassword: string) => {
    await authApi.completeRequiredPasswordReset(currentPassword, newPassword);
    tokenStore.clear();
    setMe(null);
    setIsReady(true);
  }, []);

  const logout = useCallback(() => {
    authApi.logout();
    setMe(null);
    setIsReady(true);
  }, []);

  const permissions = (me?.permissions ?? []) as string[];
  const role = me?.role ?? null;
  const hasPerm = useCallback((p: string) => {
    if (role === 'super_admin' || permissions.includes('*')) return true;
    return permissions.includes(p);
  }, [role, permissions]);

  const state: AuthState = {
    me,
    role,
    permissions,
    passwordResetRequired: me?.password_reset_required === true,
    isLoggedIn: !!me,
    isReady,
    loginUser,
    registerUser,
    completeRequiredPasswordReset,
    logout,
    hasPerm,
    refresh
  };
  return <AuthCtx.Provider value={state}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
