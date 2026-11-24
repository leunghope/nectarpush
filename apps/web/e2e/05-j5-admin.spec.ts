import { expect, test } from '@playwright/test';

/**
 * J5 — administration: create a user from the admin form, then edit a system
 * option (root-only) and confirm it survives a reload.
 */
test('J5 用户管理 + 系统设置', async ({ page }) => {
  await page.goto('/users/new');
  await page.getByLabel(/用户名/).fill('e2e-user');
  await page.getByLabel(/初始密码/).fill('e2ePass123');
  await page.getByRole('button', { name: '创建用户' }).click();
  await expect(page.getByText('用户已创建')).toBeVisible();

  await page.goto('/users');
  await expect(page.getByText('e2e-user').first()).toBeVisible();

  // 需求4：编辑页改成单列（账号信息并入右侧），权限字号回到 h3，且有第三方登录面板。
  await page.locator('table.data-table tbody tr', { hasText: 'e2e-user' }).first().getByRole('link', { name: '编辑' }).click();
  await expect(page.getByRole('heading', { name: '编辑用户' })).toBeVisible();
  await expect(page.locator('.grid-side')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '第三方登录' })).toBeVisible();
  await expect(page.getByText('该用户尚未绑定第三方登录')).toBeVisible();
  await expect(page.getByRole('heading', { name: '向他人的邮箱发送消息', level: 3 })).toBeVisible();

  // Root-only system settings.
  await page.goto('/settings');
  const general = page.locator('section#general');
  await general.locator('input').first().fill('NectarPush E2E');
  // 需求3：设置页按模块独立保存 —— 只有改动过的模块按钮可点
  const generalSave = page.getByTestId('settings-save-general');
  await expect(generalSave).toBeEnabled();
  await expect(page.getByTestId('settings-save-auth')).toBeDisabled();
  await generalSave.click();
  await expect(page.getByText('已保存：通用')).toBeVisible();
  await expect(generalSave).toBeDisabled();

  // Q-05 / AC-068 regression: boolean options must stay 'true'/'false' (not be
  // masked to ''), so the password-login switch renders as 开启 rather than 关闭.
  const pwdRow = page.locator('section#auth').locator('.setting-row', { hasText: '密码登录' }).first();
  await expect(pwdRow.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  await expect(pwdRow.getByRole('switch')).toHaveAttribute('aria-label', '开启');

  await page.reload();
  const reloaded = page.locator('section#general');
  await expect(reloaded.locator('input').first()).toHaveValue('NectarPush E2E');
  // 需求2：浏览器标题默认跟站点名称走
  await expect(page).toHaveTitle(/NectarPush E2E/);
  const reloadedPwd = page.locator('section#auth').locator('.setting-row', { hasText: '密码登录' }).first();
  await expect(reloadedPwd.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
});
