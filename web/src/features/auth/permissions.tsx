import { Navigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useAuth } from './use-auth';
import { APP_PATHS } from '@/lib/app-paths';

export const PERMISSIONS = {
  STATS_VIEW: 'stats.view',
  STATS_EXPORT: 'stats.export',
  USER_APPROVE: 'user.approve',
  USER_MANAGE: 'user.manage',
  AUDIT_VIEW: 'audit.view',
  DEVICE_VIEW: 'device.view',
  DEVICE_MANAGE: 'device.manage',
  FAULT_MANAGE: 'fault.manage',
  RESERVATION_VIEW: 'reservation.view',
  RESERVATION_APPROVE: 'reservation.approve',
  RESERVATION_CHANGE_PLAN: 'reservation.change_plan',
  RETURN_VIEW: 'return.view',
  RETURN_CONFIRM: 'return.confirm',
  RETURN_IMAGE_REVIEW: 'return.image_review',
  RETURN_EXPORT: 'return.export'
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const BACKEND_ENTRY_PERMISSIONS = [
  PERMISSIONS.STATS_VIEW,
  PERMISSIONS.STATS_EXPORT,
  PERMISSIONS.USER_APPROVE,
  PERMISSIONS.USER_MANAGE,
  PERMISSIONS.AUDIT_VIEW,
  PERMISSIONS.DEVICE_VIEW,
  PERMISSIONS.DEVICE_MANAGE,
  PERMISSIONS.FAULT_MANAGE,
  PERMISSIONS.RESERVATION_VIEW,
  PERMISSIONS.RESERVATION_APPROVE,
  PERMISSIONS.RESERVATION_CHANGE_PLAN,
  PERMISSIONS.RETURN_VIEW,
  PERMISSIONS.RETURN_CONFIRM,
  PERMISSIONS.RETURN_IMAGE_REVIEW,
  PERMISSIONS.RETURN_EXPORT
];

export const PERMISSION_LABELS: Record<string, string> = {
  super_admin: '最高权限管理员',
  '*': '全部权限',
  [PERMISSIONS.STATS_VIEW]: '查看运营统计',
  [PERMISSIONS.STATS_EXPORT]: '导出统计文档',
  [PERMISSIONS.USER_APPROVE]: '审核用户注册',
  [PERMISSIONS.USER_MANAGE]: '用户审核与账号维护',
  [PERMISSIONS.AUDIT_VIEW]: '查看操作审计日志',
  [PERMISSIONS.DEVICE_VIEW]: '查看设备与故障',
  [PERMISSIONS.DEVICE_MANAGE]: '维护设备资产',
  [PERMISSIONS.FAULT_MANAGE]: '处理故障与异常归还',
  [PERMISSIONS.RESERVATION_VIEW]: '查看预约计划',
  [PERMISSIONS.RESERVATION_APPROVE]: '审批 / 驳回预约计划',
  [PERMISSIONS.RESERVATION_CHANGE_PLAN]: '调整用户预约时间',
  [PERMISSIONS.RETURN_VIEW]: '查看归还记录',
  [PERMISSIONS.RETURN_CONFIRM]: '确认设备归还',
  [PERMISSIONS.RETURN_IMAGE_REVIEW]: '复核归还图片',
  [PERMISSIONS.RETURN_EXPORT]: '导出归还归档'
};


export function hasWildcardPermission(permissions: string[] = []) {
  return permissions.includes('*');
}

export function isSuperAdminLike(role: string | null | undefined, permissions: string[] = []) {
  return role === 'super_admin' || hasWildcardPermission(permissions);
}

export function hasPermission(role: string | null | undefined, permissions: string[] = [], permission: string) {
  return isSuperAdminLike(role, permissions) || permissions.includes(permission);
}

export function getAdminLandingPath(role: string | null | undefined, permissions: string[] = []) {
  if (isSuperAdminLike(role, permissions) || permissions.includes(PERMISSIONS.STATS_VIEW)) return '/admin/dashboard';
  if (permissions.includes(PERMISSIONS.DEVICE_VIEW) || permissions.includes(PERMISSIONS.DEVICE_MANAGE)) return APP_PATHS.adminDevices;
  if (permissions.some((permission) => permission === PERMISSIONS.RESERVATION_VIEW || permission === PERMISSIONS.RESERVATION_APPROVE || permission === PERMISSIONS.RESERVATION_CHANGE_PLAN)) return '/admin/reservations';
  if (permissions.some((permission) => permission === PERMISSIONS.USER_APPROVE || permission === PERMISSIONS.USER_MANAGE)) return '/admin/users';
  if (permissions.some((permission) => permission === PERMISSIONS.DEVICE_MANAGE || permission === PERMISSIONS.FAULT_MANAGE || permission === PERMISSIONS.RETURN_VIEW || permission === PERMISSIONS.RETURN_CONFIRM || permission === PERMISSIONS.RETURN_IMAGE_REVIEW)) return '/admin/faults';
  if (permissions.includes(PERMISSIONS.STATS_EXPORT)) return '/admin/export';
  if (permissions.includes(PERMISSIONS.AUDIT_VIEW)) return '/admin/audit';
  return APP_PATHS.devices;
}

export function useCapability() {
  const auth = useAuth();
  const can = (permission: string) => auth.hasPerm(permission);
  const canAny = (permissions: string[]) => permissions.some((permission) => can(permission));
  const canAll = (permissions: string[]) => permissions.every((permission) => can(permission));
  const isSuperAdmin = isSuperAdminLike(auth.role, auth.permissions);
  const isAdminLike = isSuperAdmin || auth.permissions.length > 0;

  return {
    ...auth,
    can,
    canAny,
    canAll,
    isSuperAdmin,
    isAdminLike,
    canViewAdmin: isAdminLike,
    canViewDashboard: isAdminLike,
    canViewStats: can(PERMISSIONS.STATS_VIEW),
    canExportStats: can(PERMISSIONS.STATS_EXPORT),
    canApproveUsers: canAny([PERMISSIONS.USER_APPROVE, PERMISSIONS.USER_MANAGE]),
    canManageUsers: can(PERMISSIONS.USER_MANAGE),
    canViewAudit: can(PERMISSIONS.AUDIT_VIEW),
    canViewDevices: canAny([PERMISSIONS.DEVICE_VIEW, PERMISSIONS.DEVICE_MANAGE]),
    canManageDevices: can(PERMISSIONS.DEVICE_MANAGE),
    canViewFaults: canAny([PERMISSIONS.DEVICE_VIEW, PERMISSIONS.DEVICE_MANAGE, PERMISSIONS.FAULT_MANAGE]),
    canManageFaults: canAny([PERMISSIONS.DEVICE_MANAGE, PERMISSIONS.FAULT_MANAGE]),
    canViewReservations: canAny([PERMISSIONS.RESERVATION_VIEW, PERMISSIONS.RESERVATION_APPROVE, PERMISSIONS.RESERVATION_CHANGE_PLAN]),
    canApproveReservations: can(PERMISSIONS.RESERVATION_APPROVE),
    canChangeReservationPlan: can(PERMISSIONS.RESERVATION_CHANGE_PLAN),
    canViewReturns: canAny([PERMISSIONS.RETURN_VIEW, PERMISSIONS.RETURN_CONFIRM, PERMISSIONS.RETURN_IMAGE_REVIEW]),
    canViewReturnArchive: canAny([PERMISSIONS.RETURN_VIEW, PERMISSIONS.RETURN_CONFIRM, PERMISSIONS.RETURN_IMAGE_REVIEW, PERMISSIONS.RETURN_EXPORT]),
    canConfirmReturns: can(PERMISSIONS.RETURN_CONFIRM),
    canReviewReturnImages: can(PERMISSIONS.RETURN_IMAGE_REVIEW),
    canExportReturns: can(PERMISSIONS.RETURN_EXPORT),
    adminLandingPath: getAdminLandingPath(auth.role, auth.permissions)
  };
}


function unavailableDestination(adminLandingPath: string) {
  return adminLandingPath.startsWith('/admin') ? adminLandingPath : '/devices';
}
export function RequirePermission({
  any,
  all,
  children
}: {
  any?: string[];
  all?: string[];
  children: ReactNode;
  title?: string;
  description?: string;
}) {
  const capability = useCapability();
  const passAny = !any?.length || capability.canAny(any);
  const passAll = !all?.length || capability.canAll(all);
  if (!capability.isLoggedIn) return null;
  if (!capability.isAdminLike) return <Navigate to={APP_PATHS.devices as any} replace />;
  if (passAny && passAll) return <>{children}</>;
  return <Navigate to={unavailableDestination(capability.adminLandingPath) as any} replace />;
}

export function RequireSuperAdmin({
  children
}: {
  children: ReactNode;
  title?: string;
  description?: string;
}) {
  const capability = useCapability();
  if (!capability.isLoggedIn) return null;
  if (!capability.isAdminLike) return <Navigate to={APP_PATHS.devices as any} replace />;
  if (capability.isSuperAdmin) return <>{children}</>;
  return <Navigate to={unavailableDestination(capability.adminLandingPath) as any} replace />;
}






