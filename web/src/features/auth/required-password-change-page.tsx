import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { APP_PATHS } from '@/lib/app-paths';
import { AuthRouteStatus } from './auth-guard';
import { useAuth } from './use-auth';
import './login-page.css';

function messageOf(error: unknown) {
  return error instanceof Error && error.message ? error.message : '密码修改失败，请稍后重试。';
}

export function RequiredPasswordChangePage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!auth.isReady) return;
    if (!auth.isLoggedIn) {
      void navigate({ to: APP_PATHS.login, replace: true } as any);
      return;
    }
    if (!auth.passwordResetRequired) {
      void navigate({ to: APP_PATHS.devices, replace: true } as any);
    }
  }, [auth.isLoggedIn, auth.isReady, auth.passwordResetRequired, navigate]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!currentPassword) {
      setError('请输入管理员提供的一次性临时密码。');
      return;
    }
    if (newPassword.length < 12 || newPassword.length > 128) {
      setError('新密码必须为 12–128 位。');
      return;
    }
    if (newPassword !== confirmation) {
      setError('两次输入的新密码不一致。');
      return;
    }
    if (newPassword === currentPassword) {
      setError('新密码不能与一次性临时密码相同。');
      return;
    }

    setLoading(true);
    try {
      await auth.completeRequiredPasswordReset(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
      await navigate({ to: APP_PATHS.login, replace: true } as any);
    } catch (requestError) {
      setError(messageOf(requestError));
    } finally {
      setLoading(false);
    }
  }

  if (!auth.isReady || !auth.isLoggedIn || !auth.passwordResetRequired) {
    return <AuthRouteStatus mode="redirecting" message="正在确认账号安全状态…" />;
  }

  return (
    <main className="login-shell">
      <div className="login-card">
        <div className="login-brand-row">
          <div className="login-logo" aria-hidden="true">安</div>
          <div>
            <h1>必须设置新密码</h1>
            <p>管理员已重置此账号密码</p>
          </div>
        </div>
        <div className="login-divider" />
        <p className="login-field-hint">
          请先验证一次性临时密码，再设置 12–128 位新密码。完成前不能进入任何业务页面；成功后请使用新密码重新登录。
        </p>
        <form onSubmit={onSubmit} className="login-form mt-4" noValidate>
          <label className="login-field" htmlFor="temporary-password">
            <span>一次性临时密码</span>
            <Input
              id="temporary-password"
              type="password"
              showPassword
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              className="login-input"
            />
          </label>
          <label className="login-field" htmlFor="new-password">
            <span>新密码</span>
            <Input
              id="new-password"
              type="password"
              showPassword
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className="login-input"
            />
          </label>
          <label className="login-field" htmlFor="new-password-confirmation">
            <span>再次输入新密码</span>
            <Input
              id="new-password-confirmation"
              type="password"
              showPassword
              autoComplete="new-password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              className="login-input"
            />
          </label>
          {error ? <p className="login-error" role="alert">{error}</p> : null}
          <Button type="submit" disabled={loading} className="login-submit">
            {loading ? '正在更新…' : '设置新密码并重新登录'}
          </Button>
        </form>
      </div>
    </main>
  );
}
