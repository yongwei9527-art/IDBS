import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from './use-auth';
import { AuthRouteStatus } from './auth-guard';
import './login-page.css';
import { APP_PATHS } from '@/lib/app-paths';
import { getApiOrigin, normalizeApiOrigin, saveApiOrigin } from '@/lib/api';
import { consumeNativePendingPairing, pairFromLink, restoreNativeServerConfiguration } from '@/lib/app-pairing';

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

const extraCopy = {
  accountRequired: '\u8bf7\u8f93\u5165\u624b\u673a\u53f7\u548c\u5bc6\u7801\u3002',
  revealServer: '\u8d26\u53f7\u548c\u5bc6\u7801\u5747\u4e3a\u7a7a\u65f6\uff0c\u8fde\u7eed\u70b9\u51fb\u4e09\u6b21\u767b\u5f55\u53ef\u4fee\u6539\u670d\u52a1\u5668\u5730\u5740\u3002',
  confirmServer: '\u786e\u8ba4\u5e76\u4fdd\u5b58',
  serverSaved: '\u670d\u52a1\u5668\u5730\u5740\u5df2\u4fdd\u5b58\uff0c\u4e0b\u6b21\u6253\u5f00\u4ecd\u4f1a\u4f7f\u7528\u8be5\u5730\u5740\u3002',
  sessionHint: '\u767b\u5f55\u72b6\u6001\u4f1a\u5b89\u5168\u4fdd\u7559\uff1b\u7cfb\u7edf\u4e0d\u4f1a\u4fdd\u5b58\u60a8\u8f93\u5165\u7684\u660e\u6587\u5bc6\u7801\u3002',
  pairingLink: '\u7c98\u8d34 App \u670d\u52a1\u5668\u914d\u5bf9\u94fe\u63a5',
  pairingPlaceholder: 'labapp://pair?v=1&server=https%3A%2F%2Fexample.com&token=...',
  pairingAction: '\u914d\u5bf9\u5e76\u4fdd\u5b58\u670d\u52a1\u5668',
  pairingRequired: '\u8bf7\u7c98\u8d34\u4ece\u4e0b\u8f7d\u9875\u6216\u4e8c\u7ef4\u7801\u83b7\u5f97\u7684 App \u914d\u5bf9\u94fe\u63a5\u3002',
  pairingSaved: '\u670d\u52a1\u5668\u5df2\u5b89\u5168\u914d\u5bf9\u5e76\u4fdd\u5b58\uff0c\u8bf7\u4f7f\u7528\u60a8\u81ea\u5df1\u7684\u8d26\u53f7\u548c\u5bc6\u7801\u767b\u5f55\u3002',
  pairingRestored: '\u5df2\u6062\u590d\u5df2\u4fdd\u5b58\u7684\u670d\u52a1\u5668\u5730\u5740\uff0c\u8bf7\u4f7f\u7528\u60a8\u81ea\u5df1\u7684\u8d26\u53f7\u548c\u5bc6\u7801\u767b\u5f55\u3002',
  pairingFailed: '\u914d\u5bf9\u94fe\u63a5\u65e0\u6548\u3001\u5df2\u8fc7\u671f\u6216\u4e0d\u5c5e\u4e8e\u5f53\u524d\u670d\u52a1\u5668\uff0c\u8bf7\u5237\u65b0\u4e0b\u8f7d\u9875\u540e\u91cd\u8bd5\u3002'
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
  if (Array.from(raw).every((character) => character.charCodeAt(0) <= 0x7f)) return fallback;
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
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [registration, setRegistration] = useState({
    name: '',
    student_no: '',
    phone: '',
    major: '',
    mentor_name: '',
    password: '',
    approval_code: ''
  });
  const [registrationConfirmation, setRegistrationConfirmation] = useState('');
  const [showServerEditor, setShowServerEditor] = useState(false);
  const [serverStatus, setServerStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pairingLink, setPairingLink] = useState('');
  const [pairingLoading, setPairingLoading] = useState(false);
  const blankSubmitGesture = useRef({ count: 0, lastAt: 0 });
  const normalizedServer = normalizeApiOrigin(server);

  useEffect(() => {
    if (!auth.isReady || !auth.isLoggedIn) return;
    void navigate({
      to: auth.passwordResetRequired
        ? APP_PATHS.passwordResetRequired
        : (getLoginRedirect() || APP_PATHS.devices),
      replace: true
    } as any);
  }, [auth.isReady, auth.isLoggedIn, auth.passwordResetRequired, navigate]);

  useEffect(() => {
    let cancelled = false;

    async function restoreAppPairing() {
      try {
        const paired = await consumeNativePendingPairing();
        if (paired) {
          if (!cancelled) {
            setServer(paired.server_url.replace(/^https?:\/\//i, ''));
            setServerStatus(extraCopy.pairingSaved);
          }
          return;
        }

        const restoredServer = await restoreNativeServerConfiguration();
        if (restoredServer && !cancelled) {
          setServer(restoredServer.replace(/^https?:\/\//i, ''));
          setServerStatus(extraCopy.pairingRestored);
        }
      } catch {
        if (!cancelled) setError(extraCopy.pairingFailed);
      }
    }

    void restoreAppPairing();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handlePairing() {
    const rawLink = pairingLink.trim();
    if (!rawLink) {
      setError(extraCopy.pairingRequired);
      return;
    }

    setError(null);
    setServerStatus(null);
    setPairingLoading(true);
    try {
      const config = await pairFromLink(rawLink);
      setServer(config.server_url.replace(/^https?:\/\//i, ''));
      setPairingLink('');
      setServerStatus(extraCopy.pairingSaved);
    } catch {
      setError(extraCopy.pairingFailed);
    } finally {
      setPairingLoading(false);
    }
  }
  function handleBlankLoginGesture() {
    const now = Date.now();
    const previous = blankSubmitGesture.current;
    const count = now - previous.lastAt <= 2500 ? previous.count + 1 : 1;
    blankSubmitGesture.current = { count, lastAt: now };
    if (count >= 3) {
      blankSubmitGesture.current = { count: 0, lastAt: 0 };
      setShowServerEditor(true);
      setServerStatus(null);
    }
  }

  function confirmServer() {
    setError(null);
    const origin = normalizeApiOrigin(server);
    if (!origin) {
      setError(copy.serverRequired);
      return;
    }
    saveApiOrigin(server);
    setServer(origin.replace(/^https?:\/\//i, ''));
    setServerStatus(extraCopy.serverSaved);
    setShowServerEditor(false);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setServerStatus(null);
    const trimmedPhone = phone.trim();
    if (!trimmedPhone && !password) {
      handleBlankLoginGesture();
      return;
    }
    blankSubmitGesture.current = { count: 0, lastAt: 0 };
    if (!trimmedPhone || !password) {
      setError(extraCopy.accountRequired);
      return;
    }
    if (password.trim().length < 6) {
      setError(copy.passwordTooShort);
      return;
    }

    const origin = normalizeApiOrigin(server);
    if (needsServerAddress() && !origin) {
      setError(`${copy.serverRequired}${extraCopy.revealServer}`);
      return;
    }

    setLoading(true);
    try {
      const bundle = await auth.loginUser(phone, password);
      navigate({
        to: bundle.user?.password_reset_required
          ? APP_PATHS.passwordResetRequired
          : (getLoginRedirect() || APP_PATHS.devices),
        replace: true
      } as any);
    } catch (err) {
      setError(toChineseError(err, copy.loginFailed));
    } finally {
      setLoading(false);
    }
  }

  function updateRegistration(field: keyof typeof registration, value: string) {
    setRegistration((current) => ({ ...current, [field]: value }));
  }

  async function onRegisterSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setServerStatus(null);
    const required = [
      registration.name,
      registration.student_no,
      registration.phone,
      registration.major,
      registration.mentor_name,
      registration.password
    ];
    if (required.some((value) => !value.trim())) {
      setError('请完整填写姓名、学号、手机号、专业、导师姓名和密码。');
      return;
    }
    if (registration.password.length < 12 || registration.password.length > 128) {
      setError('注册密码必须为 12–128 位。');
      return;
    }
    if (registration.password !== registrationConfirmation) {
      setError('两次输入的密码不一致。');
      return;
    }
    const origin = normalizeApiOrigin(server);
    if (needsServerAddress() && !origin) {
      setError(`${copy.serverRequired}${extraCopy.revealServer}`);
      return;
    }

    setLoading(true);
    try {
      const result = await auth.registerUser({
        ...registration,
        phone: registration.phone.trim(),
        approval_code: registration.approval_code.trim().toUpperCase()
      });
      setRegistration((current) => ({ ...current, password: '', approval_code: '' }));
      setRegistrationConfirmation('');
      if ('access_token' in result) {
        await navigate({ to: APP_PATHS.devices, replace: true } as any);
      } else {
        setPhone(registration.phone.trim());
        setMode('login');
        setServerStatus(result.message);
      }
    } catch (requestError) {
      setError(toChineseError(requestError, '注册失败，请检查填写内容后重试。'));
    } finally {
      setLoading(false);
    }
  }

  if (!auth.isReady || auth.isLoggedIn) {
    return (
      <AuthRouteStatus
        mode={auth.isLoggedIn ? 'redirecting' : 'loading'}
        message={auth.isLoggedIn
          ? (auth.passwordResetRequired ? '账号需要设置新密码，正在进入安全页面…' : '登录状态已恢复，正在进入系统…')
          : '正在恢复登录状态…'}
      />
    );
  }

  return (
    <main className="login-shell">
      <div className={`login-card ${mode === 'register' ? 'login-card--register' : ''}`}>
        <div className="login-brand-row">
          <div className="login-logo" aria-hidden="true">实</div>
          <div>
            <h1>{copy.systemName}</h1>
            <p>设备预约 / 借还管理 / 运维协同</p>
          </div>
        </div>

        <div className="login-divider" />

        <h2 className="login-title">{mode === 'login' ? copy.title : '注册账号'}</h2>

        <form onSubmit={mode === 'login' ? onSubmit : onRegisterSubmit} className="login-form" noValidate>
          {showServerEditor ? (
            <section className="login-server-editor" aria-label={copy.server}>
              <label className="login-field" htmlFor="login-server">
                <span>{copy.server}</span>
                <Input
                  id="login-server"
                  value={server}
                  onChange={(event) => {
                    setServer(event.target.value);
                    setServerStatus(null);
                  }}
                  placeholder={copy.serverPlaceholder}
                  autoComplete="url"
                  inputMode="url"
                  className="login-input"
                />
                <small className="login-field-hint">{copy.serverHint}</small>
                {server.trim() && normalizedServer ? <small className="login-field-hint">{copy.serverPreview}：{normalizedServer}</small> : null}
              </label>
              <Button type="button" variant="outline" className="login-server-confirm" onClick={confirmServer}>
                {extraCopy.confirmServer}
              </Button>
            </section>
          ) : null}
          {mode === 'login' ? (
            <>
              <section className="login-server-editor" aria-label={extraCopy.pairingLink}>
                <label className="login-field" htmlFor="app-pairing-link">
                  <span>{extraCopy.pairingLink}</span>
                  <Input
                    id="app-pairing-link"
                    value={pairingLink}
                    onChange={(event) => setPairingLink(event.target.value)}
                    placeholder={extraCopy.pairingPlaceholder}
                    autoComplete="off"
                    inputMode="url"
                    className="login-input"
                  />
                  <small className="login-field-hint">\u7c98\u8d34\u626b\u7801\u540e\u5f97\u5230\u7684\u94fe\u63a5\uff1b\u914d\u5bf9\u4e0d\u4f1a\u767b\u5f55\u8d26\u53f7\u3002</small>
                </label>
                <Button type="button" variant="outline" className="login-server-confirm" onClick={() => void handlePairing()} disabled={pairingLoading}>
                  {pairingLoading ? '\u6b63\u5728\u914d\u5bf9\u2026' : extraCopy.pairingAction}
                </Button>
              </section>
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
                  showPassword
                  className="login-input"
                />
              </label>
            </>
          ) : (
            <div className="login-register-grid">
              <label className="login-field" htmlFor="register-name">
                <span>姓名</span>
                <Input id="register-name" value={registration.name} onChange={(event) => updateRegistration('name', event.target.value)} autoComplete="name" className="login-input" />
              </label>
              <label className="login-field" htmlFor="register-student-no">
                <span>学号</span>
                <Input id="register-student-no" value={registration.student_no} onChange={(event) => updateRegistration('student_no', event.target.value)} className="login-input" />
              </label>
              <label className="login-field" htmlFor="register-phone">
                <span>注册手机号（登录账号）</span>
                <Input id="register-phone" value={registration.phone} onChange={(event) => updateRegistration('phone', event.target.value)} autoComplete="tel" inputMode="tel" className="login-input" />
              </label>
              <label className="login-field" htmlFor="register-major">
                <span>专业</span>
                <Input id="register-major" value={registration.major} onChange={(event) => updateRegistration('major', event.target.value)} className="login-input" />
              </label>
              <label className="login-field" htmlFor="register-mentor">
                <span>导师姓名</span>
                <Input id="register-mentor" value={registration.mentor_name} onChange={(event) => updateRegistration('mentor_name', event.target.value)} className="login-input" />
              </label>
              <label className="login-field" htmlFor="register-approval-code">
                <span>批准码（可选）</span>
                <Input
                  id="register-approval-code"
                  value={registration.approval_code}
                  onChange={(event) => updateRegistration('approval_code', event.target.value.toUpperCase())}
                  autoCapitalize="characters"
                  className="login-input font-mono tracking-wider"
                />
                <small className="login-field-hint">有效批准码会立即通过；不填写或无效则进入管理员审批。</small>
              </label>
              <label className="login-field" htmlFor="register-password">
                <span>密码（12–128 位）</span>
                <Input id="register-password" type="password" showPassword value={registration.password} onChange={(event) => updateRegistration('password', event.target.value)} autoComplete="new-password" className="login-input" />
              </label>
              <label className="login-field" htmlFor="register-password-confirmation">
                <span>再次输入密码</span>
                <Input id="register-password-confirmation" type="password" showPassword value={registrationConfirmation} onChange={(event) => setRegistrationConfirmation(event.target.value)} autoComplete="new-password" className="login-input" />
              </label>
            </div>
          )}

          {error ? <p className="login-error" role="alert">{error}</p> : null}
          {serverStatus ? <p className="login-success" role="status">{serverStatus}</p> : null}

          <Button type="submit" disabled={loading} className="login-submit">
            {loading ? (mode === 'login' ? copy.submitting : '注册中…') : (mode === 'login' ? copy.submit : '提交注册')}
          </Button>
        </form>

        <Button
          type="button"
          variant="ghost"
          className="mt-3 w-full"
          onClick={() => {
            setMode((current) => current === 'login' ? 'register' : 'login');
            setError(null);
            setServerStatus(null);
          }}
        >
          {mode === 'login' ? '没有账号？注册账号' : '已有账号？返回登录'}
        </Button>
        <p className="login-tip">{extraCopy.sessionHint}<br />批准码不会改变账号角色，只用于通过普通用户注册审批</p>
      </div>
    </main>
  );
}
