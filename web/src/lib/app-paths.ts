/** Central path constants for hand-written TanStack routes (basepath /v5 is handled by router). */
export const APP_PATHS = {
  home: '/',
  login: '/login',
  passwordResetRequired: '/password-reset-required',
  devices: '/devices',
  deviceDetail: '/devices/$code',
  calendar: '/calendar',
  calendarDay: '/calendar/$date',
  reserve: '/reserve',
  myReservations: '/my-reservations',
  myProfile: '/me/profile',
  materialRequests: '/materials',
  borrow: '/borrow',
  notifications: '/notifications',
  chat: '/chat',
  chatDetail: '/chat/$id',
  adminDashboard: '/admin/dashboard',
  adminDevices: '/admin/devices',
  adminReservations: '/admin/reservations',
  adminUsers: '/admin/users',
  adminFaults: '/admin/faults',
  adminMaintenance: '/admin/maintenance',
  adminRequests: '/admin/requests',
  adminStats: '/admin/stats',
  adminExport: '/admin/export',
  adminSystem: '/admin/system',
  adminAudit: '/admin/audit'
} as const;

export type AppPath = (typeof APP_PATHS)[keyof typeof APP_PATHS];

export function loginWithRedirect(redirectPath: string): string {
  const cleaned = redirectPath.startsWith('/') ? redirectPath : `/${redirectPath}`;
  return `${APP_PATHS.login}?redirect=${encodeURIComponent(cleaned)}`;
}
