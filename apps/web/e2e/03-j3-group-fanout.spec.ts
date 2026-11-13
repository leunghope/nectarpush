import { expect, test } from '@playwright/test';
import { firstMessage, listChannels } from './helpers';

/**
 * J3 — one send fans out across several channels: a group channel lists two
 * child channel ids and the group send reports an aggregated result.
 *
 * Backend semantics (delivery.service.ts:183-209): the group channel produces
 * ONE delivery row that aggregates its children, so the detail page shows the
 * group target rather than one row per child.
 */
test('J3 群组通道一次发送扇出多个子通道', async ({ page }) => {
  const channels = await listChannels(page);
  const first = channels.find((c) => c.name === 'e2e-none');
  expect(first, 'J1 must have created e2e-none').toBeTruthy();

  const secondRes = await page.request.post('/api/channels', {
    data: { type: 'none', name: 'e2e-none-2', config: {}, enabled: true },
  });
  expect(secondRes.ok(), await secondRes.text()).toBeTruthy();
  const second = (await secondRes.json()).data as { id: number };

  // Group form is driven by the group adapter's config_schema (textarea).
  await page.goto('/channels/new');
  await page.getByRole('button', { name: /群组/ }).click();
  await page.getByLabel(/通道名称/).fill('e2e-group');
  await page.getByLabel(/子通道 ID 列表/).fill(`${first!.id},${second.id}`);
  await page.getByRole('button', { name: '保存配置' }).click();
  await expect(page.getByText('通道已创建')).toBeVisible();

  await page.goto('/');
  await page.locator('#wb-channel').selectOption('e2e-group');
  await page.locator('#wb-title').fill('群组扇出');
  await page.locator('#wb-content').fill('fan out');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.getByText('群组扇出')).toBeVisible({ timeout: 20_000 });

  const message = await firstMessage(page);
  const detail = await page.request.get(`/api/messages/${message.id}`);
  const data = (await detail.json()).data;
  expect(data.deliveries.length).toBe(1);
  expect(data.deliveries[0].channel_name).toBe('e2e-group');
  expect(data.deliveries[0].status).toBe('success');
  expect(data.status).toBe('success');
});
