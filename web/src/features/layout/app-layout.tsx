import { type ReactNode, useEffect, useState } from 'react';
import { Outlet, Link, useLocation } from '@tanstack/react-router';
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
  MonitorSmartphone,
  UserRound,
  Wrench
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { request } from '@/lib/api';

interface NavItem {
  title: string;
  to: string;
  icon: ReactNode;
  anyPerm?: string[];
  allPerm?: string[];
  adminOnly?: boolean;
  superOnly?: boolean;
}

interface SystemNotice {
  enabled?: boolean;
  title?: string;
  content?: string;
  version?: string | number;
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
  maintenance: '\u8bbe\u5907\u7ef4\u62a4',
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
    <nav className="flex items-center text-sm text-muted-foreground">
      {seg.length === 0 ? (
        <span>首页</span>
      ) : (
        seg.map((s, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span className="px-1">/</span>}
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
  const location = useLocation();
  const auth = useAuth();
  const capability = useCapability();

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
  const noticeVersion = String(notice?.version || '1');

  useEffect(() => {
    if (!auth.isLoggedIn) {
      setNotice(null);
      return;
    }
    let cancelled = false;
    request<{ notice?: SystemNotice }>('/system/notice')
      .then((data) => {
        if (cancelled) return;
        const next = data?.notice;
        if (!next?.enabled || !next.content) return;
        const key = `IDBS_NOTICE_CLOSED_${String(next.version || '1')}`;
        if (localStorage.getItem(key) === '1') return;
        setNotice(next);
      })
      .catch(() => {
        // 系统提醒不能阻断主流程。
      });
    return () => {
      cancelled = true;
    };
  }, [auth.isLoggedIn]);

  function closeNotice() {
    localStorage.setItem(`IDBS_NOTICE_CLOSED_${noticeVersion}`, '1');
    setNotice(null);
  }

  if (!auth.isReady || !auth.isLoggedIn) return <RequireAuth />;

  return (
    <div className="ops-layout-shell relative min-h-svh w-full bg-background text-sm text-foreground">
      {notice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-[var(--radius-lg)] border border-cyan-200/15 bg-[#0b1a30]/95 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop-blur-xl">
            <p className="font-mono text-xs font-medium uppercase tracking-[0.16em] text-cyan-100">SYSTEM NOTICE</p>
            <h2 className="mt-2 text-lg font-semibold">{notice.title || '使用注意事项'}</h2>
            <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{notice.content}</div>
            <div className="mt-5 flex justify-end">
              <Button onClick={closeNotice}>我已了解，确认</Button>
            </div>
          </div>
        </div>
      )}

      {!collapsed ? <button type="button" aria-label="关闭导航" className="fixed inset-0 z-30 bg-slate-950/20 md:hidden" onClick={() => setCollapsed(true)} /> : null}
      <aside className={cn('fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-cyan-200/12 bg-[#07152a]/95 text-slate-100 shadow-[14px_0_60px_rgba(0,0,0,0.42)] backdrop-blur-xl [background-image:radial-gradient(circle_at_0%_0%,rgba(56,189,248,0.09),transparent_28%),radial-gradient(circle_at_90%_12%,rgba(139,92,246,0.06),transparent_25%),linear-gradient(180deg,rgba(9,25,48,0.96),rgba(5,15,30,0.98))] transition-transform duration-300 ease-out', collapsed ? '-translate-x-full' : 'translate-x-0')}>
        <div className="flex h-24 items-center border-b border-cyan-200/12 px-5">
          {!collapsed ? (
            <div className="flex min-w-0 items-center gap-3.5">
              <span className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-cyan-200/20 bg-cyan-300/[0.07] text-cyan-100 shadow-[0_0_26px_rgba(56,189,248,0.10)]">
                <span className="absolute inset-x-0 top-0 h-1/2 bg-cyan-200/12" />
                <GalleryVerticalEnd className="relative h-5 w-5" />
              </span>
              <div className="min-w-0 leading-tight">
                <span className="block truncate text-[17px] font-black tracking-tight text-slate-50">IDBS <em className="not-italic text-cyan-100">5.0</em></span>
                <span className="mt-1 block font-mono text-[10px] font-bold tracking-[0.14em] text-slate-300/70">INTELLIGENT OPERATIONS</span>
              </div>
            </div>
          ) : (
            <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-2xl border border-cyan-200/20 bg-cyan-300/[0.07] text-cyan-100"><GalleryVerticalEnd className="h-5 w-5" /></span>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-5">
          {visibleNavGroups.map((group) => (
            <div key={group.label} className="mb-5">
              {!collapsed && (
                <p className="flex items-center justify-between px-2 pb-2 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">
                  <span>{group.label}</span>
                  {group.label !== '服务' && <span className="rounded-full border border-cyan-200/12 bg-cyan-300/[0.07] px-1.5 py-0.5 text-[10px] tabular-nums text-slate-300">{group.items.length}</span>}
                </p>
              )}
              <ul className="space-y-1">
                {group.items.map((item) => (
                  <li key={item.to}>
                    <Link
                      to={item.to as any}
                      className={cn(
                        'flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-300 transition-all hover:bg-cyan-300/[0.07] hover:text-cyan-100',
                        isActive(item.to) && 'border border-cyan-200/15 bg-gradient-to-r from-cyan-400/14 to-violet-400/[0.08] text-slate-100 shadow-[inset_2px_0_0_rgb(125,211,252),0_0_16px_rgba(56,189,248,0.06)] hover:bg-cyan-300/[0.11] hover:text-white',
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

        <div className="border-t border-cyan-200/12 p-4">
          <div className="flex items-center gap-2.5 rounded-2xl border border-cyan-200/12 bg-cyan-300/[0.035] px-2.5 py-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-cyan-200/18 bg-cyan-300/[0.07] text-cyan-100 shadow-[0_0_18px_rgba(56,189,248,0.07)]">
              <UserRound className="h-4 w-4" />
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1 text-xs">
                <p className="truncate font-semibold text-white">{auth.me?.name || '用户'}</p>
                <p className="truncate text-slate-400">
                  {roleLabel}
                </p>
              </div>
            )}
          </div>
        </div>
      </aside>

      <div className={cn('flex min-h-svh min-w-0 flex-1 flex-col bg-background transition-[padding] duration-300 ease-out', !collapsed && 'md:pl-72')}>
        <header className="sticky top-0 z-30 flex h-[76px] items-center gap-3 border-b border-cyan-200/12 bg-[#071221]/78 px-4 backdrop-blur-xl md:px-7">
          <Button variant="ghost" size="icon" onClick={() => setCollapsed((v) => !v)} aria-label={collapsed ? "打开导航" : "关闭导航"} title={collapsed ? "打开导航" : "关闭导航"}>
            <ChevronLeft className={cn('h-4 w-4 transition-transform', collapsed && 'rotate-180')} />
          </Button>
          <Breadcrumb pathname={location.pathname} />
          <div className="ml-auto flex items-center gap-2">
            <Link to={'/notifications' as any} aria-label="通知" className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-cyan-300/[0.07] hover:text-cyan-100">
              <Bell className="h-4 w-4" />
            </Link>
            <Button variant="ghost" size="icon" aria-label="退出登录" title="退出登录" onClick={() => auth.logout()}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-7">
          <div className="ops-main">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}




