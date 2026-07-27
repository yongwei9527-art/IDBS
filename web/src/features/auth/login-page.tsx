import { useState, type FormEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from './use-auth';
import './login-page.css';
import { APP_PATHS } from '@/lib/app-paths';
import { getApiOrigin, normalizeApiOrigin, saveApiOrigin } from '@/lib/api';

const copy = {
  systemName: "实验室设备预约系统",
  title: "账号登录",
  server: "服务器地址",
  serverPlaceholder: "rent.example.com 或 服务器公网IP",
  serverHint: "有域名：填域名，自动使用 HTTPS；无域名：填公网/局域网 IP，自动使用 HTTP。",
  serverPreview: "实际连接",
  phone: "手机号",
  phonePlaceholder: "请输入手机号",
  password: "密码",
  passwordPlaceholder: "请输入密码",
  submit: "登 录",
  submitting: "登录中…",
  loginFailed: "登录失败，请检查账号信息后重试。",
  requestFailed: "操作失败，请稍后重试。",
  networkFailed: "无法连接服务，请确认服务器地址正确且系统已启动。",
  invalidCredentials: "手机号或密码不正确，请核对后重试。",
  forbidden: "当前账号没有访问权限，请联系管理员。",
  timeout: "请求超时，请检查网络后重试。",
  passwordTooShort: "密码至少需要 6 位。",
  serverRequired: "请填写服务器地址（域名或 IP）。"
} as const;

function safeRedirectTarget(raw: string | null) {
  let target = String(raw || '').trim();
  if (!target) return '';
  try {
    target = decodeURIComponent(target);
  } catch {
    // keep original when not URI-encoded
  }
  if (target === '/v5' || target === '/v5/') return APP_PATHS.devices;
  if (target.startsWith('/v5/')) target = target.slice(3) || '/';
  if (!target.startsWith('/') || target.startsWith('//')) return '';
  if (target === '/login' || target.startsWith('/login?') || target.startsWith('/login/')) return '';
  return target;
}

function getLoginRedirect() {
  if (typeof window === 'undefined') return '';
  return safeRedirectTarget(new URLSearchParams(window.location.search).get('redirect'));
}

function toChineseError(err: unknown, fallback: string = copy.requestFailed) {
  const raw = err instanceof Error ? err.message : String(err || '');
  if (!raw) return fallback;
  const lower = raw.toLowerCase();
  if (lower.includes('failed to fetch') || lower.includes('networkerror')) return copy.networkFailed;
  if (raw.includes("密码至少需要") || lower.includes('at least 6')) return copy.passwordTooShort;
  if (raw.includes("手机号或密码不正确")) return copy.invalidCredentials;
  if (raw.includes("封禁") || raw.includes("审核未通过") || raw.includes("没有访问权限")) return raw;
  if (lower.includes('unauthorized') || lower.includes('invalid credentials')) return copy.invalidCredentials;
  if (lower.includes('forbidden') || lower.includes('permission')) return copy.forbidden;
  if (lower.includes('timeout')) return copy.timeout;
  if (/^[\x00-\x7F]+$/.test(raw)) return fallback;
  return raw;
}

function needsServerAddress() {
  if (typeof window === 'undefined') return false;
  const cap = (window as any).Capacitor;
  if (cap?.isNativePlatform?.()) return true;
  if (window.location.protocol === 'capacitor:') return true;
  if (window.location.protocol === 'https:' && window.location.hostname === 'localhost' && !window.location.port) return true;
  return Boolean(getApiOrigin());
}

export function LoginPage() {
  const navigate = useNavigate();
  const auth = useAuth();
  const [server, setServer] = useState(() => getApiOrigin().replace(/^https?:\/\//i, ''));
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const normalizedServer = normalizeApiOrigin(server);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.trim().length < 6) {
      setError(copy.passwordTooShort);
      return;
    }

    const origin = normalizeApiOrigin(server);
    if (needsServerAddress() && !origin) {
      setError(copy.serverRequired);
      return;
    }
    if (server.trim()) {
      saveApiOrigin(server);
    }

    setLoading(true);
    try {
      await auth.loginUser(phone, password);
      navigate({ to: getLoginRedirect() || APP_PATHS.devices, replace: true } as any);
    } catch (err) {
      setError(toChineseError(err, copy.loginFailed));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-shell">
      <div className="login-card">
        <div className="login-brand-row">
          <div className="login-logo" aria-hidden="true">实</div>
          <div>
            <h1>{copy.systemName}</h1>
            <p>设备预约 / 借还管理 / 运维协同</p>
          </div>
        </div>

        <div className="login-divider" />

        <h2 className="login-title">{copy.title}</h2>

        <form onSubmit={onSubmit} className="login-form">
          <label className="login-field" htmlFor="login-server">
            <span>{copy.server}</span>
            <Input
              id="login-server"
              value={server}
              onChange={(event) => setServer(event.target.value)}
              placeholder={copy.serverPlaceholder}
              autoComplete="url"
              inputMode="url"
              className="login-input"
            />
            <small className="login-field-hint">{copy.serverHint}</small>
            {server.trim() && normalizedServer ? <small className="login-field-hint">{copy.serverPreview}：{normalizedServer}</small> : null}
          </label>

          <label className="login-field" htmlFor="login-phone">
            <span>{copy.phone}</span>
            <Input
              id="login-phone"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder={copy.phonePlaceholder}
              autoComplete="tel"
              inputMode="tel"
              required
              className="login-input"
            />
          </label>

          <label className="login-field" htmlFor="login-password">
            <span>{copy.password}</span>
            <Input
              id="login-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={copy.passwordPlaceholder}
              autoComplete="current-password"
              required
              className="login-input"
            />
          </label>

          {error ? <p className="login-error" role="alert">{error}</p> : null}

          <Button type="submit" disabled={loading} className="login-submit">
            {loading ? copy.submitting : copy.submit}
          </Button>
        </form>

        <p className="login-tip">仅限授权账号使用，如需开通请联系管理员</p>
      </div>
    </main>
  );
}
