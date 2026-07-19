import { type MouseEvent, type ReactNode, useEffect, useState } from 'react';
import { Outlet, Link, useLocation } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/use-auth';
import { RequireAuth } from '@/features/auth/auth-guard';
import { useCapability } from '@/features/auth/permissions';
import { ADMIN_MODULES } from '@/features/platform/operations-module-registry';
import {
  AlertTriangle,
  Bell,
  CalendarCheck,
  ChevronLeft,
  ClipboardList,
  LayoutDashboard,
  GalleryVerticalEnd,
  LogOut,
  MessageSquare,
  Moon,
  MonitorSmartphone,
  Sun,
  UserRound,
  Wrench
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  fetchSystemNotice,
  isSystemNoticeRead,
  markSystemNoticeRead,
  SYSTEM_NOTICE_QUERY_KEY,
  type SystemNotice
} from '@/features/notification/system-notice';

interface NavItem {
  title: string;
  to: string;
  icon: ReactNode;
  anyPerm?: string[];
  allPerm?: string[];
  adminOnly?: boolean;
  superOnly?: boolean;
}

const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: '服务',
    items: [
      { title: '设备列表', to: '/devices', icon: <MonitorSmartphone className="h-4 w-4" /> },
      { title: '提交预约', to: '/reserve', icon: <CalendarCheck className="h-4 w-4" /> },
      { title: '使用日历', to: '/calendar', icon: <LayoutDashboard className="h-4 w-4" /> },
      { title: '我的预约', to: '/me/reservations', icon: <ClipboardList className="h-4 w-4" /> },
      { title: '开始/归还', to: '/borrow', icon: <Wrench className="h-4 w-4" /> },
      { title: '故障/诉求', to: '/faults', icon: <AlertTriangle className="h-4 w-4" /> },
      { title: '联系人员', to: '/support/contacts', icon: <UserRound className="h-4 w-4" /> },
      { title: '通知', to: '/notifications', icon: <Bell className="h-4 w-4" /> },
      { title: '聊天', to: '/chat', icon: <MessageSquare className="h-4 w-4" /> }
    ]
  }
];

function adminNavIcon(path: string) {
  if (path.includes('calendar')) return <CalendarCheck className="h-4 w-4" />;
  if (path.includes('devices')) return <MonitorSmartphone className="h-4 w-4" />;
  if (path.includes('reservations')) return <CalendarCheck className="h-4 w-4" />;
  if (path.includes('users')) return <UserRound className="h-4 w-4" />;
  if (path.includes('stats') || path.includes('dashboard')) return <LayoutDashboard className="h-4 w-4" />;
  if (path.includes('audit') || path.includes('requests') || path.includes('export')) return <ClipboardList className="h-4 w-4" />;
  return <Wrench className="h-4 w-4" />;
}

const adminNavGroups: { label: string; items: NavItem[] }[] = Object.entries(
  ADMIN_MODULES.reduce<Record<string, NavItem[]>>((groups, module) => {
    (groups[module.group] ||= []).push({
      title: module.title,
      to: module.path,
      icon: adminNavIcon(module.path),
      anyPerm: module.anyPermissions,
      superOnly: module.superOnly
    });
    return groups;
  }, {})
).map(([label, items]) => ({ label, items }));

const BREADCRUMB_LABEL: Record<string, string> = {
  admin: '运营',
  dashboard: '总览',
  devices: '设备',
  reserve: '预约',
  reservations: '预约',
  users: '用户',
  faults: '故障',
  requests: '诉求',
  maintenance: '设备维护',
  stats: '运营分析',
  export: '文档导出',
  system: '系统配置',
  audit: '审计',
  calendar: '日历',
  borrow: '借还',
  chat: '聊天',
  notifications: '通知',
  support: '支持',
  contacts: '联系人员',
  me: '我的'
};

