const { chromium } = require('playwright');

async function loginApi(body) {
  const res = await fetch('http://127.0.0.1:3000/api/v5/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, message: json.message, code: json.code };
}

(async () => {
  console.log('API wrong password', await loginApi({ phone: '13800000001', password: '123457' }));
  console.log('API banned', await loginApi({ phone: '13800000004', password: '123456' }));
  console.log('API rejected', await loginApi({ phone: '13800000005', password: '123456' }));
  console.log('API ok', await loginApi({ phone: '13800000001', password: '123456' }));

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // anonymous deep-link redirect
  for (const route of ['/devices', '/admin/dashboard', '/me/reservations', '/calendar?month=2026-07']) {
    await page.goto('http://127.0.0.1:3000/v5' + route, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(800);
    console.log('ANON', route, '->', page.url());
  }

  // login via API then open devices and clear token, navigate calendar
  await page.goto('http://127.0.0.1:3000/v5/login', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    const res = await fetch('/api/v5/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '13800000001', password: '123456' })
    });
    const j = await res.json();
    localStorage.setItem('idbs.access_token', j.data.access_token);
  });
  await page.goto('http://127.0.0.1:3000/v5/devices', { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  const notice = page.getByRole('button', { name: /我已了解/ });
  if (await notice.count()) await notice.click();
  await page.evaluate(() => {
    localStorage.removeItem('idbs.access_token');
    localStorage.removeItem('idbs.refresh_token');
  });
  await page.goto('http://127.0.0.1:3000/v5/calendar', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  console.log('AFTER_CLEAR', page.url());

  // full UI login flow with redirect query present
  await page.goto('http://127.0.0.1:3000/v5/login?redirect=%2Fme%2Freservations', { waitUntil: 'domcontentloaded' });
  await page.fill('#login-phone', '13800000001');
  await page.fill('#login-password', '123456');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1500);
  console.log('UI_LOGIN_REDIRECT', page.url());
  const notice2 = page.getByRole('button', { name: /我已了解/ });
  if (await notice2.count()) await notice2.click();
  console.log('UI_LOGIN_FINAL', page.url(), (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 100));

  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
