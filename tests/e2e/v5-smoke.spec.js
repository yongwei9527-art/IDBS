const { test, expect } = require('@playwright/test');
const { login, expectAppPage } = require('./helpers');

test.describe('实验室管理系统 5.0 V5-only', () => {
  test('login page renders credential inputs without mistaking the pairing field for a credential', async ({ page }) => {
    await page.goto('/v5/login');
    await expect(page.locator('#login-phone')).toBeVisible();
    await expect(page.locator('#login-password')).toBeVisible();
    await expect(page.locator('#app-pairing-link')).toBeVisible();
  });
  test('login page exposes a submit button', async ({ page }) => { await page.goto('/v5/login'); await expect(page.locator('button')).not.toHaveCount(0); });
  test('password recovery form is reachable without hiding the safe verification fields', async ({ page }) => {
    await page.goto('/v5/login');
    await page.getByRole('button', { name: '忘记密码？请求管理员重置' }).click();
    await expect(page.locator('#recover-phone')).toBeVisible();
    await expect(page.locator('#recover-name')).toBeVisible();
    await expect(page.locator('#recover-student')).toBeVisible();
    await expect(page.locator('#recover-mentor')).toBeVisible();
  });
  test('remote HTTP login requires explicit confirmation before credentials are sent', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('laboratory-management-system.api_origin', 'http://192.0.2.10');
    });
    let credentialRequests = 0;
    let warning = '';
    await page.route('http://192.0.2.10/**', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ code: 1001, message: 'Unauthorized' })
      });
    });
    page.on('request', (request) => {
      if (request.url().startsWith('http://192.0.2.10/api/v5/auth/login')) credentialRequests += 1;
    });
    page.once('dialog', async (dialog) => {
      warning = dialog.message();
      await dialog.dismiss();
    });

    await page.goto('/v5/login');
    await page.locator('#login-phone').fill('13900000000');
    await page.locator('#login-password').fill('not-a-real-password');
    await page.locator('button[type="submit"]').click();

    await expect(page.getByRole('alert')).toContainText('已取消提交');
    expect(warning).toContain('未加密 HTTP');
    expect(warning).toContain('账号、密码');
    expect(credentialRequests).toBe(0);
  });
  test('authenticated application layout renders', async ({ page }) => { await login(page); await expectAppPage(page, '/devices'); });
  test('health and v5 device API respond', async ({ request }) => { expect((await request.get('/health')).ok()).toBeTruthy(); expect((await request.get('/api/v5/devices')).ok()).toBeTruthy(); });
  test('v5 root redirects to login when unauthenticated', async ({ page }) => { await page.goto('/v5/'); await expect(page).toHaveURL(/\/v5\/(login|$)/); });
  test('admin endpoints reject unauthenticated requests', async ({ request }) => { expect([401, 403]).toContain((await request.get('/api/v5/admin/dashboard')).status()); });
  test('unauthenticated responses do not expose data', async ({ request }) => { const response = await request.get('/api/v5/admin/dashboard'); expect(response.status()).toBe(401); expect((await response.json()).data).toBeFalsy(); });
});
