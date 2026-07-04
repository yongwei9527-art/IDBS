const { test, expect } = require('@playwright/test');

const adminPassword = process.env.E2E_ADMIN_PASSWORD || process.env.SMOKE_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || '';
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

async function closeNoticeIfVisible(page) {
  const button = page.getByRole('button', { name: /我已了解|确认/ }).first();
  if (await button.count()) {
    await button.click().catch(() => {});
  }
}

async function loginAdmin(page) {
  test.skip(!adminPassword, 'admin password is not configured');
  await page.goto('/admin.html');
  await page.locator('input[type="password"]').first().fill(adminPassword);
  await page.getByRole('button', { name: /登录|进入/ }).first().click();
  await page.waitForLoadState('networkidle');
}

test.describe('IDBS 2.0 chat, fault and mobile coverage', () => {
  test('user chat page renders without technical wording', async ({ page }) => {
    await loginUser(page);
    await page.goto('/chat.html');
    await expect(page.locator('body')).toContainText(/消息|会话|聊天|管理员/);
    await expect(page.locator('body')).not.toContainText(/SSE|openid|token|reservation_items/i);
  });

  test('chat page exposes group leave and dissolve affordances safely', async ({ page }) => {
    await loginUser(page);
    await page.goto('/chat.html');
    await expect(page.locator('#conversation-list')).toBeVisible();
    await expect(page.locator('#leave-group-btn')).toHaveText(/退出群聊/);
    await expect(page.locator('#dissolve-group-btn')).toHaveText(/解散群聊/);
    await expect(page.locator('body')).toContainText(/发起聊天|群聊成员|会话/);
  });

  test('admin fault page renders actions', async ({ page }) => {
    await loginAdmin(page);
    await page.goto('/admin.html#faults');
    await expect(page.locator('body')).toContainText(/故障|处理中|恢复|关闭/);
  });

  test('user reports combine fault and request entry', async ({ page }) => {
    await loginUser(page);
    await page.goto('/my.html');
    await closeNoticeIfVisible(page);
    await expect(page.locator('body')).toContainText(/故障 \/ 需求上报|上报记录/);
    await page.getByRole('button', { name: /我要上报/ }).click();
    await expect(page.locator('#unified-report-form')).toBeVisible();
    await expect(page.locator('#unified-report-form')).toContainText(/故障报备|需求上报/);
  });

  test('mobile user navigation keeps bottom tab visible', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'mobile-only check');
    await loginUser(page);
    await page.goto('/index.html');
    const nav = page.locator('.app-sidebar').first();
    await expect(nav).toBeVisible();
    const box = await nav.boundingBox();
    expect(box && box.y).toBeGreaterThan(300);
  });
});
