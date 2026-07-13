const { test, expect } = require('@playwright/test');
const { login, expectAppPage } = require('./helpers');

test.describe('IDBS 5.0 V5-only', () => {
  test('login page renders two credential inputs', async ({ page }) => { await page.goto('/v5/login'); await expect(page.locator('input')).toHaveCount(2); });
  test('login page exposes a submit button', async ({ page }) => { await page.goto('/v5/login'); await expect(page.locator('button')).not.toHaveCount(0); });
  test('authenticated application layout renders', async ({ page }) => { await login(page); await expectAppPage(page, '/devices'); });
  test('health and v5 device API respond', async ({ request }) => { expect((await request.get('/health')).ok()).toBeTruthy(); expect((await request.get('/api/v5/devices')).ok()).toBeTruthy(); });
  test('v5 root redirects to login when unauthenticated', async ({ page }) => { await page.goto('/v5/'); await expect(page).toHaveURL(/\/v5\/(login|$)/); });
  test('admin endpoints reject unauthenticated requests', async ({ request }) => { expect([401, 403]).toContain((await request.get('/api/v5/admin/dashboard')).status()); });
  test('unauthenticated responses do not expose data', async ({ request }) => { const response = await request.get('/api/v5/admin/dashboard'); expect(response.status()).toBe(401); expect((await response.json()).data).toBeFalsy(); });
});