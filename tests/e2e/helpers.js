const { expect } = require('@playwright/test');

async function login(page, phone = '13800000002', password = '123456') {
  await page.goto('/v5/login', { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(async ({ phone, password }) => {
    const response = await fetch('/api/v5/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, password })
    });
    const json = await response.json().catch(() => ({}));
    const data = json.data || json;
    if (!response.ok || !data.access_token) return { ok: false, status: response.status, message: json.message || '' };
    localStorage.setItem('idbs.access_token', data.access_token);
    if (data.refresh_token) localStorage.setItem('idbs.refresh_token', data.refresh_token);
    return { ok: true };
  }, { phone, password });
  expect(result.ok, JSON.stringify(result)).toBeTruthy();
}

async function expectAppPage(page, route) {
  await page.goto('/v5' + route, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/Internal Server Error|TypeError:|ReferenceError:|SyntaxError:|Failed to fetch/i);
}

module.exports = { login, expectAppPage };