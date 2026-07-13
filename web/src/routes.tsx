import { createRootRouteWithContext, createRoute, redirect, Outlet, Link } from '@tanstack/react-router';
import { lazyRouteComponent } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import type { ComponentType } from 'react';
import { RequirePermission, RequireSuperAdmin } from './features/auth/permissions';
import { getAdminModule } from './features/platform/operations-module-registry';

const LoginPage = lazyRouteComponent(() => import('./features/auth/login-page'), 'LoginPage');
const AppLayout = lazyRouteComponent(() => import('./features/layout/app-layout'), 'AppLayout');
const AdminDashboardPage = lazyRouteComponent(() => import('./features/analytics/operations-dashboard-page'), 'AdminDashboardPage');
const AdminDevicesPage = lazyRouteComponent(() => import('./features/equipment/equipment-management-page'), 'AdminDevicesPage');
const AdminReservationsPage = lazyRouteComponent(() => import('./features/reservation/reservation-approval-page'), 'AdminReservationsPage');
const AdminUsersPage = lazyRouteComponent(() => import('./features/users/user-access-management-page'), 'AdminUsersPage');
const AdminFaultsPage = lazyRouteComponent(() => import('./features/equipment/fault-return-workbench-page'), 'AdminFaultsPage');
const AdminMaintenancePage = lazyRouteComponent(() => import('./features/equipment/maintenance-management-page'), 'AdminMaintenancePage');
const AdminRequestsPage = lazyRouteComponent(() => import('./features/support/user-request-management-page'), 'AdminRequestsPage');
const AdminStatsPage = lazyRouteComponent(() => import('./features/analytics/operations-analysis-page'), 'AdminStatsPage');
const AdminExportPage = lazyRouteComponent(() => import('./features/analytics/export-center-page'), 'AdminExportPage');
const AdminSystemPage = lazyRouteComponent(() => import('./features/system/system-configuration-page'), 'AdminSystemPage');
const AdminAuditPage = lazyRouteComponent(() => import('./features/system/operation-audit-page'), 'AdminAuditPage');
const NotificationPage = lazyRouteComponent(() => import('./features/notification/notification-page'), 'NotificationPage');
const ChatConversationList = lazyRouteComponent(() => import('./features/chat/chat-page'), 'ChatConversationList');
const ChatDetailPage = lazyRouteComponent(() => import('./features/chat/chat-detail-page'), 'ChatDetailPage');
const DevicesPage = lazyRouteComponent(() => import('./features/devices/devices-page'), 'DevicesPage');
const DeviceDetailPage = lazyRouteComponent(() => import('./features/devices/device-detail-page'), 'DeviceDetailPage');
const ReservePage = lazyRouteComponent(() => import('./features/reservation/reserve-page'), 'ReservePage');
const MyReservationsPage = lazyRouteComponent(() => import('./features/reservation/my-reservations-page'), 'MyReservationsPage');
const CalendarPage = lazyRouteComponent(() => import('./features/reservation/calendar-page'), 'CalendarPage');
const CalendarDetailPage = lazyRouteComponent(() => import('./features/reservation/calendar-detail-page'), 'CalendarDetailPage');
const BorrowIndexPage = lazyRouteComponent(() => import('./features/borrow/borrow-page'), 'BorrowIndexPage');
const FaultPage = lazyRouteComponent(() => import('./features/fault/fault-page'), 'FaultPage');
const StaffContactsPage = lazyRouteComponent(() => import('./features/support/staff-contacts-page'), 'StaffContactsPage');

interface RouterContext {
  queryClient: QueryClient;
}

function NotFoundPage() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-muted p-6">
      <div className="w-full max-w-md rounded-[var(--radius-lg)] border bg-card p-6 text-center shadow-sm">
        <p className="text-xs font-black uppercase tracking-wider text-primary">IDBS 5.0</p>
        <h1 className="mt-2 text-2xl font-bold">页面不存在</h1>
        <p className="mt-2 text-sm text-muted-foreground">这个地址没有对应的新版本页面，可能是链接过期或路径输入有误。</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Link className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground" to={'/devices' as any}>
            返回设备列表
          </Link>
        </div>
      </div>
    </div>
  );
}

