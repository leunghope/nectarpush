import { expect, test } from '@playwright/test';
import { ROOT_STATE } from './helpers';

/**
 * 15 — Channel cards must show the saved description (the list used to request
 * the `brief` projection, which omits description), and editing must return to
 * the channel list after a successful save.
 */
test.use({ storageState: ROOT_STATE });

test('15 channel description renders on the card and edit save returns to the list', async ({ page }) => {
  const stamp = Date.now().toString().slice(-6);
  const name = `e2e-desc-${stamp}`;
  const description = `用于验证说明展示 ${stamp}`;
  const updated = `已更新的说明 ${stamp}`;

  const created = await page.request.post('/api/channels', {
    data: {
      type: 'email',
      name,
      description,
      config: { account_id: `e2e-desc-${stamp}@example.com` },
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const channel = (await created.json()).data as { id: number };

  try {
    await page.goto('/channels');
    const card = page.locator('.channel-card').filter({ hasText: name });
    await expect(card).toBeVisible();
    await expect(card.locator('.channel-target')).toHaveText(description);

    await page.goto(`/channels/${channel.id}/edit`);
    await expect(page.getByRole('heading', { name: '配置消息通道' })).toBeVisible();
    await page.locator('#ch-desc').fill(updated);
    await page.getByRole('button', { name: '保存配置' }).click();

    await expect(page).toHaveURL(/\/channels$/);
    const updatedCard = page.locator('.channel-card').filter({ hasText: name });
    await expect(updatedCard).toBeVisible();
    await expect(updatedCard.locator('.channel-target')).toHaveText(updated);
  } finally {
    await page.request.delete(`/api/channels/${channel.id}`);
  }
});