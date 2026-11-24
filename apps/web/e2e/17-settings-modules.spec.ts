import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT_STATE } from './helpers';

const SCREENSHOT_DIR = resolve(process.cwd(), '../../docs/qa-evidence/screenshots/settings-modules');
const SIDEBAR_DIR = resolve(process.cwd(), '../../docs/qa-evidence/screenshots/sidebar');
const OAUTH_DIR = resolve(process.cwd(), '../../docs/qa-evidence/screenshots/oauth2-chevron');

/**
 * 17 — 需求②③④：系统设置按模块独立保存 + 每模块可折叠；OAuth2 展开箭头贴行最右
 * 并垂直居中；左侧菜单「管理」组移到最后。
 */
test.use({ storageState: ROOT_STATE });

async function patchOption(page: import('@playwright/test').Page, key: string, value: string) {
  const res = await page.request.patch('/api/options', { data: { key, value } });
  expect(res.ok(), `${key}: ${await res.text()}`).toBeTruthy();
}

test('17a 设置模块独立保存：改谁亮谁，保存 A 不冲掉 B 的未保存编辑', async ({ page }) => {
  await page.goto('/settings');
  const generalSave = page.getByTestId('settings-save-general');
  const authSave = page.getByTestId('settings-save-auth');
  await expect(generalSave).toBeDisabled();
  await expect(authSave).toBeDisabled();

  const originalName = await page.locator('section#general input').first().inputValue();

  // 改「通用」，只有它点亮
  await page.locator('section#general input').first().fill(`${originalName} `.trim() + '·m17');
  await expect(generalSave).toBeEnabled();
  await expect(authSave).toBeDisabled();

  // 再改「注册与登录」，两者都点亮
  const pwdSwitch = page.locator('section#auth .setting-row', { hasText: '邮箱验证' }).first().getByRole('switch');
  const pwdBefore = await pwdSwitch.getAttribute('aria-checked');
  await pwdSwitch.click();
  await expect(authSave).toBeEnabled();

  try {
    // 只保存「通用」
    await generalSave.click();
    await expect(page.getByText('已保存：通用')).toBeVisible();
    await expect(generalSave).toBeDisabled();
    // B 模块的编辑仍在，按钮仍可点
    await expect(authSave).toBeEnabled();
    await expect(pwdSwitch).toHaveAttribute('aria-checked', pwdBefore === 'true' ? 'false' : 'true');

    // 折叠 / 展开
    const toggle = page.getByTestId('settings-toggle-auth');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await page.locator('section#auth .setting-row').first().waitFor({ state: 'visible' });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('section#auth .setting-row')).toHaveCount(0);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('section#auth .setting-row').first()).toBeVisible();

    // 模块折叠箭头：贴行最右、与标题块垂直居中
    const head = page.locator('section#general .section-head-toggle');
    const chevron = page.locator('section#general .section-chevron');
    await expect(chevron).toBeVisible();
    const headBox = await head.boundingBox();
    const chevronBox = await chevron.boundingBox();
    expect(headBox && chevronBox).toBeTruthy();
    if (headBox && chevronBox) {
      const rightGap = headBox.x + headBox.width - (chevronBox.x + chevronBox.width);
      expect(rightGap).toBeLessThanOrEqual(2);
      const diff = Math.abs(chevronBox.y + chevronBox.height / 2 - (headBox.y + headBox.height / 2));
      expect(diff).toBeLessThanOrEqual(2);
    }

    // 截图证据（浅 / 深）：先把 sticky 侧栏与固定顶栏改为静态，避免整页截图里重复出现
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.addStyleTag({
      content:
        '.rail { position: static !important; height: auto !important; }' +
        '.topbar { position: static !important; }' +
        '.toast-stack { display: none !important; }',
    });
    await page.getByRole('button', { name: '切换到明亮主题' }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'settings-light.png'), fullPage: true });
    await page.getByRole('button', { name: '切换到暗色主题' }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'settings-dark.png'), fullPage: true });

    // 折叠态证据：收起中间几个模块，看手风琴结构
    await page.getByRole('button', { name: '切换到明亮主题' }).click();
    await page.waitForTimeout(300);
    for (const id of ['smtp', 'oauth', 'turnstile', 'render', 'auth']) {
      await page.getByTestId(`settings-toggle-${id}`).click();
    }
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'settings-collapsed-light.png'), fullPage: true });
    await page.getByRole('button', { name: '切换到暗色主题' }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'settings-collapsed-dark.png'), fullPage: true });
  } finally {
    // 还原：站点名称与邮箱验证开关
    await page.request.patch('/api/options', { data: { key: 'SystemName', value: originalName } });
    await page.request.patch('/api/options', { data: { key: 'EmailVerificationEnabled', value: pwdBefore ?? 'false' } });
  }
});

