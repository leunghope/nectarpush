import { expect, test } from '@playwright/test';
import { BASE, adminResetPassword, createUser } from './helpers';

/**
 * J1 — first deployment. The root session itself is created by auth.setup.ts
 * (so the suite can reuse storageState); the forced-password-change journey is
 * exercised with a fresh user whose password an admin just reset.
 */
test('J1a 未登录访问受保护页 → 跳转登录', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  await page.goto('/messages');
  await expect(page).toHaveURL(/\/login/);
  await ctx.close();
});

test('J1b 管理员重置密码后首登 → 强制改密 → 工作台', async ({ browser, page }) => {
  const username = 'e2e-first';
  const id = await createUser(page.request, username, 'e2eTempPass1', 'user');
  await adminResetPassword(page.request, id, 'e2eTempPass2');

  const ctx = await browser.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] } });
  const fresh = await ctx.newPage();
  await fresh.goto('/login');
  await fresh.getByLabel(/用户名/).fill(username);
  await fresh.getByLabel(/密码/).fill('e2eTempPass2');
  await fresh.getByRole('button', { name: '登录' }).click();

  await expect(fresh.getByText('请先修改初始密码')).toBeVisible({ timeout: 20_000 });
  await fresh.getByLabel(/当前密码/).fill('e2eTempPass2');
  await fresh.getByLabel(/^新密码/).fill('E2eFinalPass123');
  await fresh.getByLabel(/确认新密码/).fill('E2eFinalPass123');
  await fresh.getByRole('button', { name: '保存并继续' }).click();
  await expect(fresh.getByRole('heading', { name: '工作台' })).toBeVisible({ timeout: 20_000 });
  await ctx.close();
});

test('J1c root 建通道 → 发送 → 消息列表 → 公开正文页', async ({ page, browser }) => {
  // Channel type list + config form are driven entirely by GET /api/channels/types.
  await page.goto('/channels/new');
  await page.getByRole('button', { name: /不推送/ }).click();
  await page.getByLabel(/通道名称/).fill('e2e-none');
  await page.getByRole('button', { name: '保存配置' }).click();
  await expect(page.getByText('通道已创建')).toBeVisible();

  // Quick send from the workbench.
  await page.goto('/');
  await page.locator('#wb-channel').selectOption('e2e-none');
  await page.locator('#wb-title').fill('E2E 首条消息');
  await page.locator('#wb-content').fill('Hello **NectarPush**');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.getByText('E2E 首条消息')).toBeVisible({ timeout: 20_000 });

  // Message list.
  await page.goto('/messages');
  await expect(page.getByText('E2E 首条消息')).toBeVisible();

  // Public body page is reachable anonymously, with markdown rendered.
  const res = await page.request.get('/api/messages?page=1&page_size=10');
  const uuid = (await res.json()).data.items[0].uuid as string;
  const ctx = await browser.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] } });
  const pub = await ctx.newPage();
  await pub.goto(`/message/${uuid}`);
  await expect(pub.getByText(/Hello/)).toBeVisible();
  await expect(pub.locator('.article').getByText('NectarPush', { exact: true })).toBeVisible();
  await ctx.close();
});