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

type DialogState = ConfirmState | PromptState;

const toneClass: Record<DialogTone, string> = {
  default: 'bg-primary/10 text-primary',
  danger: 'bg-destructive/10 text-destructive',
  warning: 'bg-amber-100 text-amber-700'
};

function DialogIcon({ tone, kind }: { tone: DialogTone; kind: DialogState['kind'] }) {
  const cls = 'h-6 w-6';
  if (kind === 'prompt') return <MessageSquareText className={cls} />;
  if (tone === 'danger' || tone === 'warning') return <AlertTriangle className={cls} />;
  return <ShieldCheck className={cls} />;
}

export function useActionDialog() {
  const [state, setState] = useState<DialogState | null>(null);
  const [inputValue, setInputValue] = useState('');
  const resolverRef = useRef<((value: boolean | string | null) => void) | null>(null);

  const finish = useCallback((value: boolean | string | null) => {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setState(null);
    setInputValue('');
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

  function ActionDialog() {
    if (!state) return null;
    const tone = state.tone || 'default';
    const confirmText = state.confirmText || (state.kind === 'prompt' ? '提交' : '确认');
    const cancelText = state.cancelText || '取消';
    const descriptionId = 'action-dialog-description';

    function submit(e: FormEvent) {
      e.preventDefault();
      if (!state) return;
      if (state.kind === 'prompt') {
        const value = inputValue.trim();
        if (state.required && !value) return;
        finish(value);
      } else {
        finish(true);
      }
    }

    return (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) finish(false); }}>
        <form
          className="w-full max-w-md rounded-[28px] border bg-card p-5 text-left shadow-[0_28px_80px_rgba(15,23,42,0.24)]"
          role="dialog"
          aria-modal="true"
          aria-describedby={state.description ? descriptionId : undefined}
          onSubmit={submit}
        >
          <div className="flex items-start gap-4">
            <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl', toneClass[tone])}>
              <DialogIcon tone={tone} kind={state.kind} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-black tracking-tight text-foreground">{state.title}</h2>
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

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => finish(false)}>{cancelText}</Button>
            <Button type="submit" variant={tone === 'danger' ? 'destructive' : 'default'} disabled={state.kind === 'prompt' && state.required && !inputValue.trim()}>
              {confirmText}
            </Button>
          </div>
        </form>
      </div>
    );
  }

  return { confirm, prompt, ActionDialog };
}