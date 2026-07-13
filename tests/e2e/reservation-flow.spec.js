const { test, expect } = require('@playwright/test');
const { login, expectAppPage } = require('./helpers');
const USER = process.env.E2E_USER_PHONE || '13800000001';

test.describe('IDBS 5.0 reservation flow', () => {
  test('reservation page renders', async ({ page }) => { await login(page, USER); await expectAppPage(page, '/reserve'); });
  test('my reservation records render', async ({ page }) => { await login(page, USER); await expectAppPage(page, '/me/reservations'); });
  test('calendar page renders without a white screen', async ({ page }) => { await login(page, USER); await expectAppPage(page, '/calendar?month=2026-07'); await expect(page.locator('body')).not.toBeEmpty(); });
});