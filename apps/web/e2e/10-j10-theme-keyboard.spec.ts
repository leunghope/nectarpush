import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SCREENSHOT_DIR = resolve(process.cwd(), '../../docs/qa-evidence/screenshots');

/**
 * J10 — 双主题 / 响应式 / 键盘可用性（PRD NFR 可用性，PROTOTYPE_AUDIT 主题与断点）。
 * Theme must persist through localStorage and be applied by the inline pre-paint
 * script before the module bundle runs; 1440/1280/1024/768 must not overflow.
 */
test('J10a 双主题持久化，刷新无闪烁', async ({ page }) => {
  // The inline head script applies np-theme before the module script is parsed.
  const html = await (await page.request.get('/')).text();
  const themeIdx = html.indexOf('np-theme');
  const moduleIdx = html.search(/<script[^>]*type="module"/);
  expect(themeIdx, 'inline theme bootstrap present').toBeGreaterThan(-1);
  expect(moduleIdx, 'module bundle present').toBeGreaterThan(themeIdx);

  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.getByRole('button', { name: '切换到明亮主题' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => localStorage.getItem('np-theme'))).toBe('light');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.getByRole('button', { name: '切换到暗色主题' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('J10b 响应式 1440/1280/1024/768 无横向溢出', async ({ page }) => {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  for (const width of [1440, 1280, 1024, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '工作台' })).toBeVisible();
    await page.screenshot({ path: join(SCREENSHOT_DIR, `J10-workbench-${width}.png`) });

    if (width >= 1280) await expect(page.locator('.topbar')).toBeVisible();
    else await expect(page.locator('.topbar')).toBeHidden();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
  }
});

test('J10c 纯键盘：跳过链接 / 焦点可见 / Esc 关闭弹窗', async ({ page }) => {
  await page.goto('/');

  // 1) Exactly one skip link; the first Tab lands on it and Enter moves real
  //    keyboard focus into <main> (Q-11).
  await expect(page.locator('.skip-link')).toHaveCount(1);
  await page.keyboard.press('Tab');
  await expect(page.locator('.skip-link')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#main-content');
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.id ?? ''))
    .toBe('main-content');
  expect(
    await page.evaluate(() => {
      const main = document.getElementById('main-content');
      if (!main) return false;
      const rect = main.getBoundingClientRect();
      return rect.top < window.innerHeight && rect.bottom > 0;
    }),
  ).toBe(true);

  // 2) Keyboard focus is visible (global :focus-visible ring, 2px accent).
  await page.keyboard.press('Tab');
  const outline = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const style = getComputedStyle(el);
    return { tag: el.tagName, style: style.outlineStyle, width: style.outlineWidth };
  });
  expect(outline.tag).not.toBe('BODY');
  expect(outline.style).not.toBe('none');
  expect(outline.width).not.toBe('0px');

  // 3) Esc closes the destructive-confirm dialog and returns focus context.
  await page.goto('/messages');
  await page.getByRole('button', { name: '清空', exact: true }).click();
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(120);
  expect(
    await page.evaluate(() =>
      document.querySelector('[role="dialog"]')?.contains(document.activeElement),
    ),
  ).toBe(true);
  // Q-11: Tab is trapped inside the dialog (forward and backward wrapping).
  const tabStayedInside = async () => {
    const tags: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('Tab');
      tags.push(
        await page.evaluate(() => {
          const active = document.activeElement as HTMLElement | null;
          return active ? `${active.tagName}:${active.textContent?.trim().slice(0, 12) ?? ''}` : 'none';
        }),
      );
    }
    return tags;
  };
  for (const tag of await tabStayedInside()) expect(tag).not.toBe('none');
  expect(
    await page.evaluate(() =>
      document.querySelector('[role="dialog"]')?.contains(document.activeElement),
    ),
  ).toBe(true);

  await page.keyboard.press('Shift+Tab');
  expect(
    await page.evaluate(() =>
      document.querySelector('[role="dialog"]')?.contains(document.activeElement),
    ),
  ).toBe(true);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});