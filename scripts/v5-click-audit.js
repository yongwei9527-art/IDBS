/* IDBS 5.0 safe click-audit: checks public and administrator routes without executing high-risk actions. */
/* It records page, console, interaction, and authorization failures for regression review. */
/* The audit always targets the canonical V5 SPA entry point. */

const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

const requestedBase = process.env.CLICK_AUDIT_BASE || 'http://127.0.0.1:3000/v5';
// Permit a host-only environment value while keeping the audit on the only
// supported web entry point. This prevents false passes against retired paths.
const baseWithoutTrailingSlash = requestedBase.replace(/\/+$/, '');
const BASE = /\/v5$/i.test(baseWithoutTrailingSlash) ? baseWithoutTrailingSlash : `${baseWithoutTrailingSlash}/v5`;
const OUT = process.env.CLICK_AUDIT_REPORT_PATH || path.join(process.cwd(), 'backups', 'reports', 'v5-click-audit-report.json');
const HIGH_RISK = /(delete|remove|reject|approve|submit|save|create|export|download|restore|resolve|close|disable|upload|send|logout|extend|renew|\u5220\u9664|\u9a73\u56de|\u5ba1\u6279|\u4fdd\u5b58|\u65b0\u589e|\u521b\u5efa|\u63d0\u4ea4|\u4e0b\u8f7d|\u5bfc\u51fa|\u5173\u95ed|\u7981\u7528|\u5f52\u8fd8|\u786e\u8ba4|\u91cd\u7f6e|\u6e05\u7a7a|\u8f6c\u4ea4|\u5904\u7406|\u53d1\u9001|\u4e0a\u4f20|\u7acb\u5373|\u8fd0\u884c|\u5f00\u59cb|\u9886\u53d6|\u626b\u7801|\u53d6\u6d88\u9884\u7ea6|\u7eed\u7ea6|\u9000\u51fa|\u767b\u51fa)/i;
const ENGLISH_ERROR = /HTTP\s*\d{3}|Internal server error|Unauthorized|Forbidden|Cannot read|undefined is not|is not a function|Failed to fetch|NetworkError|TypeError:|ReferenceError:|SyntaxError:/i;

const userPages = [
  '/devices',
  '/reserve',
  '/calendar?month=2026-07',
  '/me/reservations',
  '/borrow',
  '/faults',
  '/support/contacts',
  '/notifications',
  '/chat'
];
const adminPages = [
  '/admin/dashboard',
  '/admin/devices',
  '/admin/reservations?status=pending',
  '/admin/users',
  '/admin/faults',
  '/admin/requests',  '/admin/stats',
  '/admin/export',
  '/admin/system',
  '/admin/audit'
];

function abs(route) {
  return `${BASE}${route.startsWith('/') ? route : `/${route}`}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeAuditError(message) {
  const text = String(message || '').trim();
  if (/too many.*request|please slow|429/i.test(text)) return 'Too many requests. Please try again later.';
  if (/unauthorized/i.test(text)) return 'Authentication is required or has expired.';
  if (/forbidden/i.test(text)) return 'You do not have permission to access this resource.';
  if (/internal server error/i.test(text)) return 'The server could not process the request.';
  return text || 'The operation failed.';
}

async function apiLogin(page, endpoint, body) {
  await page.goto(abs('/login'), { waitUntil: 'domcontentloaded' });
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = await page.evaluate(async ({ endpoint, body }) => {
      const res = await fetch(`/api/v5${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          retryAfter: Number(res.headers.get('Retry-After') || 0),
          message: json?.message || `Login failed: ${res.status}`
        };
      }
      const data = json?.data || json;
      localStorage.setItem('idbs.access_token', data.access_token);
      if (data.refresh_token) localStorage.setItem('idbs.refresh_token', data.refresh_token);
      return { ok: true, role: data.role, permissions: data.permissions || [] };
    }, { endpoint, body });
    if (result.ok) return { role: result.role, permissions: result.permissions || [] };
    lastError = normalizeAuditError(result.message);
    if (result.status !== 429 || attempt === 3) break;
    await sleep(Math.max(result.retryAfter || 20, 20) * 1000);
  }
  throw new Error(lastError || 'Login failed.');
}

async function collectEnglishError(page) {
  const text = await page.locator('body').innerText({ timeout: 2000 }).catch(() => '');
  const match = text.match(ENGLISH_ERROR);
  return match ? match[0] : '';
}

async function markClickables(page) {
  return page.evaluate((highRiskSource) => {
    const highRisk = new RegExp(highRiskSource, 'i');
    const nodes = Array.from(document.querySelectorAll('main button, main a[href], main [role="button"], main summary, main select, main input[type="checkbox"], main input[type="radio"]'));
    return nodes.map((el, index) => {
      if (el.closest('aside, header')) return null;
      if (el.getAttribute('aria-current') === 'page') return null;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const text = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || el.getAttribute('href') || el.value || el.name || el.id || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 80);
      const disabled = Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true');
      const visible = rect.width > 1 && rect.height > 1 && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity || 1) > 0.01;
      const risky = highRisk.test(text) || highRisk.test(el.getAttribute('type') || '');
      const id = `audit-${Date.now()}-${index}`;
      if (visible && !disabled && !risky) el.setAttribute('data-click-audit-id', id);
      return { id, tag: el.tagName.toLowerCase(), text, disabled, visible, risky };
    }).filter((x) => x && x.visible && !x.disabled);
  }, HIGH_RISK.source);
}

