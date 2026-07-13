const { test, expect } = require('@playwright/test');
const { login, expectAppPage } = require('./helpers');

test.describe('IDBS 5.0 smoke flow', () => {
  test('login route renders', async ({ page }) => { await page.goto('/v5/login'); await expect(page.locator('input')).toHaveCount(2); });
  test('REST health and device API respond', async ({ request }) => { expect((await request.get('/health')).ok()).toBeTruthy(); expect((await request.get('/api/v5/devices')).ok()).toBeTruthy(); });
  test('seeded user can open devices', async ({ page }) => { await login(page); await expectAppPage(page, '/devices'); });
  test('seeded administrator can open workbench', async ({ page }) => { await login(page, process.env.E2E_ADMIN_PHONE || '13900000000'); await expectAppPage(page, '/admin/dashboard'); });
});