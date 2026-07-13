const { test, expect } = require('@playwright/test');
const { login, expectAppPage } = require('./helpers');
const ADMIN = process.env.E2E_ADMIN_PHONE || '13900000000';

test.describe('IDBS 5.0 admin flow', () => {
  test('workbench renders for a seeded administrator', async ({ page }) => { await login(page, ADMIN); await expectAppPage(page, '/admin/dashboard'); await expect(page).toHaveURL(/\/v5\/admin\/dashboard/); });
  test('reservation administration renders', async ({ page }) => { await login(page, ADMIN); await expectAppPage(page, '/admin/reservations?status=pending'); });
  test('fault and request administration render', async ({ page }) => { await login(page, ADMIN); await expectAppPage(page, '/admin/faults'); await expectAppPage(page, '/admin/requests'); });
  test('device and user administration render', async ({ page }) => { await login(page, ADMIN); await expectAppPage(page, '/admin/devices'); await expectAppPage(page, '/admin/users'); });
  test('system and audit administration render', async ({ page }) => { await login(page, ADMIN); await expectAppPage(page, '/admin/system'); await expectAppPage(page, '/admin/audit'); });
});