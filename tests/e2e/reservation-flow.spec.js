const { test, expect } = require('@playwright/test');

const userPhone = process.env.E2E_USER_PHONE || '13800000001';
const userPassword = process.env.E2E_USER_PASSWORD || '123456';

async function loginUser(page) {
  await page.goto('/login.html');
  const phoneInput = page.locator('input[name="phone"], #phone, input[type="tel"]').first();
  const passwordInput = page.locator('input[name="password"], #password, input[type="password"]').first();
  if (await phoneInput.count() === 0 || await passwordInput.count() === 0) test.skip(true, 'login form selectors not available');
  await phoneInput.fill(userPhone);
  await passwordInput.fill(userPassword);
  await page.getByRole('button', { name: /登录|进入/ }).first().click();
  await page.waitForLoadState('networkidle');
}

test.describe('IDBS 2.0 reservation flow', () => {
  test('reservation page renders plan controls', async ({ page }) => {
    await loginUser(page);
    await page.goto('/reserve.html?device_code=LAB-MIC-001');
    await expect(page.locator('body')).toContainText(/预约|设备|日期|时间段/);
    await expect(page.locator('#submit-btn')).toBeVisible();
    await expect(page.locator('.slot-card').first()).toHaveClass(/slot-/);
    await expect(page.locator('.slot-time-badge').first()).toBeVisible();
  });

  test('my records page renders item groups', async ({ page }) => {
    await loginUser(page);
    await page.goto('/my.html');
    await expect(page.locator('body')).toContainText(/我的记录|待审核|使用中|已完成/);
  });

  test('calendar page renders without white screen', async ({ page }) => {
    await loginUser(page);
    await page.goto('/calendar.html');
    await expect(page.locator('body')).toContainText(/日历|预约|设备/);
    await expect(page.locator('body')).not.toContainText(/reservation_items|SSE|token|openid/i);
  });
});
