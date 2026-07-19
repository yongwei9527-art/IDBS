import type { ReactNode } from 'react';
import { Boxes, Clock3, ClipboardList, Filter, ShieldCheck, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type OpsTone = 'default' | 'info' | 'success' | 'warning' | 'danger' | 'muted';

const toneClass: Record<OpsTone, string> = {
  default: 'ops-badge--default',
  info: 'ops-badge--info',
  success: 'ops-badge--success',
  warning: 'ops-badge--warning',
  danger: 'ops-badge--danger',
  muted: 'ops-badge--muted'
};

const metricToneClass: Record<OpsTone, string> = {
  default: 'ops-stat-card--default',
  info: 'ops-stat-card--info',
  success: 'ops-stat-card--success',
  warning: 'ops-stat-card--warning',
  danger: 'ops-stat-card--danger',
  muted: 'ops-stat-card--muted'
};

const metricTextClass: Record<OpsTone, string> = {
  default: 'ops-metric-value--default',
  info: 'ops-metric-value--info',
  success: 'ops-metric-value--success',
  warning: 'ops-metric-value--warning',
  danger: 'ops-metric-value--danger',
  muted: 'ops-metric-value--muted'
};

export function OpsBadge({ tone = 'default', children, className }: { tone?: OpsTone; children: ReactNode; className?: string }) {
  return <span className={cn('ops-badge inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold', toneClass[tone], className)}>{children}</span>;
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
    <section className={cn('ops-page-header', aside && 'ops-page-header--with-aside', children && 'ops-page-header--with-actions', className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="ops-page-header-eyebrow">{eyebrow}</p> : null}
        <h1 className={cn(eyebrow ? 'mt-1.5' : '', 'ops-page-header-title')}>{title}</h1>
        {description ? <p className="ops-page-header-description">{description}</p> : null}
      </div>
      {aside ? <aside className="ops-page-header-aside">{aside}</aside> : null}
      {children ? <div className="ops-page-header-actions">{children}</div> : null}
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
      <div className="ops-metric-card-content relative flex items-start justify-between gap-3">
        <div>
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
          <p className={cn('mt-1 text-[1.35rem] font-semibold tabular-nums tracking-tight', metricTextClass[tone])}>{loading ? '—' : value ?? 0}</p>
          {hint ? <small className="mt-2 block text-xs text-muted-foreground">{hint}</small> : null}
        </div>
        {icon ? <span className="ops-metric-icon rounded-xl p-2 text-primary">{icon}</span> : null}
      </div>
    </>
  );

  const classes = cn('ops-stat-card p-4 text-left', metricToneClass[tone], className);
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
    <div className="ops-section-header flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        {eyebrow ? <p className="ops-section-eyebrow text-xs font-semibold text-primary">{eyebrow}</p> : null}
        <h2 className="mt-1 text-base font-semibold tracking-tight">{title}</h2>
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
    <div className={cn('ops-empty-state rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground', className)}>
      <div className="ops-empty-icon mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl text-primary">
        {icon ?? <ClipboardList className="h-5 w-5" />}
      </div>
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {description ? <p className="mx-auto mt-2 max-w-md leading-6">{description}</p> : null}
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
      className={cn('ops-quick-card group rounded-xl border p-4 text-left transition', className)}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="ops-quick-icon rounded-xl p-2 text-primary">{icon ?? <Boxes className="h-4 w-4" />}</span>
        {badge ?? <OpsBadge tone="success">可访问</OpsBadge>}
      </div>
      <h3 className="mt-3 text-sm font-semibold">{title}</h3>
      {description ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{description}</p> : null}
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
    <span className="ops-inline-chip inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold">
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
    <section className={cn('ops-data-toolbar', filters && 'ops-data-toolbar--with-filters', actions && 'ops-data-toolbar--with-actions', className)}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="ops-toolbar-icon inline-flex h-8 w-8 items-center justify-center rounded-lg text-primary">
            <Filter className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            {title ? <h2 className="truncate text-sm font-bold tracking-tight">{title}</h2> : null}
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
    <div className="ops-drawer-backdrop fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="关闭详情" onClick={onClose} />
      <aside className={cn('ops-drawer-panel relative flex h-full w-full max-w-xl flex-col border-l', className)}>
        <header className="ops-drawer-header flex items-start justify-between gap-4 border-b p-5">
          <div className="min-w-0">
            <h2 className="truncate text-xl font-semibold tracking-tight">{title}</h2>
            {subtitle ? <p className="mt-1 text-sm leading-6 text-muted-foreground">{subtitle}</p> : null}
          </div>
          <button type="button" className="ops-drawer-close rounded-xl border p-2 text-muted-foreground hover:text-foreground" aria-label="关闭详情" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        {footer ? <footer className="ops-drawer-footer border-t p-4">{footer}</footer> : null}
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
      <span className="truncate font-semibold">{label}</span>
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
        <p className="font-semibold">{title}</p>
        {permissions ? <p className="mt-1 text-xs leading-5">{permissions}</p> : null}
        {children ? <div className="mt-1 text-xs leading-5">{children}</div> : null}
      </div>
    </div>
  );
}
