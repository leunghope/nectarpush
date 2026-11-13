import { expect, test } from '@playwright/test';

const EXPECTED_TYPES = [
  'bark',
  'client',
  'corp',
  'corp_app',
  'custom',
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
].sort();

const EXPECTED_DRAFTS = ['corp', 'corp_app', 'lark_app', 'one_bot', 'tencent_alarm', 'test'].sort();

type ConfigField = { key: string; label: string; type: string; required: boolean };
type Descriptor = {
  type: string;
  display_name: string;
  status: 'core' | 'draft';
  capabilities: { to_mode: string };
  config_schema: { fields: ConfigField[] };
};

/**
 * J8 — 通道表单与类型注册表一致（PRD FR-025 / AC-025；FR-081 / AC-081）。
 * For every type the rendered config controls must be exactly the descriptor's
 * fields, and the 6 draft types must carry the 「骨架未联调」 label.
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

  await page.goto('/channels/new');

  for (const d of descriptors) {
    const option = page.locator('.type-option', { hasText: `${d.type} · ${d.display_name}` });
    await option.click();
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

    const badge = page.getByText('骨架未联调');
    if (d.status === 'draft') {
      await expect(badge.first()).toBeVisible();
    } else {
      await expect(badge).toHaveCount(0);
    }
  }
});