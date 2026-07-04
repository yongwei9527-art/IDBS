const { test, expect } = require('@playwright/test');

const adminPassword = process.env.E2E_ADMIN_PASSWORD || process.env.SMOKE_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || '';

async function loginAdmin(page) {
  test.skip(!adminPassword, 'E2E_ADMIN_PASSWORD/SMOKE_ADMIN_PASSWORD/ADMIN_PASSWORD is not configured');
  await page.goto('/admin.html');
  await page.locator('input[type="password"]').first().fill(adminPassword);
  await page.getByRole('button', { name: /登录|进入/ }).first().click();
  await page.waitForLoadState('networkidle');
}

async function closeDrawer(page) {
  await page.evaluate(() => document.querySelector('.app-drawer-close')?.click());
  await expect(page.locator('.app-drawer')).toHaveCount(0);
}

test.describe('IDBS 2.0 admin flow', () => {
  test('workbench and main modules render', async ({ page }) => {
    await loginAdmin(page);
    await expect(page.locator('body')).toContainText(/工作台|总览|设备管理|预约/);
  });

  test('reservation approval module uses friendly wording', async ({ page }) => {
    await loginAdmin(page);
    await page.goto('/admin.html#reservations');
    const reservationPanel = page.locator('#reservationList').first();
    await expect(reservationPanel).toContainText(/预约|通过|拒绝|暂无/);
    await expect(reservationPanel).not.toContainText(/reservation_items|token|openid/i);
  });

  test('fault and request modules render', async ({ page }) => {
    await loginAdmin(page);
    await page.goto('/admin.html#faults');
    await expect(page.locator('body')).toContainText(/故障|处理/);
    await page.goto('/admin.html#requests');
    await expect(page.locator('body')).toContainText(/需求|处理|确认/);
  });

  test('drawer component is available for admin details', async ({ page }) => {
    await loginAdmin(page);
    await page.evaluate(() => window.openDrawer({ title: '测试详情', content: '<p>抽屉内容</p>' }));
    await expect(page.locator('.app-drawer')).toBeVisible();
    await expect(page.locator('.app-drawer')).toContainText('测试详情');
    await closeDrawer(page);
  });

  test('admin detail drawers support reservation, fault and request content', async ({ page }) => {
    await loginAdmin(page);
    await page.evaluate(() => {
      window.openDrawer({ title: '预约明细', subtitle: '批次审批明细', content: '<article class="reservation-item-card">设备 A</article>' });
    });
    await expect(page.locator('.app-drawer')).toContainText('预约明细');
    await closeDrawer(page);

    await page.evaluate(() => {
      window.openDrawer({ title: '故障详情', subtitle: '问题、上报人和处理记录', content: '<div class="soft-panel">维修中</div>' });
    });
    await expect(page.locator('.app-drawer')).toContainText('故障详情');
    await closeDrawer(page);

    await page.evaluate(() => {
      window.openDrawer({ title: '需求详情', subtitle: '内容、设备和处理记录', content: '<div class="soft-panel">新增设备需求</div>' });
    });
    await expect(page.locator('.app-drawer')).toContainText('需求详情');
  });
});
