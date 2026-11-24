import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import { BASE, createUser, storageStateFor } from './helpers';

test.use({ extraHTTPHeaders: { 'x-forwarded-for': '10.77.9.1' } });

const EMPTY_STATE = { cookies: [], origins: [] };

async function expectError(res: APIResponse, status: number, code: string): Promise<void> {
  expect(res.status()).toBe(status);
  const body = await res.json();
  expect(body.success).toBe(false);
  expect(body.code).toBe(code);
}

async function get(ctx: APIRequestContext, path: string): Promise<APIResponse> {
  return ctx.get(path);
}

/**
 * J9 — 权限矩阵（PRD FR-072～FR-076）。UI guards and API guards must agree:
 * user cannot see /users or /settings, admin sees /users but not /settings,
 * root sees everything; direct API calls get 401/403 with stable codes.
 */
test('J9 权限矩阵：UI 守卫 + API 401/403 双层一致', async ({ page, browser }) => {
  const userPassword = 'permUserPass1';
  const adminPassword = 'permAdminPass1';
  await createUser(page.request, 'e2e-p-user', userPassword, 'user');
  await createUser(page.request, 'e2e-p-admin', adminPassword, 'admin');

  const userState = await storageStateFor('e2e-p-user', userPassword);
  const adminState = await storageStateFor('e2e-p-admin', adminPassword);

  const userCtx = await browser.newContext({ baseURL: BASE, storageState: userState });
  const adminCtx = await browser.newContext({ baseURL: BASE, storageState: adminState });
  const anonCtx = await browser.newContext({ baseURL: BASE, storageState: EMPTY_STATE });

  const userPage = await userCtx.newPage();
  const adminPage = await adminCtx.newPage();
  const anonPage = await anonCtx.newPage();

  try {
    // ---- UI layer ----
    await userPage.goto('/users');
    await expect(userPage.getByText('无权访问')).toBeVisible();
    await userPage.goto('/settings');
    await expect(userPage.getByText('无权访问')).toBeVisible();

    await adminPage.goto('/users');
    await expect(adminPage.getByRole('heading', { name: '用户管理' })).toBeVisible();
    await adminPage.goto('/settings');
    await expect(adminPage.getByText('无权访问')).toBeVisible();

    await page.goto('/users');
    await expect(page.getByRole('heading', { name: '用户管理' })).toBeVisible();
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: '系统设置' })).toBeVisible();

    // ---- API layer ----
    await expectError(await get(userPage.request, '/api/users'), 403, 'FORBIDDEN');
    await expectError(await get(userPage.request, '/api/options'), 403, 'FORBIDDEN');
    expect((await get(userPage.request, '/api/messages')).status()).toBe(200);

    expect((await get(adminPage.request, '/api/users')).status()).toBe(200);
    await expectError(await get(adminPage.request, '/api/options'), 403, 'FORBIDDEN');
    expect((await get(adminPage.request, '/api/channels')).status()).toBe(200);

    await expectError(await get(anonPage.request, '/api/messages'), 401, 'UNAUTHORIZED');
    await expectError(await get(anonPage.request, '/api/users'), 401, 'UNAUTHORIZED');
    await expectError(await get(anonPage.request, '/api/options'), 401, 'UNAUTHORIZED');
    await expectError(
      await anonPage.request.post('/api/channels', { data: { type: 'none', name: 'x', config: {} } }),
      401,
      'UNAUTHORIZED',
    );

    expect((await get(page.request, '/api/users')).status()).toBe(200);
    expect((await get(page.request, '/api/options')).status()).toBe(200);
  } finally {
    await userCtx.close();
    await adminCtx.close();
    await anonCtx.close();
  }
});