function withPermission(component: ComponentType, any: string[], description?: string) {
  const Page = component;
  return function ProtectedAdminPage() {
    return (
      <RequirePermission any={any} description={description}>
        <Page />
      </RequirePermission>
    );
  };
}

function withAdminModule(component: ComponentType, path: string, description?: string) {
  const module = getAdminModule(path);
  if (!module) throw new Error(`Missing administrator module registration for ${path}`);
  return withPermission(component, module.anyPermissions, description);
}

function withSuperAdmin(component: ComponentType, description?: string) {
  const Page = component;
  return function ProtectedSuperAdminPage() {
    return (
      <RequireSuperAdmin description={description}>
        <Page />
      </RequireSuperAdmin>
    );
  };
}

function buildRouteTree() {
  const rootRoute = createRootRouteWithContext<RouterContext>()({
    component: Outlet,
    notFoundComponent: NotFoundPage
  });

  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    beforeLoad: () => {
      throw redirect({ to: '/login' });
    },
    component: () => null
  });
  const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: '/login', component: LoginPage });
  const appLayout = createRoute({ getParentRoute: () => rootRoute, id: '_app', component: AppLayout });

  const children = [
    { path: '/admin/dashboard', component: withAdminModule(AdminDashboardPage, '/admin/dashboard', '后台总览会按已授予权限展示可用模块。') },
    { path: '/admin/devices', component: withAdminModule(AdminDevicesPage, '/admin/devices', '设备台账会按授权展示查看与维护功能。') },
    { path: '/admin/reservations', component: withAdminModule(AdminReservationsPage, '/admin/reservations', '预约审批中枢按预约查看、审批或改期授权开放，具体操作继续按权限控制。') },
    { path: '/admin/users', component: withAdminModule(AdminUsersPage, '/admin/users', '用户与授权管理仅对被授予用户管理权限的管理员开放。') },
    { path: '/admin/faults', component: withAdminModule(AdminFaultsPage, '/admin/faults', '故障和归还复核需要设备查看、故障处理或归还处理权限。') },
    { path: '/admin/maintenance', component: withAdminModule(AdminMaintenancePage, '/admin/maintenance', '\u7ef4\u62a4\u8ba1\u5212\u4e0e\u5de5\u5355\u9700\u8981\u8bbe\u5907\u67e5\u770b\u3001\u8bbe\u5907\u7ef4\u62a4\u6216\u6545\u969c\u7ba1\u7406\u6743\u9650\u3002') },
    { path: '/admin/requests', component: withAdminModule(AdminRequestsPage, '/admin/requests', '诉求中心需要用户管理、预约查看或预约审批权限。') },
    { path: '/admin/stats', component: withAdminModule(AdminStatsPage, '/admin/stats', '统计分析需要统计查看权限。') },
    { path: '/admin/export', component: withAdminModule(AdminExportPage, '/admin/export', '导出中心需要导出授权，并会按业务类型继续匹配相应权限。') },
    { path: '/admin/system', component: withSuperAdmin(AdminSystemPage, '系统配置、角色授权、管理员密码、微信和安全策略仅最高权限管理员可访问。') },
    { path: '/admin/audit', component: withAdminModule(AdminAuditPage, '/admin/audit', '操作审计需要安全与审计查看权限。') },
    { path: '/notifications', component: NotificationPage },
    { path: '/chat', component: ChatConversationList },
    { path: '/chat/$id', component: ChatDetailPage },
    { path: '/devices', component: DevicesPage },
    { path: '/devices/$code', component: DeviceDetailPage },
    { path: '/reserve', component: ReservePage },
    { path: '/me/reservations', component: MyReservationsPage },
    { path: '/calendar', component: CalendarPage },
    { path: '/calendar/$date', component: CalendarDetailPage },
    { path: '/borrow', component: BorrowIndexPage },
    { path: '/faults', component: FaultPage },
    { path: '/support/contacts', component: StaffContactsPage }
  ].map(({ path, component }) => createRoute({ getParentRoute: () => appLayout, path, component }));

  return rootRoute.addChildren([indexRoute, loginRoute, appLayout.addChildren(children)]);
}

export const routes = buildRouteTree();


