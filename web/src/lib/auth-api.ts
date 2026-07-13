import { request, tokenStore } from './api';

export interface AuthBundle {
  access_token: string;
  refresh_token?: string;
  token_type: 'Bearer';
  expires_in: number;
  role: string;
  permissions: string[];
  user?: { id: string; name: string; [k: string]: unknown };
}

export interface Me {
  id: string;
  name: string;
  role: string;
  permissions?: string[];
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
  try {
    const data = await request<{ access_token: string }>('/auth/refresh', {
      method: 'POST',
      body: '{}'
    });
    tokenStore.set(data.access_token);
    return data.access_token;
  } catch {
    tokenStore.clear();
    return null;
  }
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
  createWechatChallenge,
  getWechatStatus,
  bindWechatAccount,
  refreshToken,
  getMe,
  logout
};