test('17b 侧栏分组顺序：管理在最下方，账户在它上面', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.rail-nav')).toBeVisible();
  const labels = (await page.locator('.rail-nav .nav-label').allInnerTexts()).map((s) => s.trim());
  expect(labels).toEqual(['工作', '连接', '账户', '管理']);

  mkdirSync(SIDEBAR_DIR, { recursive: true });
  await page.getByRole('button', { name: '切换到明亮主题' }).click();
  await page.waitForTimeout(300);
  await page.locator('.rail').screenshot({ path: join(SIDEBAR_DIR, 'sidebar-light.png') });
  await page.getByRole('button', { name: '切换到暗色主题' }).click();
  await page.waitForTimeout(300);
  await page.locator('.rail').screenshot({ path: join(SIDEBAR_DIR, 'sidebar-dark.png') });
});

test('17c OAuth2 展开箭头贴最右且垂直居中', async ({ page }) => {
  const provider = {
    id: 'e2e-chevron',
    display_name: 'E2E Chevron',
    authorize_url: 'https://sso.example.com/authorize',
    token_url: 'https://sso.example.com/token',
    userinfo_url: 'https://sso.example.com/userinfo',
    client_id: 'e2e-client',
    client_secret: 'e2e-secret',
    scope: 'openid profile email',
    map_username: 'sub',
    map_email: 'email',
  };
  await patchOption(page, 'OAuth2Providers', JSON.stringify([provider]));
  try {
    await page.goto('/settings');
    const head = page.locator('section#oauth .oauth-provider-head').first();
    const chevron = head.locator('.oauth-provider-chevron');
    await expect(chevron).toBeVisible();

    const box = await chevron.boundingBox();
    const headBox = await head.boundingBox();
    expect(box && headBox).toBeTruthy();
    if (box && headBox) {
      // 贴最右：箭头右边缘距行右边缘（含内边距）不超过 20px，且没有别的元素在它右边
      const rightGap = headBox.x + headBox.width - (box.x + box.width);
      expect(rightGap).toBeLessThanOrEqual(20);
      // 垂直居中：箭头中心与行中心偏差 ≤ 2px
      const chevronMid = box.y + box.height / 2;
      const headMid = headBox.y + headBox.height / 2;
      expect(Math.abs(chevronMid - headMid)).toBeLessThanOrEqual(2);
    }

    // 箭头也能展开手风琴
    await expect(head.getByRole('button').first()).toHaveAttribute('aria-expanded', 'false');
    await chevron.click();
    await expect(head.locator('.oauth-provider-chevron')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByLabel(/发现端点（OIDC）/).first()).toBeVisible();

    mkdirSync(OAUTH_DIR, { recursive: true });
    await page.getByRole('button', { name: '切换到明亮主题' }).click();
    await page.waitForTimeout(300);
    await page.locator('section#oauth').screenshot({ path: join(OAUTH_DIR, 'oauth-light.png') });
    await page.getByRole('button', { name: '切换到暗色主题' }).click();
    await page.waitForTimeout(300);
    await page.locator('section#oauth').screenshot({ path: join(OAUTH_DIR, 'oauth-dark.png') });
  } finally {
    await patchOption(page, 'OAuth2Providers', '[]');
  }
});
