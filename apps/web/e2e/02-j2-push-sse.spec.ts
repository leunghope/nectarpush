import { expect, test } from '@playwright/test';

/**
 * J2 — issue a global token, push through POST /push/{username} and watch the
 * message arrive live in the workbench via SSE (no reload).
 *
 * Q-02 / FR-042: /push accepts the token from body/query *or* from
 * `Authorization: Bearer`; body/query wins when both are present.
 */
test('J2 全局令牌 → POST /push → SSE 实时插入', async ({ page }) => {
  // Session comes from storageState (auth.setup.ts). Token issuance lives on
  // the profile page (Account / Profile → API Token).
  await page.goto('/me');

  const tokenResponse = page.waitForResponse(
    (r) => r.url().includes('/api/me/token') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '生成新 Token' }).click();
  const token = (await (await tokenResponse).json()).data.token as string;
  expect(token).toBeTruthy();

  const settings = await page.request.get('/api/me/push');
  const endpoint = (await settings.json()).data.push_endpoint as string;

  // Open the workbench first so the SSE connection is established before pushing.
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '工作台' })).toBeVisible();

  const push = await page.request.post(endpoint, {
    data: { channel: 'e2e-none', title: 'SSE 实时消息', content: '来自 /push 接口', token },
  });
  expect(push.ok(), await push.text()).toBeTruthy();

  // Q-02 regression: Bearer-only POST works too (no token in the body).
  const bearerPush = await page.request.post(endpoint, {
    headers: { authorization: `Bearer ${token}` },
    data: { channel: 'e2e-none', title: 'Bearer 推送', content: '仅 Authorization 头' },
  });
  expect(bearerPush.status(), await bearerPush.text()).toBe(200);

  // Without any reload: the row appears because the SSE event was received.
  await expect(page.getByText('SSE 实时消息')).toBeVisible({ timeout: 20_000 });
});
