import { useCallback, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AlertTriangle, MessageSquareText, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type DialogTone = 'default' | 'danger' | 'warning';

type BaseOptions = {
  title: string;
  description?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  tone?: DialogTone;
};

type ConfirmState = BaseOptions & { kind: 'confirm' };
type PromptState = BaseOptions & {
  kind: 'prompt';
  placeholder?: string;
  defaultValue?: string;
  required?: boolean;
  maxLength?: number;
};
type PasswordPromptState = BaseOptions & {
  kind: 'password';
  minLength?: number;
  maxLength?: number;
  passwordLabel?: string;
  confirmationLabel?: string;
};

type DialogState = ConfirmState | PromptState | PasswordPromptState;

const toneClass: Record<DialogTone, string> = {
  default: 'bg-primary/10 text-primary',
  danger: 'bg-destructive/10 text-destructive',
  warning: 'bg-amber-100 text-amber-700'
};

function DialogIcon({ tone, kind }: { tone: DialogTone; kind: DialogState['kind'] }) {
  const cls = 'h-6 w-6';
  if (kind === 'prompt') return <MessageSquareText className={cls} />;
  if (kind === 'password') return <ShieldCheck className={cls} />;
  if (tone === 'danger' || tone === 'warning') return <AlertTriangle className={cls} />;
  return <ShieldCheck className={cls} />;
}

export function useActionDialog() {
  const [state, setState] = useState<DialogState | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [confirmationValue, setConfirmationValue] = useState('');
  const resolverRef = useRef<((value: boolean | string | null) => void) | null>(null);

  const finish = useCallback((value: boolean | string | null) => {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setState(null);
    setInputValue('');
    setConfirmationValue('');
  }, []);

  const confirm = useCallback((options: BaseOptions) => new Promise<boolean>((resolve) => {
    resolverRef.current = (value) => resolve(Boolean(value));
    setState({ kind: 'confirm', ...options });
  }), []);

  const prompt = useCallback((options: Omit<PromptState, 'kind'>) => new Promise<string | null>((resolve) => {
    resolverRef.current = (value) => resolve(typeof value === 'string' ? value : null);
    setInputValue(options.defaultValue || '');
    setState({ kind: 'prompt', ...options });
  }), []);

  const passwordPrompt = useCallback((options: Omit<PasswordPromptState, 'kind'>) => new Promise<string | null>((resolve) => {
    resolverRef.current = (value) => resolve(typeof value === 'string' ? value : null);
    setInputValue('');
    setConfirmationValue('');
    setState({ kind: 'password', ...options });
  }), []);

  function ActionDialog() {
    if (!state) return null;
    const tone = state.tone || 'default';
    const confirmText = state.confirmText || (state.kind === 'confirm' ? '确认' : '提交');
    const cancelText = state.cancelText || '取消';
    const descriptionId = 'action-dialog-description';
    const minPasswordLength = state.kind === 'password' ? (state.minLength ?? 12) : 0;
    const maxPasswordLength = state.kind === 'password' ? (state.maxLength ?? 128) : 0;
    const passwordError = state.kind !== 'password'
      ? ''
      : inputValue.length < minPasswordLength
        ? `密码至少需要 ${minPasswordLength} 位。`
        : inputValue.length > maxPasswordLength
          ? `密码最多 ${maxPasswordLength} 位。`
          : confirmationValue.length === 0
            ? '请再次输入新密码。'
            : inputValue !== confirmationValue
              ? '两次输入的密码不一致。'
              : '';
    const passwordReady = state.kind !== 'password' || passwordError === '';

    function submit(e: FormEvent) {
      e.preventDefault();
      if (!state) return;
      if (state.kind === 'prompt') {
        const value = inputValue.trim();
        if (state.required && !value) return;
        finish(value);
      } else if (state.kind === 'password') {
        if (!passwordReady) return;
        finish(inputValue);
      } else {
        finish(true);
      }
    }

    return (
      <div className="ui-dialog-backdrop fixed inset-0 z-[80] flex items-center justify-center p-4" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) finish(false); }}>
        <form
          className="ui-dialog-panel w-full max-w-md rounded-xl border p-5 text-left"
          role="dialog"
          aria-modal="true"
          aria-describedby={state.description ? descriptionId : undefined}
          onSubmit={submit}
        >
          <div className="flex items-start gap-4">
            <span className={cn('ui-dialog-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', toneClass[tone])}>
              <DialogIcon tone={tone} kind={state.kind} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold tracking-tight text-foreground">{state.title}</h2>
              {state.description && <div id={descriptionId} className="mt-2 text-sm leading-6 text-muted-foreground">{state.description}</div>}
            </div>
          </div>

          {state.kind === 'prompt' && (
            <div className="mt-5">
              <Input
                autoFocus
                value={inputValue}
                maxLength={state.maxLength || 200}
                placeholder={state.placeholder || '请填写内容'}
                onChange={(e) => setInputValue(e.target.value)}
              />
              <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
                <span>{state.required ? '必填' : '可留空'}</span>
                <span>{inputValue.trim().length}/{state.maxLength || 200}</span>
              </div>
            </div>
          )}

          {state.kind === 'password' && (
            <div className="mt-5 space-y-3">
              <label className="block space-y-1.5 text-sm font-medium" htmlFor="action-dialog-new-password">
                <span>{state.passwordLabel || '新密码'}</span>
                <Input
                  id="action-dialog-new-password"
                  autoFocus
                  type="password"
                  autoComplete="new-password"
                  value={inputValue}
                  minLength={minPasswordLength}
                  maxLength={maxPasswordLength}
                  onChange={(e) => setInputValue(e.target.value)}
                />
              </label>
              <label className="block space-y-1.5 text-sm font-medium" htmlFor="action-dialog-confirm-password">
                <span>{state.confirmationLabel || '再次输入新密码'}</span>
                <Input
                  id="action-dialog-confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmationValue}
                  minLength={minPasswordLength}
                  maxLength={maxPasswordLength}
                  onChange={(e) => setConfirmationValue(e.target.value)}
                />
              </label>
              <div className="flex items-start justify-between gap-3 text-[11px]">
                <span className={passwordError ? 'text-destructive' : 'text-muted-foreground'}>{passwordError || '两次输入一致后方可提交。'}</span>
                <span className="shrink-0 text-muted-foreground">{inputValue.length}/{maxPasswordLength}</span>
              </div>
            </div>
          )}

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => finish(false)}>{cancelText}</Button>
            <Button
              type="submit"
              variant={tone === 'danger' ? 'destructive' : 'default'}
              disabled={(state.kind === 'prompt' && state.required && !inputValue.trim()) || !passwordReady}
            >
              {confirmText}
            </Button>
          </div>
        </form>
      </div>
    );
  }

  return { confirm, prompt, passwordPrompt, ActionDialog };
}