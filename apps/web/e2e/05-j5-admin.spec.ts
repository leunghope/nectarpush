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

  // Root-only system settings.
  await page.goto('/settings');
  const general = page.locator('section#general');
  await general.locator('input').first().fill('NectarPush E2E');
  await page.getByRole('button', { name: '保存全部设置' }).click();
  await expect(page.getByText('全部设置已保存')).toBeVisible();

  // Q-05 / AC-068 regression: boolean options must stay 'true'/'false' (not be
  // masked to ''), so the password-login switch renders as 开启 rather than 关闭.
  const pwdRow = page.locator('section#auth').locator('.setting-row', { hasText: '密码登录' }).first();
  await expect(pwdRow.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  await expect(pwdRow.getByRole('switch')).toHaveAttribute('aria-label', '开启');

  await page.reload();
  const reloaded = page.locator('section#general');
  await expect(reloaded.locator('input').first()).toHaveValue('NectarPush E2E');
  const reloadedPwd = page.locator('section#auth').locator('.setting-row', { hasText: '密码登录' }).first();
  await expect(reloadedPwd.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
});
