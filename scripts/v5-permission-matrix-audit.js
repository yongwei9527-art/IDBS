#!/usr/bin/env node
/* Real V5 permission matrix audit for the local demonstration database. */
const fs = require('fs');
const path = require('path');

const BASE = (process.env.V5_AUDIT_BASE || process.env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const API = BASE + '/api/v5';
const REPORT_PATH = process.env.V5_AUDIT_REPORT_PATH || path.join(process.cwd(), 'backups', 'reports', 'v5-permission-matrix-report.json');

const P = {
  STATS_VIEW: 'stats.view', STATS_EXPORT: 'stats.export', USER_APPROVE: 'user.approve', USER_MANAGE: 'user.manage', AUDIT_VIEW: 'audit.view',
  DEVICE_VIEW: 'device.view', DEVICE_MANAGE: 'device.manage', FAULT_MANAGE: 'fault.manage',
  RESERVATION_VIEW: 'reservation.view', RESERVATION_APPROVE: 'reservation.approve', RESERVATION_CHANGE_PLAN: 'reservation.change_plan',
  RETURN_VIEW: 'return.view', RETURN_CONFIRM: 'return.confirm', RETURN_IMAGE_REVIEW: 'return.image_review', RETURN_EXPORT: 'return.export'
};
const ADMIN_ENTRY = Object.values(P);
const ACCOUNTS = [
  { key: 'super_admin', label: 'Super administrator', phone: '13900000000', password: '123456', expectAdmin: true },
  { key: 'no_reservation_approval', label: 'Administrator without reservation approval', phone: '13900000010', password: '123456', expectAdmin: true },
  { key: 'reservation_admin', label: 'Reservation administrator', phone: '13900000011', password: '123456', expectAdmin: true },
  { key: 'fault_admin', label: 'Fault administrator', phone: '13900000012', password: '123456', expectAdmin: true },
  { key: 'data_auditor', label: 'Data auditor', phone: '13900000013', password: '123456', expectAdmin: true },
  { key: 'normal_user', label: 'Normal user', phone: '13800000002', password: '123456', expectAdmin: false }
];
const CHECKS = [
  { name: 'dashboard', path: '/admin/dashboard', any: ADMIN_ENTRY },
  { name: 'devices', path: '/admin/devices', any: [P.DEVICE_VIEW, P.DEVICE_MANAGE] },
  { name: 'reservations', path: '/admin/reservations', any: [P.RESERVATION_VIEW, P.RESERVATION_APPROVE, P.RESERVATION_CHANGE_PLAN] },
  { name: 'users', path: '/admin/users', any: [P.USER_APPROVE, P.USER_MANAGE] },
  { name: 'fault reports', path: '/admin/fault-reports', any: [P.DEVICE_VIEW, P.DEVICE_MANAGE, P.FAULT_MANAGE] },
  { name: 'user requests', path: '/admin/user-requests', any: [P.USER_MANAGE, P.RESERVATION_VIEW, P.RESERVATION_APPROVE] },
  { name: 'analytics', path: '/admin/analytics/overview', any: [P.STATS_VIEW] },
  { name: 'audit logs', path: '/admin/audit/operation-logs', any: [P.AUDIT_VIEW] },
  { name: 'system configuration', path: '/admin/system/security-config', superOnly: true }
];
function canUse(account, check) {
  if (account.permissions.includes('*')) return true;
  if (check.superOnly) return false;
  return (check.any || []).some((permission) => account.permissions.includes(permission));
}
async function request(pathname, options = {}) {
  const response = await fetch(API + pathname, { method: options.method || 'GET', headers: { 'Content-Type': 'application/json', ...(options.token ? { Authorization: 'Bearer ' + options.token } : {}) }, body: options.body ? JSON.stringify(options.body) : undefined });
  const raw = await response.text();
  let body; try { body = raw ? JSON.parse(raw) : null; } catch (_) { body = raw; }
  return { status: response.status, body, raw };
}
async function login(item) {
  const result = await request('/auth/login', { method: 'POST', body: { phone: item.phone, password: item.password } });
  const data = result.body && result.body.data;
  if (result.status !== 200 || !data || !data.access_token) throw new Error(item.label + ' login failed: ' + (result.raw || result.status));
  const me = await request('/me', { token: data.access_token });
  const info = me.body && me.body.data;
  if (me.status !== 200 || !info) throw new Error(item.label + ' /auth/me failed');
  return { ...item, token: data.access_token, role: info.role || data.role || '', permissions: Array.isArray(info.permissions) ? info.permissions : [] };
}
async function main() {
  const health = await fetch(BASE + '/ready');
  if (!health.ok) throw new Error('Local service is not ready: ' + health.status);
  const accounts = [];
  const failures = [];
  for (const item of ACCOUNTS) {
    const account = await login(item);
    const actualAdmin = account.permissions.includes('*') || account.permissions.some((permission) => ADMIN_ENTRY.includes(permission));
    if (actualAdmin !== item.expectAdmin) failures.push({ type: 'account', account: item.key, reason: 'Unexpected back-office entry permission' });
    accounts.push(account);
  }
  const rows = [];
  for (const account of accounts) for (const check of CHECKS) {
    const allowed = canUse(account, check);
    const result = await request(check.path, { token: account.token });
    const passed = allowed ? result.status === 200 : result.status === 403;
    const row = { account: account.key, check: check.name, expected: allowed ? 200 : 403, actual: result.status, passed };
    rows.push(row);
    if (!passed) failures.push({ type: 'api', ...row });
  }
  const report = { generated_at: new Date().toISOString(), base: BASE, accounts: accounts.map(({ token, ...account }) => account), summary: { accounts: accounts.length, apiChecks: rows.length, apiFailures: failures.filter((f) => f.type === 'api').length, accountFailures: failures.filter((f) => f.type === 'account').length, passed: failures.length === 0 }, api: rows, failures };
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report.summary, null, 2));
  console.log('Report: ' + REPORT_PATH);
  if (failures.length) { console.error(JSON.stringify(failures.slice(0, 20), null, 2)); process.exitCode = 1; }
}
main().catch((error) => { console.error(error.stack || error.message || String(error)); process.exit(1); });
