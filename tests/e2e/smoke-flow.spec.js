const { test, expect } = require('@playwright/test');

const adminPassword = process.env.E2E_ADMIN_PASSWORD || process.env.SMOKE_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || '';
const demoUserPhone = process.env.E2E_USER_PHONE || '13800000001';
const demoUserPassword = process.env.E2E_USER_PASSWORD || '123456';

test.describe('IDBS 2.0 smoke flow', () => {
  test('public pages render', async ({ page }) => {
    await page.goto('/login.html');
    await expect(page.locator('body')).toContainText(/登录|预约|设备/);

    await page.goto('/index.html');
    await expect(page.locator('body')).toContainText(/设备|登录/);
  });

  test('REST health and device API respond', async ({ request }) => {
    const health = await request.get('/health');
    expect(health.ok()).toBeTruthy();

    const devices = await request.get('/api/devices');
    expect(devices.ok()).toBeTruthy();
    const body = await devices.json();
    expect(body.ok).toBeTruthy();
  });

  test('user login page accepts demo credentials when seeded', async ({ page }) => {
    await page.goto('/login.html');
    const phoneInput = page.locator('input[name="phone"], #phone, input[type="tel"]').first();
    const passwordInput = page.locator('input[name="password"], #password, input[type="password"]').first();
    if (await phoneInput.count() === 0 || await passwordInput.count() === 0) test.skip(true, 'login form selectors not available');
    await phoneInput.fill(demoUserPhone);
    await passwordInput.fill(demoUserPassword);
    await page.getByRole('button', { name: /登录|进入/ }).first().click();
    await expect(page.locator('body')).not.toContainText('接口失败', { timeout: 8000 });
  });

  test('admin login works when password is configured', async ({ page }) => {
    test.skip(!adminPassword, 'E2E_ADMIN_PASSWORD/SMOKE_ADMIN_PASSWORD/ADMIN_PASSWORD is not configured');
    await page.goto('/admin.html');
    await page.locator('input[type="password"]').first().fill(adminPassword);
    await page.getByRole('button', { name: /登录|进入/ }).first().click();
    await expect(page.locator('body')).toContainText(/总览|工作台|设备管理/, { timeout: 8000 });
  });
});
