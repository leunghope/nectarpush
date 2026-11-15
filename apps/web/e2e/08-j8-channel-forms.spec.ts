import { expect, test } from '@playwright/test';

const EXPECTED_TYPES = [
  'bark',
  'client',
  'corp',
  'corp_app',
  'ding',
  'discord',
  'email',
  'group',
  'lark',
  'lark_app',
  'none',
  'one_bot',
  'telegram',
  'tencent_alarm',
  'test',
  'webhook',
].sort();

const EXPECTED_DRAFTS = ['corp', 'corp_app', 'lark_app', 'one_bot', 'tencent_alarm', 'test'].sort();

type ConfigField = { key: string; label: string; type: string; required: boolean };
type Descriptor = {
  type: string;
  display_name: string;
  status: 'core' | 'draft';
  hidden: boolean;
  capabilities: { to_mode: string };
  config_schema: { fields: ConfigField[] };
};

/**
 * J8 — 通道表单与类型注册表一致（PRD FR-025 / AC-025；FR-081 / AC-081）。
 * For every type the rendered config controls must be exactly the descriptor's
 * fields, and the 6 draft types must carry the 「骨架未联调」 label. `hidden`
 * types (currently only `none`) stay served by the API for existing channels
 * but are not offered on the create screen.
 */
test('J8 16 类通道表单字段与 /api/channels/types 一致，draft 标注骨架', async ({ page }) => {
  const res = await page.request.get('/api/channels/types');
  expect(res.ok(), await res.text()).toBeTruthy();
  const descriptors = (await res.json()).data.items as Descriptor[];

  expect(descriptors.map((d) => d.type).sort()).toEqual(EXPECTED_TYPES);
  expect(descriptors.filter((d) => d.status === 'draft').map((d) => d.type).sort()).toEqual(EXPECTED_DRAFTS);
  for (const d of descriptors) {
    expect(d.config_schema, `${d.type} descriptor`).toBeTruthy();
    expect(Array.isArray(d.config_schema.fields)).toBe(true);
  }

  const hidden = descriptors.filter((d) => d.hidden);
  const visible = descriptors.filter((d) => !d.hidden);

  await page.goto('/channels/new');

  // Hidden types must not be creatable — but their descriptors are still served.
  for (const d of hidden) {
    await expect(
      page.locator(`#ch-type option[value="${d.type}"]`),
      `${d.type} 不应出现在协议类型下拉`,
    ).toHaveCount(0);
  }

  for (const d of visible) {
    await page.locator('#ch-type').selectOption(d.type);
    await expect(page.getByRole('heading', { name: `${d.display_name} 通道配置` })).toBeVisible();

    const fields = d.config_schema.fields;
    const nonBooleanKeys = fields.filter((f) => f.type !== 'boolean').map((f) => f.key).sort();
    const renderedIds = await page
      .locator('[id^="cfg-"]')
      .evaluateAll((els) => els.map((el) => el.id.slice(4)).sort());
    expect(renderedIds, `${d.type} 渲染字段`).toEqual(nonBooleanKeys);

    for (const f of fields) {
      if (f.type === 'boolean') {
        // Switch has no id; its Field label is the observable contract.
        await expect(page.locator('label').filter({ hasText: f.label }).first()).toBeVisible();
      } else {
        await expect(page.locator(`#cfg-${f.key}`), `${d.type}.${f.key}`).toBeVisible();
      }
    }

    // draft 状态体现在协议下拉的选项文案里
    const selected = page.locator('#ch-type option:checked');
    if (d.status === 'draft') {
      await expect(selected).toContainText('骨架未联调');
    } else {
      await expect(selected).not.toContainText('骨架未联调');
    }
  }
});
/**
 * Existing channels of a hidden type must stay fully editable: hiding a type
 * only removes it from the create screen. `none` is the only such type today.
 */
test('J8b 存量 hidden 类型（none）的通道仍可打开编辑页并保存', async ({ page }) => {
  const created = await page.request.post('/api/channels', {
    data: { type: 'none', name: 'j8-none', config: {}, enabled: true },
  });
  // Reruns against a warm database hit DUPLICATE_NAME; the channel is what matters.
  if (!created.ok()) expect(created.status()).toBe(422);

  const list = await page.request.get('/api/channels?brief=true');
  const items = (await list.json()).data.items as { id: number; name: string; type: string }[];
  const legacy = items.find((c) => c.name === 'j8-none');
  expect(legacy, 'j8-none channel').toBeTruthy();

  await page.goto(`/channels/${legacy!.id}/edit`);
  await expect(page.locator('#ch-type')).toHaveValue('none');
  await expect(page.locator('#ch-type option')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: '不推送 通道配置' })).toBeVisible();

  await page.getByRole('button', { name: '保存配置' }).click();
  await page.waitForURL('**/channels');
  await expect(page.getByText('j8-none').first()).toBeVisible();
});
