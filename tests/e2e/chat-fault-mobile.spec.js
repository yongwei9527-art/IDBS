const { test, expect } = require('@playwright/test');
const { login, expectAppPage } = require('./helpers');
const USER = process.env.E2E_USER_PHONE || '13800000001';
const ADMIN = process.env.E2E_ADMIN_PHONE || '13900000000';

test.describe('IDBS 5.0 chat, fault and mobile coverage', () => {
  test('user chat page renders', async ({ page }) => { await login(page, USER); await expectAppPage(page, '/chat'); });
  test('user fault page renders', async ({ page }) => { await login(page, USER); await expectAppPage(page, '/faults'); });
  test('user notifications render', async ({ page }) => { await login(page, USER); await expectAppPage(page, '/notifications'); });
  test('admin fault page renders', async ({ page }) => { await login(page, ADMIN); await expectAppPage(page, '/admin/faults'); });
  test('mobile navigation keeps an application shell', async ({ page }) => { await login(page, USER); await expectAppPage(page, '/devices'); await expect(page.locator('body')).toBeVisible(); });
});