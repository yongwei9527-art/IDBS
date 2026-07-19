const { test, expect } = require('@playwright/test');

const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';

test.describe('QA bug regressions BUG-001..007', () => {
  test('BUG-001 unauthenticated deep link preserves redirect', async ({ page }) => {
    await page.goto(`${base}/v5/devices`);
    await page.waitForURL(/\/v5\/login/);
    const url = new URL(page.url());
    expect(url.pathname).toMatch(/\/v5\/login\/?$/);
    expect(url.searchParams.get('redirect') || '').toMatch(/devices/);
  });

  test('BUG-004 short password shows Chinese validation message', async ({ page }) => {
    await page.goto(`${base}/v5/login`);
    await page.getByLabel(/手机号|账号|电话/).first().fill('13800000001').catch(async () => {
      await page.locator('input[type="text"], input[name="phone"]').first().fill('13800000001');
    });
    await page.locator('input[type="password"]').first().fill('123');
    await page.getByRole('button', { name: /登录|登 录/ }).first().click();
    await expect(page.getByText(/密码至少需要\s*6\s*位|至少.*6/)).toBeVisible({ timeout: 5000 });
  });

  test('BUG-006 unknown route does not throw React #185 and shows not-found', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(String(err)));
    await page.goto(`${base}/v5/this-route-should-not-exist-xyz`);
    await expect(page.getByText(/页面不存在|不存在|Not Found|404/i)).toBeVisible({ timeout: 8000 });
    expect(pageErrors.join('\n')).not.toMatch(/Minified React error #185|#185/);
  });
});
