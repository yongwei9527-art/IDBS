import type { ReactNode } from 'react';
import { ArrowRight, Boxes, Clock3, ClipboardList, Filter, PanelRightOpen, ShieldCheck, Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type OpsTone = 'default' | 'info' | 'success' | 'warning' | 'danger' | 'muted';

const toneClass: Record<OpsTone, string> = {
  default: 'border-primary/15 bg-primary/10 text-primary',
  info: 'border-sky-400/30 bg-sky-50 text-sky-700',
  success: 'border-emerald-400/30 bg-emerald-50 text-emerald-700',
  warning: 'border-amber-400/35 bg-amber-50 text-amber-700',
  danger: 'border-rose-400/35 bg-rose-50 text-rose-700',
  muted: 'border-border bg-muted text-muted-foreground'
};

const metricToneClass: Record<OpsTone, string> = {
  default: 'from-primary/15 ring-primary/10',
  info: 'from-sky-500/15 ring-sky-500/10',
  success: 'from-emerald-500/15 ring-emerald-500/10',
  warning: 'from-amber-500/15 ring-amber-500/10',
  danger: 'from-rose-500/15 ring-rose-500/10',
  muted: 'from-slate-500/10 ring-slate-500/10'
};

const metricTextClass: Record<OpsTone, string> = {
  default: 'text-primary',
  info: 'text-sky-700',
  success: 'text-emerald-700',
  warning: 'text-amber-700',
  danger: 'text-rose-700',
  muted: 'text-slate-600'
};

export function OpsBadge({ tone = 'default', children, className }: { tone?: OpsTone; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-black', toneClass[tone], className)}>{children}</span>;
}

export function OpsPageHeader({
  eyebrow,
  title,
  description,
  children,
  aside,
  className
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('ops-page-header', className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="ops-page-header-eyebrow">{eyebrow}</p> : null}
        <h1 className={cn(eyebrow ? 'mt-2' : '', 'ops-page-header-title')}>{title}</h1>
        {description ? <p className="ops-page-header-description">{description}</p> : null}
        {children ? <div className="ops-page-header-actions">{children}</div> : null}
      </div>
      {aside ? <aside className="ops-page-header-aside">{aside}</aside> : null}
    </section>
  );
}

export function OpsMetricCard({
  label,
  value,
  hint,
  icon,
  tone = 'default',
  onClick,
  loading,
  className
}: {
  label: ReactNode;
  value?: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: OpsTone;
  onClick?: () => void;
  loading?: boolean;
  className?: string;
}) {
  const content = (
    <>
      <div className="relative flex items-start justify-between gap-3">
        <div>
          <span className="text-sm font-medium text-muted-foreground">{label}</span>
          <p className={cn('mt-2 text-3xl font-black tabular-nums', metricTextClass[tone])}>{loading ? '—' : value ?? 0}</p>
          {hint ? <small className="mt-2 block text-xs text-muted-foreground">{hint}</small> : null}
        </div>
        {icon ? <span className="rounded-2xl bg-background/80 p-2 text-primary shadow-sm">{icon}</span> : null}
      </div>
    </>
  );

  const classes = cn('ops-stat-card bg-gradient-to-br to-card p-5 text-left ring-1 transition hover:-translate-y-px hover:shadow-lg', metricToneClass[tone], className);
  if (onClick) {
    return (
      <button type="button" className={classes} onClick={onClick}>
        {content}
      </button>
    );
  }
  return <div className={classes}>{content}</div>;
}

export function OpsSectionHeader({ eyebrow, title, description, action }: { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        {eyebrow ? <p className="text-xs font-black uppercase tracking-wider text-primary">{eyebrow}</p> : null}
        <h2 className="mt-1 text-base font-black tracking-tight">{title}</h2>
        {description ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function OpsEmptyState({
  title = '暂无数据',
  description = '当前筛选条件下没有可显示的内容。',
  icon,
  action,
  className
}: {
  title?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rounded-3xl border border-dashed bg-muted/20 p-8 text-center text-sm text-muted-foreground', className)}>
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-background text-primary shadow-sm">
        {icon ?? <ClipboardList className="h-5 w-5" />}
      </div>
      <h3 className="text-base font-black text-foreground">{title}</h3>
      <p className="mx-auto mt-2 max-w-md leading-6">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function OpsQuickCard({
  title,
  description,
  icon,
  badge,
  onClick,
  className
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  badge?: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('group rounded-2xl border bg-background/80 p-4 text-left transition hover:-translate-y-px hover:border-primary/40 hover:shadow-sm', className)}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="rounded-2xl bg-primary/10 p-2 text-primary">{icon ?? <Boxes className="h-4 w-4" />}</span>
        {badge ?? <OpsBadge tone="success">可访问</OpsBadge>}
      </div>
      <h3 className="mt-3 font-black">{title}</h3>
      {description ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{description}</p> : null}
      <span className="mt-3 inline-flex items-center gap-1 text-[11px] font-black text-primary opacity-0 transition group-hover:opacity-100">
        进入处理 <ArrowRight className="h-3 w-3" />
      </span>
    </button>
  );
}

export function OpsSecurityNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('ops-security-note flex items-start gap-2', className)}>
      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

export function OpsAiChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-bold text-white/82 backdrop-blur">
      <Sparkles className="h-3.5 w-3.5" />
      {children}
    </span>
  );
}

export function OpsDataToolbar({
  title,
  description,
  filters,
  actions,
  meta,
  className
}: {
  title?: ReactNode;
  description?: ReactNode;
  filters?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('ops-data-toolbar', className)}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Filter className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            {title ? <h2 className="truncate text-base font-black tracking-tight">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p> : null}
          </div>
        </div>
        {filters ? <div className="mt-3 flex flex-wrap gap-2">{filters}</div> : null}
      </div>
      <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
        {meta ? <div className="text-xs font-semibold text-muted-foreground">{meta}</div> : null}
        {actions ? <div className="flex flex-wrap justify-end gap-2">{actions}</div> : null}
      </div>
    </section>
  );
}

export function OpsDetailDrawer({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  className
}: {
  open: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-foreground/24 backdrop-blur-sm" role="dialog" aria-modal="true">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="关闭详情" onClick={onClose} />
      <aside className={cn('relative flex h-full w-full max-w-xl flex-col border-l bg-card shadow-2xl', className)}>
        <header className="flex items-start justify-between gap-4 border-b p-5">
          <div className="min-w-0">
            <p className="mb-2 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-xs font-black text-primary">
              <PanelRightOpen className="h-3.5 w-3.5" />详情
            </p>
            <h2 className="truncate text-xl font-black tracking-tight">{title}</h2>
            {subtitle ? <p className="mt-1 text-sm leading-6 text-muted-foreground">{subtitle}</p> : null}
          </div>
          <button type="button" className="rounded-2xl border bg-background p-2 text-muted-foreground hover:text-foreground" aria-label="关闭详情" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        {footer ? <footer className="border-t bg-background/60 p-4">{footer}</footer> : null}
      </aside>
    </div>
  );
}

export function OpsRiskBadge({
  level = 'low',
  children,
  className
}: {
  level?: 'low' | 'medium' | 'high' | 'critical';
  children?: ReactNode;
  className?: string;
}) {
  const map = {
    low: { label: '低风险', tone: 'success' as OpsTone },
    medium: { label: '关注', tone: 'warning' as OpsTone },
    high: { label: '高风险', tone: 'danger' as OpsTone },
    critical: { label: '紧急', tone: 'danger' as OpsTone }
  };
  const item = map[level];
  return <OpsBadge tone={item.tone} className={className}>{children ?? item.label}</OpsBadge>;
}

export function OpsTimeBlock({
  label,
  subLabel,
  color,
  title,
  compact = false,
  className
}: {
  label: ReactNode;
  subLabel?: ReactNode;
  color?: string;
  title?: string;
  compact?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn('ops-time-block', compact && 'ops-time-block-compact', className)}
      title={title}
      style={color ? ({ '--ops-time-color': color } as any) : undefined}
    >
      <Clock3 className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate font-black">{label}</span>
      {subLabel ? <span className="truncate text-[10px] font-semibold opacity-75">{subLabel}</span> : null}
    </span>
  );
}

export function OpsPermissionHint({
  title = '权限边界',
  permissions,
  children,
  className
}: {
  title?: ReactNode;
  permissions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('ops-permission-note flex items-start gap-2', className)}>
      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">
        <p className="font-black">{title}</p>
        {permissions ? <p className="mt-1 text-xs leading-5">{permissions}</p> : null}
        {children ? <div className="mt-1 text-xs leading-5">{children}</div> : null}
      </div>
    </div>
  );
}

