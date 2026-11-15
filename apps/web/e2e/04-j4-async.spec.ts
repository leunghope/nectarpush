import { expect, test } from '@playwright/test';

/**
 * J4 — async send: POST /api/messages with async=true answers immediately with
 * a uuid; the per-channel delivery rows then settle in the background.
 *
 * Q-03 / AC-044: the message-level status must converge too. The API answers
 * `async_pending` immediately, then the background dispatch writes
 * success/partial/failed onto the same Message row.
 */
test('J4 异步发送 → 投递明细在后台收敛到成功', async ({ page }) => {
  await page.goto('/');
  await page.locator('#wb-channel').selectOption('e2e-none');
  await page.getByRole('switch', { name: '异步投递' }).click();
  await page.locator('#wb-title').fill('异步消息');
  await page.locator('#wb-content').fill('异步投递');

  const sendResponse = page.waitForResponse(
    (r) => r.url().endsWith('/api/messages') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '发送消息' }).click();
  const sent = (await (await sendResponse).json()).data as { uuid: string; status: string };
  expect(sent.status).toBe('async_pending');
  expect(sent.uuid).toBeTruthy();

  let messageId: number | null = null;
  let settled = false;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const list = await page.request.get('/api/messages?page=1&page_size=10&keyword=异步消息');
    const items = (await list.json()).data.items as Array<{ id: number }>;
    messageId = items[0]?.id ?? null;
    if (messageId) {
      const detail = await page.request.get(`/api/messages/${messageId}`);
      const rows = (await detail.json()).data.deliveries as Array<{ status: string }>;
      if (rows.length > 0 && rows.every((r) => r.status !== 'pending')) {
        settled = true;
        expect(rows[0].status).toBe('success');
        break;
      }
    }
    await page.waitForTimeout(300);
  }
  expect(settled, 'delivery rows should stop being pending').toBe(true);

  // Q-03 regression: message status must leave async_pending, not just deliveries.
  await expect
    .poll(async () => {
      const detail = await page.request.get(`/api/messages/${messageId}`);
      return (await detail.json()).data.status as string;
    }, { timeout: 10_000 })
    .toBe('success');

  await expect(page.getByText('异步消息')).toBeVisible({ timeout: 20_000 });
});
