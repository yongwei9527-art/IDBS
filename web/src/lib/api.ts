interface ApiOptions extends RequestInit {
  token?: string;
}

const API_BASE_PATH = '/api/v5';
const API_ORIGIN_STORAGE_KEY = 'laboratory-management-system.api_origin';

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

function isLocalHostOrIp(host: string) {
  const h = host.toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h === '::1') return true;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(h)) return true;
  if (h.endsWith('.local')) return true;
  return false;
}

export function normalizeApiOrigin(value?: string | null): string {
  let raw = String(value || '').trim();
  if (!raw) return '';
  raw = raw.replace(/\s+/g, '');
  if (!/^https?:\/\//i.test(raw)) {
    const hostPart = raw.split('/')[0] || '';
    const hostOnly = hostPart.split(':')[0] || '';
    const scheme = isLocalHostOrIp(hostOnly) ? 'http' : 'https';
    raw = scheme + '://' + raw;
  }
  try {
    return stripTrailingSlash(new URL(raw).origin);
  } catch {
    return stripTrailingSlash(raw.replace(/\/api\/v5\/?$/i, ''));
  }
}

function normalizeApiBase(value?: string | null) {
  const origin = normalizeApiOrigin(value);
  if (!origin) return API_BASE_PATH;
  return origin.endsWith(API_BASE_PATH) ? origin : origin + API_BASE_PATH;
}

function readStoredApiOrigin(): string {
  if (typeof localStorage === 'undefined') return '';
  try {
    return normalizeApiOrigin(localStorage.getItem(API_ORIGIN_STORAGE_KEY));
  } catch {
    return '';
  }
}

function readBuildApiOrigin(): string {
  return normalizeApiOrigin(import.meta.env.VITE_API_ORIGIN);
}

function usesUsbViteProxy(): boolean {
  return typeof window !== 'undefined'
    && import.meta.env.DEV
    && window.location.origin === 'http://127.0.0.1:5173';
}

export function getApiOrigin(): string {
  if (usesUsbViteProxy()) return '';
  // A user-selected server takes precedence. The build-time value remains a
  // safe fallback for managed offline APKs that have not opened the hidden
  // server setting yet.
  return readStoredApiOrigin() || readBuildApiOrigin();
}

export function getApiBase(): string {
  return normalizeApiBase(getApiOrigin());
}

export function saveApiOrigin(value: string): string {
  const origin = normalizeApiOrigin(value);
  if (typeof localStorage !== 'undefined') {
    if (origin) localStorage.setItem(API_ORIGIN_STORAGE_KEY, origin);
    else localStorage.removeItem(API_ORIGIN_STORAGE_KEY);
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('laboratory-management-system:api-origin-changed', { detail: { origin } }));
  }
  return origin;
}

export function clearApiOrigin() {
  saveApiOrigin('');
}

/** Compatibility snapshot; prefer getApiBase() for runtime-updated values. */
export const API_BASE = getApiBase();

function notifyAuthChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('laboratory-management-system:auth-changed'));
}

const tokenStore = {
  get(): string | null {
    return localStorage.getItem('laboratory-management-system.access_token');
  },
  set(v: string) {
    localStorage.setItem('laboratory-management-system.access_token', v);
    notifyAuthChanged();
  },
  clear() {
    localStorage.removeItem('laboratory-management-system.access_token');
    localStorage.removeItem('laboratory-management-system.refresh_token');
    notifyAuthChanged();
  }
};

export { tokenStore, API_ORIGIN_STORAGE_KEY };

export interface ApiError extends Error {
  status: number;
  code?: number;
  payload?: unknown;
}

function normalizeApiBodyMessage(body: any): string {
  if (!body) return '';
  if (typeof body === 'string') return body;
  return String(body.message || body.title || body.error || '').trim();
}

function hasChinese(text: string) {
  return /[\u4e00-\u9fa5]/.test(text);
}

function englishHint(text: string) {
  const lower = text.toLowerCase();
  if (/failed to fetch|networkerror|load failed|network request failed|econnt?refused|econnreset|etimedout/.test(lower)) return '网络连接异常，请确认服务已启动后重试。';
  if (/invalid json|unexpected token|json/.test(lower)) return '提交内容格式不正确，请检查后重试。';
  if (/file is required|missing file/.test(lower)) return '请选择需要上传的文件。';
  if (/only image|allowed image|content does not match|unsupported file/.test(lower)) return '仅支持上传真实图片文件（JPG、PNG、WebP、GIF）。';
  if (/cannot read|undefined|null|typeerror|referenceerror/.test(lower)) return '页面处理数据时遇到异常，请刷新后重试；如果仍失败请联系管理员。';
  if (/required|missing|must be|invalid|not valid/.test(lower)) return '提交内容不完整或格式不正确，请补全后重试。';
  if (/unauthorized|jwt|token/.test(lower)) return '登录已失效，请重新登录。';
  if (/eperm|eacces|operation not permitted|access is denied/.test(lower)) return '文件目录没有写入权限，请检查上传目录配置。';
  if (/forbidden|not allowed|permission|denied/.test(lower)) return '当前账号没有权限执行该操作。';
  if (/duplicate|conflict|already exists/.test(lower)) return '当前数据已存在或状态冲突，请检查后重试。';
  if (/internal server error|server error|database|sql|postgres|prisma/.test(lower)) return '服务器暂时无法处理请求，请稍后再试。';
  return '';
}

