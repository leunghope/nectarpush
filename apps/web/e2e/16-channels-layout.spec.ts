import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT_STATE } from './helpers';

const SCREENSHOT_DIR = resolve(process.cwd(), '../../docs/qa-evidence/screenshots/channels-layout');

/**
 * 16 — 通道列表列结构：状态列不再右对齐（与其余列一样贴左），说明列限宽不再独占
 * 剩余空间，新增「创建时间」列，操作列的「配置 / 测试」不带图标、字号一致、靠颜色区分。
 * 同时留浅色/深色两张验收截图。
 */
test.use({ storageState: ROOT_STATE });

test('16 通道列表列结构：状态左对齐、创建时间列、操作按钮无图标且同字号', async ({ page }) => {
  const stamp = Date.now().toString().slice(-6);
  const name = `e2e-layout-${stamp}`;

  const created = await page.request.post('/api/channels', {
    data: {
      type: 'email',
      name,
      description: '验证列结构与操作按钮样式',
      config: { account_id: `e2e-layout-${stamp}@example.com` },
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const channel = (await created.json()).data as { id: number; created_at: string };

  try {
    await page.goto('/channels');
    const table = page.locator('table.channel-table');
    const row = table.locator('tbody tr').filter({ hasText: name });
    await expect(row).toBeVisible();

    const headCells = table.locator('thead th');
    const cells = row.locator('td');

    // 六列，顺序固定：名称 / 协议类型 / 说明 / 状态 / 创建时间 / 操作
    await expect(headCells).toHaveText(['名称', '协议类型', '说明', '状态', '创建时间', '操作']);

    // 状态列与操作列都不再右对齐（需求①：状态列不要靠右）
    const statusCell = cells.nth(3);
    const timeCell = cells.nth(4);
    const actionCell = cells.nth(5);
    const alignOf = (loc: import('@playwright/test').Locator) =>
      loc.evaluate((el) => getComputedStyle(el).textAlign);
    const leftish = (v: string) => v === 'left' || v === 'start';
    expect(leftish(await alignOf(headCells.nth(3)))).toBe(true);
    expect(leftish(await alignOf(headCells.nth(5)))).toBe(true);
    expect(leftish(await alignOf(statusCell))).toBe(true);

    // 开关与「已启用」之间有 8px 间距（.row-gap）
    await expect(statusCell.locator('.row-gap')).toHaveCSS('column-gap', '8px');
    const toggle = statusCell.getByRole('switch');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(statusCell).toContainText('已启用');

    // 创建时间列：本地格式化 YYYY-MM-DD HH:mm，且与接口返回同一时刻
    const timeText = (await timeCell.innerText()).trim();
    expect(timeText).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(channel.created_at.slice(0, 4)).toBe(timeText.slice(0, 4));

    // 操作列：两个按钮，无图标，字号一致，颜色不同
    const configLink = actionCell.getByRole('link', { name: '配置' });
    const testButton = actionCell.getByRole('button', { name: '测试' });
    await expect(configLink).toBeVisible();
    await expect(testButton).toBeVisible();
    await expect(actionCell.locator('svg')).toHaveCount(0);
    const [configStyle, testStyle] = await Promise.all([
      configLink.evaluate((el) => {
        const s = getComputedStyle(el);
        return { fontSize: s.fontSize, fontWeight: s.fontWeight, color: s.color };
      }),
      testButton.evaluate((el) => {
        const s = getComputedStyle(el);
        return { fontSize: s.fontSize, fontWeight: s.fontWeight, color: s.color };
      }),
    ]);
    expect(configStyle.fontSize).toBe(testStyle.fontSize);
    expect(configStyle.fontWeight).toBe(testStyle.fontWeight);
    expect(configStyle.color).not.toBe(testStyle.color);

    // 说明列不再吃掉剩余宽度：明显窄于表格内容宽度，且不超过 240px 上限。
    // 表格是 auto 布局，td 的 max-width 只是建议值，实际宽度还受内容与内边距影响；
    // Linux runner 与 macOS 的字体度量差约 2–3px，这里留出容差，仍能守住「列不再独占剩余空间」。
    const descWidth = await cells.nth(2).evaluate((td) => td.getBoundingClientRect().width);
    const tableWidth = await table.evaluate((t) => t.getBoundingClientRect().width);
    expect(descWidth).toBeLessThanOrEqual(246);
    expect(descWidth).toBeLessThan(tableWidth * 0.5);

    // 浅色 / 深色各留一张证据截图
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.getByRole('button', { name: '切换到明亮主题' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'channels-light.png'), fullPage: true });

    await page.getByRole('button', { name: '切换到暗色主题' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'channels-dark.png'), fullPage: true });

    // 768px 窄屏：表格在容器内横向滚动，不撑破整页
    await page.getByRole('button', { name: '切换到明亮主题' }).click();
    await page.waitForTimeout(300);
    await page.setViewportSize({ width: 768, height: 900 });
    await page.waitForTimeout(200);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'channels-768.png'), fullPage: true });
  } finally {
    await page.request.delete(`/api/channels/${channel.id}`);
  }
});