function Breadcrumb({ pathname }: { pathname: string }) {
  const seg = pathname.split('/').filter(Boolean);
  return (
    <nav className="ops-breadcrumb flex items-center text-sm text-muted-foreground">
      {seg.length === 0 ? (
        <span>首页</span>
      ) : (
        seg.map((s, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span className="ops-breadcrumb-separator px-1">/</span>}
            <span className={cn(i === seg.length - 1 && 'text-foreground')}>{BREADCRUMB_LABEL[s] ?? s}</span>
          </span>
        ))
      )}
    </nav>
  );
}

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  const [notice, setNotice] = useState<SystemNotice | null>(null);
  const [ambient, setAmbient] = useState<'day' | 'night'>(() => {
    if (typeof window === 'undefined') return 'night';
    const saved = window.localStorage.getItem('IDBS_AMBIENT');
    if (saved === 'day' || saved === 'night') return saved;
    const hour = new Date().getHours();
    return hour >= 7 && hour < 19 ? 'day' : 'night';
  });
  const location = useLocation();
  const auth = useAuth();
  const capability = useCapability();
  const { data: latestNotice } = useQuery({
    queryKey: SYSTEM_NOTICE_QUERY_KEY,
    queryFn: fetchSystemNotice,
    enabled: auth.isLoggedIn,
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false
  });

  const isActive = (to: string) => location.pathname === to || (to !== '/devices' && location.pathname.startsWith(`${to}/`));
  const hasItemAccess = (item: NavItem) => {
    if (item.superOnly) return capability.isSuperAdmin;
    if (auth.role === 'super_admin') return true;
    if (item.adminOnly && !capability.isAdminLike) return false;
    if (item.allPerm?.length && !item.allPerm.every((permission) => auth.hasPerm(permission))) return false;
    if (item.anyPerm?.length && !item.anyPerm.some((permission) => auth.hasPerm(permission))) return false;
    return true;
  };
  const pruneGroups = (groups: { label: string; items: NavItem[] }[]) =>
    groups.map((group) => ({ ...group, items: group.items.filter(hasItemAccess) })).filter((group) => group.items.length > 0);
  const visibleAdminGroups = capability.isAdminLike ? pruneGroups(adminNavGroups) : [];
  // Administrators work from the operating console; only the communication entry remains shared to prevent duplicated device and reservation menus.
  const visibleNavGroups = capability.isAdminLike
    ? [...visibleAdminGroups, ...navGroups.map((group) => ({ ...group, items: group.items.filter((item) => item.to === '/chat') })).filter((group) => group.items.length > 0)]
    : navGroups;
  const roleLabel = capability.isSuperAdmin ? '系统管理员' : capability.isAdminLike ? '运营权限已启用' : '服务账号';
  useEffect(() => {
    document.documentElement.dataset.ambient = ambient;
    document.documentElement.style.colorScheme = ambient === 'night' ? 'dark' : 'light';
    // Keep legacy data-theme in sync for residual styles that still target it.
    if (ambient === 'night') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    window.localStorage.setItem('IDBS_AMBIENT', ambient);
  }, [ambient]);

  useEffect(() => {
    if (!auth.isLoggedIn) {
      setNotice(null);
      return;
    }
    if (!latestNotice?.enabled || !String(latestNotice.content || '').trim() || isSystemNoticeRead(latestNotice)) {
      setNotice(null);
      return;
    }
    setNotice(latestNotice);
  }, [auth.isLoggedIn, latestNotice]);

  function closeNotice() {
    if (!notice) return;
    markSystemNoticeRead(notice);
    setNotice(null);
  }

  function closeNoticeByBackdrop(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) closeNotice();
  }

  useEffect(() => {
    if (!notice) return undefined;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') closeNotice();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [notice]);

  if (!auth.isReady || !auth.isLoggedIn) return <RequireAuth />;

  return (
    <div className="ops-layout-shell relative min-h-svh w-full bg-background text-sm text-foreground">
      {notice && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={notice.title || '使用注意事项'}
          onClick={closeNoticeByBackdrop}
        >
          <div className="ops-dialog-surface w-full max-w-lg p-6" onClick={(event) => event.stopPropagation()}>
            <p className="ops-dialog-kicker">系统通知</p>
            <h2 className="mt-2 text-lg font-semibold">{notice.title || '使用注意事项'}</h2>
            <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{notice.content}</div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={closeNotice}>稍后再说</Button>
              <Button onClick={closeNotice}>我已了解，确认</Button>
            </div>
          </div>
        </div>
      )}

      {!collapsed ? <button type="button" aria-label="关闭导航" className="fixed inset-0 z-30 bg-slate-950/20 md:hidden" onClick={() => setCollapsed(true)} /> : null}
      <aside className={cn('ops-sidebar fixed inset-y-0 left-0 z-40 flex w-[220px] flex-col transition-transform duration-200 ease-out', collapsed ? '-translate-x-full' : 'translate-x-0')}>
        <div className="ops-sidebar-brand flex h-[56px] items-center px-4">
          {!collapsed ? (
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="ops-brand-mark relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden">
                <span className="ops-brand-mark-glow absolute inset-x-0 top-0 h-1/2" />
                <GalleryVerticalEnd className="relative h-4 w-4" />
              </span>
              <div className="min-w-0 leading-tight">
                <span className="ops-brand-title block truncate text-[14px] font-semibold">设备预约系统</span>
                <span className="ops-brand-subtitle mt-0.5 block text-[11px]">实验室管理</span>
              </div>
            </div>
          ) : (
            <span className="ops-brand-mark mx-auto flex h-8 w-8 items-center justify-center"><GalleryVerticalEnd className="h-4 w-4" /></span>
          )}
        </div>

        <nav className="ops-sidebar-nav flex-1 overflow-y-auto px-2.5 py-3">
          {visibleNavGroups.map((group) => (
            <div key={group.label} className="mb-5">
              {!collapsed && (
                <p className="ops-nav-group-label px-2 pb-2 text-[11px] font-semibold tracking-[0.08em]">{group.label}</p>
              )}
              <ul className="space-y-1">
                {group.items.map((item) => (
                  <li key={item.to}>
                    <Link
                      to={item.to as any}
                      className={cn(
                        'ops-nav-item flex items-center gap-2.5 px-2.5 py-2 text-[13px] font-medium',
                        isActive(item.to) && 'ops-nav-item-active',
                        collapsed && 'justify-center'
                      )}
                      title={item.title}
                      onClick={() => { if (window.innerWidth < 768) setCollapsed(true); }}
                    >
                      {item.icon}
                      {!collapsed && <span>{item.title}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="ops-sidebar-footer p-3">
          <div className="ops-user-panel flex items-center gap-2.5 rounded-xl px-2.5 py-2.5">
            <div className="ops-user-avatar flex h-9 w-9 items-center justify-center rounded-full">
              <UserRound className="h-4 w-4" />
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1 text-xs">
                <p className="ops-user-name truncate font-semibold">{auth.me?.name || '用户'}</p>
                <p className="ops-user-role truncate">
                  {roleLabel}
                </p>
              </div>
            )}
          </div>
        </div>
      </aside>

      <div className={cn('ops-content-shell flex min-h-svh min-w-0 flex-1 flex-col transition-[padding] duration-200 ease-out', !collapsed && 'md:pl-[220px]')}>
        <header className="ops-topbar sticky top-0 z-30 flex h-[52px] items-center gap-3 px-4 md:px-5">
          <Button variant="ghost" size="icon" onClick={() => setCollapsed((v) => !v)} aria-label={collapsed ? "打开导航" : "关闭导航"} title={collapsed ? "打开导航" : "关闭导航"}>
            <ChevronLeft className={cn('h-4 w-4 transition-transform', collapsed && 'rotate-180')} />
          </Button>
          <Breadcrumb pathname={location.pathname} />
          <div className="ops-topbar-tools ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setAmbient((value) => value === 'night' ? 'day' : 'night')}
              aria-label={ambient === 'night' ? '\u5207\u6362\u4e3a\u767d\u5929\u80cc\u666f' : '\u5207\u6362\u4e3a\u591c\u95f4\u80cc\u666f'}
              title={ambient === 'night' ? '\u5207\u6362\u4e3a\u767d\u5929\u80cc\u666f' : '\u5207\u6362\u4e3a\u591c\u95f4\u80cc\u666f'}
            >
              {ambient === 'night' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Link to={'/notifications' as any} aria-label="通知" className="ops-topbar-action inline-flex h-9 w-9 items-center justify-center rounded-lg">
              <Bell className="h-4 w-4" />
            </Link>
            <Button variant="ghost" size="icon" aria-label="退出登录" title="退出登录" onClick={() => auth.logout()}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </header>
        <main className="ops-page-area flex-1 overflow-y-auto">
          <div className="ops-main">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}




