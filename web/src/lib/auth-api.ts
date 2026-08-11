import { request, tokenStore } from './api';

export interface AuthBundle {
  access_token: string;
  refresh_token?: string;
  token_type: 'Bearer';
  expires_in: number;
  role: string;
  permissions: string[];
  user?: { id: string; name: string; password_reset_required?: boolean; [k: string]: unknown };
}

export interface Me {
  id: string;
  name: string;
  role: string;
  permissions?: string[];
  password_reset_required?: boolean;
  [k: string]: unknown;
}

async function loginUser(phone: string, password: string): Promise<AuthBundle> {
  const data = await request<AuthBundle>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ phone, password })
  });
  tokenStore.set(data.access_token);
  return data;
}

export interface RegisterPayload {
  name: string;
  student_no: string;
  phone: string;
  major: string;
  mentor_name: string;
  password: string;
  approval_code?: string;
}

export interface RegisterPendingResult {
  message: string;
  need_review: true;
  status: 'pending';
}

export interface PasswordResetRequestPayload {
  phone: string;
  name: string;
  student_no: string;
  major?: string;
  mentor_name: string;
  reason?: string;
}

async function registerUser(payload: RegisterPayload): Promise<AuthBundle | RegisterPendingResult> {
  const data = await request<AuthBundle | RegisterPendingResult>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  return storeBundleIfPresent(data);
}

async function completeRequiredPasswordReset(currentPassword: string, newPassword: string): Promise<{ message: string }> {
  return request<{ message: string }>('/auth/password-reset/complete', {
    method: 'POST',
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword })
  });
}

async function requestPasswordReset(payload: PasswordResetRequestPayload): Promise<{ message: string }> {
  return request<{ message: string }>('/auth/password-reset/request', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export interface WechatChallenge {
  code: string;
  expire_minutes?: number;
  hourly_limit?: number;
  tips?: string;
}

export interface WechatStatus {
  logged_in?: boolean;
  need_bind?: boolean;
  status?: string;
  temp_code?: string;
  openid_masked?: string;
  nickname?: string;
  expire_at?: string;
  message?: string;
}

export interface WechatBindResult {
  message?: string;
  need_review?: boolean;
  user?: AuthBundle['user'];
}

function isAuthBundle(data: unknown): data is AuthBundle {
  return Boolean(data && typeof data === 'object' && 'access_token' in data);
}

function storeBundleIfPresent<T>(data: T): T {
  if (isAuthBundle(data)) {
    tokenStore.set(data.access_token);
  }
  return data;
}

async function createWechatChallenge(): Promise<WechatChallenge> {
  return request<WechatChallenge>('/auth/wechat/challenge');
}

async function getWechatStatus(code: string): Promise<WechatStatus | AuthBundle> {
  const data = await request<WechatStatus | AuthBundle>(`/auth/wechat/status?code=${encodeURIComponent(code)}`);
  return storeBundleIfPresent(data);
}

async function bindWechatAccount(payload: { temp_code: string; name: string; student_no: string; phone: string }): Promise<WechatBindResult | AuthBundle> {
  const data = await request<WechatBindResult | AuthBundle>('/auth/wechat/bind', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  return storeBundleIfPresent(data);
}

async function refreshToken(): Promise<string | null> {
  const data = await request<{ access_token: string }>('/auth/refresh', {
    method: 'POST',
    body: '{}'
  });
  if (!data.access_token) return null;
  tokenStore.set(data.access_token);
  return data.access_token;
}

function logout(): void {
  const accessToken = tokenStore.get() || undefined;
  tokenStore.clear();
  // 通知后端退出登录；失败不阻塞前端清理。
  void request('/auth/logout', { method: 'POST', token: accessToken }).catch(() => {});
}

async function getMe(): Promise<Me> {
  return request<Me>('/me');
}

export const authApi = {
  loginUser,
  registerUser,
  requestPasswordReset,
  completeRequiredPasswordReset,
  createWechatChallenge,
  getWechatStatus,
  bindWechatAccount,
  refreshToken,
  getMe,
  logout
};
