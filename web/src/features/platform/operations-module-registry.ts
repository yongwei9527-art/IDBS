import { BACKEND_ENTRY_PERMISSIONS, PERMISSIONS } from '@/features/auth/permissions';

export interface AdminModuleRegistration {
  group: string;
  title: string;
  path: string;
  anyPermissions: string[];
  superOnly?: boolean;
}

/**
 * 5.0 administrator console registry.
 * Navigation visibility and route access both read this registry.
 */
export const ADMIN_MODULES: AdminModuleRegistration[] = [
  { group: '\u8fd0\u8425\u5de5\u5177', title: '\u603b\u89c8', path: '/admin/dashboard', anyPermissions: BACKEND_ENTRY_PERMISSIONS },
  { group: '\u8fd0\u8425\u534f\u4f5c', title: '\u8bbe\u5907\u53f0\u8d26', path: '/admin/devices', anyPermissions: [PERMISSIONS.DEVICE_VIEW, PERMISSIONS.DEVICE_MANAGE] },
  { group: '\u8fd0\u8425\u534f\u4f5c', title: '\u9884\u7ea6\u5ba1\u6279', path: '/admin/reservations', anyPermissions: [PERMISSIONS.RESERVATION_VIEW, PERMISSIONS.RESERVATION_APPROVE, PERMISSIONS.RESERVATION_CHANGE_PLAN] },
  { group: '\u8fd0\u8425\u5904\u7406', title: '\u7528\u6237\u7ba1\u7406', path: '/admin/users', anyPermissions: [PERMISSIONS.USER_APPROVE, PERMISSIONS.USER_MANAGE] },
  { group: '\u8fd0\u8425\u5904\u7406', title: '\u6545\u969c\u5904\u7f6e', path: '/admin/faults', anyPermissions: [PERMISSIONS.DEVICE_VIEW, PERMISSIONS.DEVICE_MANAGE, PERMISSIONS.FAULT_MANAGE] },
  { group: '\u8fd0\u8425\u5904\u7406', title: '\u8bbe\u5907\u7ef4\u62a4', path: '/admin/maintenance', anyPermissions: [PERMISSIONS.DEVICE_VIEW, PERMISSIONS.DEVICE_MANAGE, PERMISSIONS.FAULT_MANAGE] },
  { group: '\u8fd0\u8425\u5904\u7406', title: '\u8bc9\u6c42\u5904\u7406', path: '/admin/requests', anyPermissions: [PERMISSIONS.USER_MANAGE, PERMISSIONS.RESERVATION_VIEW, PERMISSIONS.RESERVATION_APPROVE] },
  { group: '\u6570\u636e\u4e0e\u5206\u6790', title: '\u8fd0\u8425\u5206\u6790', path: '/admin/stats', anyPermissions: [PERMISSIONS.STATS_VIEW] },
  { group: '\u6570\u636e\u4e0e\u5206\u6790', title: '\u6587\u6863\u5bfc\u51fa', path: '/admin/export', anyPermissions: [PERMISSIONS.STATS_EXPORT] },
  { group: '\u7cfb\u7edf', title: '\u7cfb\u7edf\u914d\u7f6e', path: '/admin/system', anyPermissions: [], superOnly: true },
  { group: '\u7cfb\u7edf', title: '\u64cd\u4f5c\u5ba1\u8ba1', path: '/admin/audit', anyPermissions: [PERMISSIONS.AUDIT_VIEW] }
];

export function getAdminModule(path: string) {
  return ADMIN_MODULES.find((module) => module.path === path);
}