export function friendlyApiMessage(status: number, raw?: string): string {
  const text = String(raw || '').trim();
  const hinted = englishHint(text);
  if (hinted) return hinted;
  if (status === 0) return '网络连接异常，请确认服务已启动后重试。';
  if (status === 400) return hasChinese(text) ? text : '提交内容不完整或格式不正确，请补全后重试。';
  if (status === 401) return hasChinese(text) ? text : '登录已失效，请重新登录。';
  if (status === 403) return hasChinese(text) ? text : '当前账号没有权限执行该操作。';
  if (status === 404) return '请求的资源不存在或已被删除。';
  if (status === 409) return hasChinese(text) ? text : '当前状态不允许执行该操作，请刷新后重试。';
  if (status === 413) return '上传或提交内容过大，请压缩后重试。';
  if (status === 422) return hasChinese(text) ? text : '提交内容校验未通过，请补全必填项。';
  if (status === 429) return '操作过于频繁，请稍后再试。';
  if (status >= 500) return '服务器暂时无法处理请求，请稍后再试。';
  return hasChinese(text) ? text : '请求失败（' + (status || '网络') + '），请稍后重试。';
}

function createApiError(status: number, raw: string, payload?: unknown): ApiError {
  const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  return Object.assign(new Error(friendlyApiMessage(status, raw)), {
    status,
    code: typeof body.code === 'number' ? body.code : undefined,
    payload
  });
}

function requestCredentials(): RequestCredentials {
  return 'include';
}

export async function request<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  return doRequest<T>(path, options, true);
}

export async function uploadImage(file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  const accessToken = tokenStore.get();
  let res: Response;
  try {
    res = await fetch(getApiBase() + '/upload', {
      method: 'POST',
      credentials: requestCredentials(),
      headers: {
        ...(accessToken ? { Authorization: 'Bearer ' + accessToken } : {})
      },
      body: form
    });
  } catch (error) {
    throw createApiError(0, error instanceof Error ? error.message : String(error));
  }

  const body = await res.json().catch(() => null);
  if (!res.ok) throw createApiError(res.status, normalizeApiBodyMessage(body), body);
  return body?.url || body?.data?.url || '';
}

export async function downloadAuthenticatedFile(path: string, filename: string) {
  async function fetchFile(allowRefresh: boolean): Promise<Response> {
    const accessToken = tokenStore.get();
    let response: Response;
    try {
      response = await fetch(getApiBase() + path, {
        credentials: requestCredentials(),
        headers: accessToken ? { Authorization: 'Bearer ' + accessToken } : {}
      });
    } catch (error) {
      throw createApiError(0, error instanceof Error ? error.message : String(error));
    }
    if (response.status === 401 && allowRefresh) {
      const newToken = await refreshTokenOnly();
      if (newToken) return fetchFile(false);
    }
    if (!response.ok) {
      if (response.status === 401 && !allowRefresh) tokenStore.clear();
      const body = await response.json().catch(() => null);
      throw createApiError(response.status, normalizeApiBodyMessage(body), body);
    }
    return response;
  }

  const response = await fetchFile(true);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename || 'download';
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function doRequest<T>(path: string, options: ApiOptions, allowRefresh: boolean): Promise<T> {
  const { token, headers, ...rest } = options;
  const accessToken = token ?? tokenStore.get();
  let res: Response;
  try {
    res = await fetch(getApiBase() + path, {
      ...rest,
      cache: rest.cache ?? 'no-store',
      credentials: rest.credentials ?? requestCredentials(),
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: 'Bearer ' + accessToken } : {}),
        ...headers
      }
    });
  } catch (error) {
    throw createApiError(0, error instanceof Error ? error.message : String(error));
  }

  let body: any = null;
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) body = await res.json();
  else if (ct.includes('text/')) body = await res.text();

  if (!res.ok) {
    if (res.status === 403 && Number(body?.code) === 1005 && typeof window !== 'undefined') {
      window.dispatchEvent(new Event('laboratory-management-system:password-reset-required'));
    }
    if (res.status === 401 && allowRefresh && !path.startsWith('/auth/')) {
      const newToken = await refreshTokenOnly();
      if (newToken) return doRequest<T>(path, options, false);
    }
    const finalProtected401 = res.status === 401 && !allowRefresh && !path.startsWith('/auth/');
    const invalidRefresh401 = res.status === 401 && path === '/auth/refresh';
    if (finalProtected401 || invalidRefresh401) tokenStore.clear();
    throw createApiError(res.status, normalizeApiBodyMessage(body), body);
  }

  if (body && typeof body === 'object' && 'data' in body) return body.data as T;
  return body as T;
}

let _refreshing: Promise<string | null> | null = null;
async function refreshTokenOnly(): Promise<string | null> {
  if (_refreshing) return _refreshing;
  _refreshing = (async () => {
    let response: Response;
    try {
      response = await fetch(getApiBase() + '/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: requestCredentials(),
        body: '{}'
      });
    } catch (error) {
      throw createApiError(0, error instanceof Error ? error.message : String(error));
    }
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401) tokenStore.clear();
      throw createApiError(response.status, normalizeApiBodyMessage(body), body);
    }
    const token = body?.data?.access_token ?? body?.access_token;
    if (!token) throw createApiError(502, 'Refresh response did not include an access token.', body);
    tokenStore.set(token);
    return token;
  })().finally(() => {
    _refreshing = null;
  });
  return _refreshing;
}
