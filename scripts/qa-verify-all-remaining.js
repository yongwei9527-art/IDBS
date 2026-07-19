const { chromium } = require('playwright');

async function loginApi(body) {
  const res = await fetch('http://127.0.0.1:3000/api/v5/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, message: json.message, code: json.code, perms: json.data?.permissions || json.permissions };
}

(async () => {
  console.log('short pwd', await loginApi({ phone: '13800000001', password: '123' }));
  console.log('wrong pwd', await loginApi({ phone: '13800000001', password: '123457' }));
  console.log('banned', await loginApi({ phone: '13800000004', password: '123456' }));
  console.log('rejected', await loginApi({ phone: '13800000005', password: '123456' }));
  console.log('duty', await loginApi({ phone: '13900000010', password: '123456' }));
  console.log('approval', await loginApi({ phone: '13900000011', password: '123456' }));

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // redirect
  await page.goto('http://127.0.0.1:3000/v5/devices', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  console.log('anon devices ->', page.url());

  // invalid route no infinite loop
  errors.length = 0;
  await page.goto('http://127.0.0.1:3000/v5/not-a-real-page-xyz', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  console.log('invalid', page.url(), 'pageerrors', errors.filter(x => /185|Maximum update depth/i.test(x)).length, errors.slice(0, 2));
  console.log('invalid text', (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 80));

  // UI short password
  await page.goto('http://127.0.0.1:3000/v5/login', { waitUntil: 'domcontentloaded' });
  await page.fill('#login-phone', '13800000001');
  await page.fill('#login-password', '123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(500);
  const errText = await page.locator('.login-error, [role="alert"]').innerText().catch(() => '');
  console.log('ui short pwd error', errText);

  // login + notice dismiss by ESC / later button
  await page.fill('#login-password', '123456');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1200);
  console.log('after login', page.url());
  let overlay = await page.locator('div.fixed.inset-0.z-50').count();
  console.log('notice overlay before', overlay);
  if (overlay) {
    const later = page.getByRole('button', { name: /稍后再说|我已了解/ });
    if (await later.count()) await later.first().click();
    await page.waitForTimeout(400);
  }
  overlay = await page.locator('div.fixed.inset-0.z-50').count();
  console.log('notice overlay after', overlay);
  // click nav should work
  await page.getByRole('link', { name: '使用日历' }).click({ timeout: 3000 }).catch(async () => {
    await page.goto('http://127.0.0.1:3000/v5/calendar', { waitUntil: 'domcontentloaded' });
  });
  await page.waitForTimeout(700);
  console.log('calendar nav', page.url(), 'overlay', await page.locator('div.fixed.inset-0.z-50').count());

  // duty admin users blocked
  await page.evaluate(async () => {
    const res = await fetch('/api/v5/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '13900000010', password: '123456' }) });
    const j = await res.json();
    localStorage.setItem('idbs.access_token', j.data.access_token);
  });
  await page.goto('http://127.0.0.1:3000/v5/admin/users', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  const notice = page.getByRole('button', { name: /我已了解|稍后再说/ });
  if (await notice.count()) await notice.first().click().catch(() => {});
  console.log('duty /admin/users ->', page.url());
  const usersApi = await page.evaluate(async () => {
    const res = await fetch('/api/v5/admin/users', { headers: { Authorization: 'Bearer ' + localStorage.getItem('idbs.access_token') } });
    const j = await res.json().catch(() => ({}));
    return { status: res.status, message: j.message };
  });
  console.log('duty users api', usersApi);

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
