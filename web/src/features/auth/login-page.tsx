import { useState, type FormEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from './use-auth';

const copy = {
  systemName: '\u5b9e\u9a8c\u5ba4\u8bbe\u5907\u9884\u7ea6\u7cfb\u7edf',
  eyebrow: '\u8bbe\u5907\u4f7f\u7528\u4e0e\u7ef4\u62a4\u7ba1\u7406',
  title: '\u767b\u5f55',
  description: '\u8f93\u5165\u8d26\u53f7\u4fe1\u606f\u540e\u7ee7\u7eed\u3002\u7cfb\u7edf\u4f1a\u6839\u636e\u60a8\u7684\u6743\u9650\u663e\u793a\u5bf9\u5e94\u529f\u80fd\u3002',
  phone: '\u624b\u673a\u53f7',
  phonePlaceholder: '\u8bf7\u8f93\u5165\u624b\u673a\u53f7',
  password: '\u5bc6\u7801',
  passwordPlaceholder: '\u8bf7\u8f93\u5165\u5bc6\u7801',
  submit: '\u767b\u5f55\u7cfb\u7edf',
  submitting: '\u6b63\u5728\u767b\u5f55...',
  loginFailed: '\u767b\u5f55\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u8d26\u53f7\u4fe1\u606f\u540e\u91cd\u8bd5\u3002',
  requestFailed: '\u64cd\u4f5c\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002',
  networkFailed: '\u65e0\u6cd5\u8fde\u63a5\u670d\u52a1\uff0c\u8bf7\u786e\u8ba4\u7cfb\u7edf\u5df2\u542f\u52a8\u540e\u91cd\u8bd5\u3002',
  invalidCredentials: '\u624b\u673a\u53f7\u6216\u5bc6\u7801\u4e0d\u6b63\u786e\uff0c\u8bf7\u6838\u5bf9\u540e\u91cd\u8bd5\u3002',
  forbidden: '\u5f53\u524d\u8d26\u53f7\u6ca1\u6709\u8bbf\u95ee\u6743\u9650\uff0c\u8bf7\u8054\u7cfb\u7ba1\u7406\u5458\u3002',
  timeout: '\u8bf7\u6c42\u8d85\u65f6\uff0c\u8bf7\u68c0\u67e5\u7f51\u7edc\u540e\u91cd\u8bd5\u3002'
} as const;

function safeRedirectTarget(raw: string | null) {
  const target = String(raw || '').trim();
  if (!target || !target.startsWith('/') || target.startsWith('//') || target.startsWith('/login')) return '';
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
  if (lower.includes('unauthorized') || lower.includes('invalid credentials') || lower.includes('password')) return copy.invalidCredentials;
  if (lower.includes('forbidden') || lower.includes('permission')) return copy.forbidden;
  if (lower.includes('timeout')) return copy.timeout;
  if (/^[\x00-\x7F]+$/.test(raw)) return fallback;
  return raw;
}

export function LoginPage() {
  const navigate = useNavigate();
  const auth = useAuth();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await auth.loginUser(phone, password);
      navigate({ to: getLoginRedirect() || '/devices', replace: true } as any);
    } catch (err) {
      setError(toChineseError(err, copy.loginFailed));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative flex min-h-svh items-center justify-center overflow-hidden bg-[#060b1b] px-5 py-10 sm:px-8">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(91,225,255,0.10)_1px,transparent_1px),linear-gradient(90deg,rgba(91,225,255,0.10)_1px,transparent_1px)] bg-[size:32px_32px]" />
      <div className="pointer-events-none absolute left-1/2 bottom-[-38%] h-[72%] w-[145%] -translate-x-1/2 bg-[linear-gradient(rgba(91,225,255,0.20)_1px,transparent_1px),linear-gradient(90deg,rgba(91,225,255,0.20)_1px,transparent_1px)] bg-[size:52px_52px] opacity-55 [transform:perspective(540px)_rotateX(62deg)] [transform-origin:bottom]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_108%,rgba(42,77,169,0.42),transparent_54%),radial-gradient(ellipse_at_8%_14%,rgba(0,210,255,0.16),transparent_30%),radial-gradient(ellipse_at_92%_21%,rgba(135,74,255,0.20),transparent_34%)]" />
      <div className="pointer-events-none absolute left-1/2 top-0 h-[42%] w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-cyan-200/70 to-transparent shadow-[0_0_18px_rgba(103,232,249,0.75)]" />
      <div className="pointer-events-none absolute left-0 top-[31%] h-px w-full bg-gradient-to-r from-transparent via-cyan-200/35 to-transparent motion-safe:animate-pulse" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 size-[780px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-300/15 bg-[radial-gradient(circle,rgba(18,209,255,0.16)_0%,rgba(6,11,27,0)_66%)] shadow-[0_0_150px_rgba(33,138,255,0.20)]" />
      <div className="pointer-events-none absolute -left-24 top-14 h-64 w-64 rounded-full border border-cyan-300/25" />
      <div className="pointer-events-none absolute -left-10 top-28 h-36 w-36 rounded-full border border-violet-300/20" />
      <div className="pointer-events-none absolute -right-16 bottom-[-74px] h-72 w-72 rounded-full border border-violet-300/25" />
      <div className="pointer-events-none absolute -right-6 bottom-4 h-px w-52 bg-gradient-to-l from-cyan-300/70 to-transparent" />

      <div aria-hidden="true" className="pointer-events-none absolute inset-0 hidden overflow-hidden lg:block">
        <div className="absolute left-[7%] top-[22%] h-56 w-72 rounded-3xl border border-cyan-300/20 bg-cyan-950/20 p-5 shadow-[0_20px_55px_-42px_rgba(9,94,112,0.7)] backdrop-blur-[2px]">
          <div className="flex items-center justify-between">
            <span className="h-2 w-16 rounded-full bg-cyan-200/35" />
            <span className="size-3 rounded-full border border-cyan-200/60" />
          </div>
          <div className="mt-6 grid grid-cols-7 items-end gap-2">
            <span className="h-8 rounded-sm bg-cyan-300/24" /><span className="h-16 rounded-sm bg-cyan-300/33" /><span className="h-11 rounded-sm bg-violet-300/28" /><span className="h-24 rounded-sm bg-cyan-300/42" /><span className="h-14 rounded-sm bg-violet-300/32" /><span className="h-20 rounded-sm bg-cyan-300/36" /><span className="h-10 rounded-sm bg-violet-300/24" />
          </div>
          <div className="mt-5 grid grid-cols-3 gap-2"><span className="h-1.5 rounded-full bg-cyan-100/18" /><span className="h-1.5 rounded-full bg-cyan-100/18" /><span className="h-1.5 rounded-full bg-cyan-100/18" /></div>
        </div>

        <div className="absolute bottom-[17%] left-[16%] flex items-center gap-3">
          <span className="size-3 rounded-full bg-cyan-300/80 shadow-[0_0_18px_rgba(6,182,212,0.7)]" />
          <span className="h-px w-28 bg-gradient-to-r from-cyan-300/80 to-transparent" />
        </div>
        <div className="absolute left-[29%] top-[43%] h-20 w-px bg-gradient-to-b from-cyan-300/55 to-transparent" />

        <div className="absolute right-[7%] top-[18%] w-72 rounded-3xl border border-violet-300/20 bg-violet-950/20 p-5 shadow-[0_20px_55px_-42px_rgba(30,64,175,0.65)] backdrop-blur-[2px]">
          <div className="flex items-center justify-between"><span className="h-2 w-20 rounded-full bg-violet-200/30" /><span className="size-3 rounded-full bg-violet-300/40" /></div>
          <div className="relative mt-6 h-24 overflow-hidden rounded-2xl border border-cyan-300/15 bg-cyan-500/[0.055]">
            <span className="absolute bottom-5 left-5 size-3 rounded-full bg-cyan-300/70" />
            <span className="absolute bottom-11 left-20 size-2 rounded-full bg-violet-300/65" />
            <span className="absolute right-9 top-5 size-3 rounded-full bg-cyan-300/55" />
            <span className="absolute bottom-9 left-8 h-px w-44 rotate-[-18deg] bg-gradient-to-r from-cyan-300/75 via-violet-300/55 to-transparent" />
            <span className="absolute bottom-[31px] left-16 h-px w-24 rotate-[12deg] bg-violet-300/55" />
          </div>
          <div className="mt-4 flex gap-2"><span className="h-7 flex-1 rounded-lg border border-cyan-300/25 bg-cyan-300/[0.10]" /><span className="h-7 flex-1 rounded-lg border border-violet-300/25 bg-violet-300/[0.10]" /></div>
        </div>

        <div className="absolute bottom-[18%] right-[12%] grid grid-cols-4 gap-2">
          <span className="size-11 rounded-xl border border-cyan-300/18 bg-cyan-950/25" /><span className="size-11 rounded-xl border border-violet-300/18 bg-violet-950/25" /><span className="size-11 rounded-xl border border-cyan-300/18 bg-cyan-950/25" /><span className="size-11 rounded-xl border border-violet-300/18 bg-violet-950/25" />
        </div>
      </div>

      <section className="relative w-full max-w-[520px]">
        <header className="mb-10 border-l-4 border-cyan-300 pl-4">
          <p className="text-[11px] font-semibold tracking-[0.14em] text-cyan-100/85">{copy.eyebrow}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[0.04em] text-cyan-50 ">{copy.systemName}</h1>
        </header>

        <div className="rounded-3xl border border-cyan-200/20 bg-slate-950/60 p-7 sm:p-10 shadow-[0_26px_80px_-30px_rgba(0,177,255,0.38)] backdrop-blur-xl">
          <div className="mb-9">
            <h2 className="text-2xl font-semibold tracking-[0.02em] text-cyan-100">{copy.title}</h2>
            <p className="mt-2 text-base leading-7 text-slate-200/75">{copy.description}</p>
          </div>

          <form onSubmit={onSubmit} className="space-y-6">
            <div className="space-y-2">
              <label className="text-sm font-medium tracking-[0.02em] text-cyan-100/90" htmlFor="login-phone">{copy.phone}</label>
              <Input
                id="login-phone"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder={copy.phonePlaceholder}
                aria-label={copy.phone}
                autoComplete="tel"
                inputMode="tel"
                required
                className="h-[52px] rounded-xl border-slate-700/90 bg-slate-900/70 text-slate-100 shadow-none placeholder:text-slate-400/70 focus-visible:border-cyan-300 focus-visible:ring-cyan-300/20"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium tracking-[0.02em] text-cyan-100/90" htmlFor="login-password">{copy.password}</label>
              <Input
                id="login-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={copy.passwordPlaceholder}
                aria-label={copy.password}
                autoComplete="current-password"
                required
                className="h-11 rounded-lg border-slate-700/90 bg-slate-900/70 text-slate-100 shadow-none placeholder:text-slate-400/70 focus-visible:border-cyan-300 focus-visible:ring-cyan-300/20"
              />
            </div>
            {error ? <p className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-sm leading-5 text-destructive" role="alert">{error}</p> : null}
            <Button type="submit" disabled={loading} className="h-[52px] w-full rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-sm font-semibold text-slate-950 shadow-[0_10px_28px_-10px_rgba(34,211,238,0.8)] hover:from-cyan-400 hover:to-blue-500">
              {loading ? copy.submitting : copy.submit}
            </Button>
          </form>
        </div>
      </section>
    </main>
  );
}