async function dismissBlockingNotice(page) {
  const noticeButton = page.getByRole('button', { name: /close|dismiss|got it|\u5173\u95ed|\u77e5\u9053\u4e86|\u4e86\u89e3|\u786e\u8ba4/i }).first();
  if (await noticeButton.isVisible({ timeout: 800 }).catch(() => false)) {
    await noticeButton.click({ timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(200);
  }
}
async function auditPage(page, route, roleName) {
  const url = abs(route);
  const item = { role: roleName, route, url, clicked: [], skipped: [], errors: [] };
  const consoleErrors = [];
  const onConsole = (msg) => { if (['error'].includes(msg.type())) consoleErrors.push(msg.text()); };
  const onPageError = (err) => item.errors.push({ type: 'pageerror', message: err.message });
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await dismissBlockingNotice(page);
    const firstEnglish = await collectEnglishError(page);
    if (firstEnglish) item.errors.push({ type: 'english-text', message: firstEnglish, stage: 'load' });

    const clickables = await markClickables(page);
    for (const c of clickables.slice(0, 60)) {
      if (c.risky) { item.skipped.push({ ...c, reason: 'High-risk action skipped.' }); continue; }
      const locator = page.locator(`[data-click-audit-id="${c.id}"]`).first();
      if (!(await locator.count().catch(() => 0))) continue;
      if (!(await locator.isEnabled().catch(() => false))) {
        item.skipped.push({ ...c, reason: 'Control became disabled before click.' });
        continue;
      }
      try {
        if (c.tag === 'select') {
          const values = await locator.locator('option').evaluateAll((opts) => opts.map((o) => o.value).filter(Boolean));
          if (values.length > 1) await locator.selectOption(values[1], { timeout: 1500 });
        } else {
          await locator.click({ timeout: 2000, trial: false });
        }
        await page.waitForTimeout(350);
        const dialog = await page.locator('[role="dialog"], .modal, .popover, [data-radix-popper-content-wrapper]').count().catch(() => 0);
        const english = await collectEnglishError(page);
        if (english) item.errors.push({ type: 'english-text', message: english, after: c.text });
        item.clicked.push({ text: c.text, tag: c.tag, dialogOpened: dialog > 0 });
        if (page.url() !== url) {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
          await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
          await dismissBlockingNotice(page);
        } else {
          await page.keyboard.press('Escape').catch(() => {});
          await dismissBlockingNotice(page);
        }
      } catch (err) {
        item.errors.push({ type: 'click', target: c.text, message: err.message });
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
      }
    }
    if (consoleErrors.length) item.errors.push(...consoleErrors.slice(0, 10).map((message) => ({ type: 'console', message })));
  } catch (err) {
    item.errors.push({ type: 'load', message: err.message });
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
  }
  return item;
}

async function verifyNoAdminLeak(page) {
  await apiLogin(page, '/auth/login', { phone: '13800000002', password: '123456' });
  await page.goto(abs('/admin/dashboard'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  const url = page.url();
  const body = await page.locator('body').innerText().catch(() => '');
  const leaked = /Access Control|Permission diagnostics|Authorization gap|\u540e\u53f0|\u6743\u9650\u8bca\u65ad|\u6388\u6743\u7f3a\u53e3|\u5f53\u524d\u5df2\u6388\u6743\u80fd\u529b/.test(body);
  return {
    ok: url.includes('/v5/devices') && !leaked,
    url,
    leaked
  };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const report = { base: BASE, started_at: new Date().toISOString(), pages: [], permissionChecks: {}, summary: {} };
  try {
    let context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    let page = await context.newPage();
    report.permissionChecks.normalUserAdminRedirect = await verifyNoAdminLeak(page);
    for (const route of userPages) report.pages.push(await auditPage(page, route, 'Standard user'));
    await context.close();

    context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    page = await context.newPage();
    await apiLogin(page, '/auth/login', { phone: '13900000000', password: '123456' });
    for (const route of adminPages) report.pages.push(await auditPage(page, route, 'Administrator'));
    await context.close();

    context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    page = await context.newPage();
    await apiLogin(page, '/auth/login', { phone: '13900000010', password: '123456' }).catch(async () => {
      await apiLogin(page, '/auth/login', { phone: '13900000011', password: '123456' });
    });
    for (const route of ['/admin/dashboard', '/admin/devices', '/admin/reservations?status=pending', '/admin/users', '/admin/system']) {
      report.pages.push(await auditPage(page, route, 'Delegated administrator'));
    }
    await context.close();
  } finally {
    await browser.close();
  }
  report.finished_at = new Date().toISOString();
  report.summary.totalPages = report.pages.length;
  report.summary.clicked = report.pages.reduce((n, p) => n + p.clicked.length, 0);
  report.summary.errors = report.pages.reduce((n, p) => n + p.errors.length, 0);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report.summary, null, 2));
  if (!report.permissionChecks.normalUserAdminRedirect.ok || report.summary.errors > 0) process.exitCode = 1;
})().catch((err) => {
  console.error(err);
  process.exit(1);
});






