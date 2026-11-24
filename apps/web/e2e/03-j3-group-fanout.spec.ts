import { expect, test, type Page } from '@playwright/test';
import { listChannels } from './helpers';

/**
 * J3 — one send fans out across several channels: a group channel has two
 * child channels picked from the user's own list and the group send reports an
 * aggregated result.
 *
 * Backend semantics (delivery.service.ts deliverGroup): the group channel
 * produces ONE delivery row PER child channel, and each row carries that
 * child's own status. The detail page therefore lists the children (not the
 * group) and its "重试失败项" button retries only the failed rows in place.
 */
async function messageByTitle(page: Page, title: string) {
  const res = await page.request.get(`/api/messages?keyword=${encodeURIComponent(title)}&page_size=10`);
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).data.items[0] as { id: number; uuid: string; status: string };
}

async function setChannelEnabled(page: Page, id: number, enabled: boolean) {
  const res = await page.request.patch(`/api/channels/${id}`, {
    data: { status_only: true, enabled },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

/** Reuse the channel when a previous spec already created it. */
async function ensureChannel(page: Page, name: string): Promise<{ id: number; name: string }> {
  const existing = (await listChannels(page)).find((c) => c.name === name);
  if (existing) return existing;
  const res = await page.request.post('/api/channels', {
    data: { type: 'none', name, config: {}, enabled: true },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const created = (await res.json()).data as { id: number };
  return { id: created.id, name };
}

test('J3 群组通道一次发送扇出多个子通道，失败项可原位重试', async ({ page }) => {
  const first = await ensureChannel(page, 'e2e-none');
  const second = await ensureChannel(page, 'e2e-none-2');
  expect(second.id).toBeGreaterThan(0);

  // The group form lists the user's channels as checkboxes (the child list is
  // no longer typed by hand).
  await page.goto('/channels/new');
  await page.locator('#ch-type').selectOption('group');
  await page.getByLabel(/通道名称/).fill('e2e-group');
  await page.getByRole('checkbox', { name: 'e2e-none · none' }).check();
  await page.getByRole('checkbox', { name: 'e2e-none-2 · none' }).check();
  await page.getByRole('button', { name: '保存配置' }).click();
  await expect(page.getByText('通道已创建')).toBeVisible();

  // --- all children healthy: one row per child, every row successful ---
  await page.goto('/');
  await page.locator('#wb-channel').selectOption('e2e-group');
  await page.locator('#wb-title').fill('群组扇出');
  await page.locator('#wb-content').fill('fan out');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.getByText('群组扇出')).toBeVisible({ timeout: 20_000 });

  const message = await messageByTitle(page, '群组扇出');
  const detail = await page.request.get(`/api/messages/${message.id}`);
  const data = (await detail.json()).data;
  expect(data.status).toBe('success');
  expect(data.deliveries).toHaveLength(2);
  expect(data.deliveries.map((d: { channel_name: string }) => d.channel_name)).toEqual([
    'e2e-none',
    'e2e-none-2',
  ]);
  expect(data.deliveries.every((d: { status: string }) => d.status === 'success')).toBe(true);

  await page.goto(`/messages/${message.id}`);
  await expect(page.getByRole('heading', { name: '投递明细' })).toBeVisible();
  const rows = page.locator('.data-table tbody tr');
  await expect(rows).toHaveCount(2);
  // 1.3: the status column shows the per-channel delivery status, not "全部成功".
  await expect(rows.filter({ hasText: 'e2e-none-2' }).getByText('成功', { exact: true })).toBeVisible();

  // --- one child disabled: partial send exposes only that child as failed ---
  await setChannelEnabled(page, second.id, false);
  await page.goto('/');
  await page.locator('#wb-channel').selectOption('e2e-group');
  await page.locator('#wb-title').fill('群组部分失败');
  await page.locator('#wb-content').fill('partial');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.getByText('群组部分失败')).toBeVisible({ timeout: 20_000 });

  const partial = await messageByTitle(page, '群组部分失败');
  expect(partial.status).toBe('partial');

  await page.goto(`/messages/${partial.id}`);
  await expect(page.getByText(`有 1 个通道投递失败：e2e-none-2`)).toBeVisible();
  const failedRow = page.locator('.data-table tbody tr').filter({ hasText: 'e2e-none-2' });
  await expect(failedRow.getByText('失败', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '重试失败项（1）' })).toBeVisible();

  // 1.3: the truncated error opens in a dialog with the full text.
  await failedRow.getByRole('button', { name: '查看' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('投递详情 · e2e-none-2')).toBeVisible();
  await expect(dialog.locator('pre')).toContainText('已被禁用');
  await dialog.getByRole('button', { name: '关闭' }).click();

  // --- 1.2: retry re-sends only the failed child, in place ---
  await setChannelEnabled(page, second.id, true);
  await page.getByRole('button', { name: '重试失败项（1）' }).click();
  await expect(page.getByText('全部成功').first()).toBeVisible({ timeout: 20_000 });
  const rowsAfter = page.locator('.data-table tbody tr');
  await expect(rowsAfter).toHaveCount(2);
  await expect(rowsAfter.filter({ hasText: 'e2e-none-2' }).getByText('成功', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /重试失败项/ })).toHaveCount(0);

  const after = await page.request.get(`/api/messages/${partial.id}`);
  const afterData = (await after.json()).data;
  expect(afterData.uuid).toBe(partial.uuid); // same message, no new record
  expect(afterData.status).toBe('success');
  expect(afterData.deliveries.every((d: { status: string }) => d.status === 'success')).toBe(true);
});
