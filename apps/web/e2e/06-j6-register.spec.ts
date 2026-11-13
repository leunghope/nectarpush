import { expect, test } from '@playwright/test';
import { setOption } from './helpers';
import { startSmtpCatcher } from './smtp-catcher';

// Isolate this file's auth attempts from the 20/20min per-IP auth bucket.
test.use({ extraHTTPHeaders: { 'x-forwarded-for': '10.77.6.1' } });

/**
 * J6 — 注册 + 邮箱验证码 + 登录（PRD FR-001 / FR-006 / FR-007）。
 * When SMTP is not configured the backend must say so; then a loopback SMTP
 * sink receives the real code and the full registration works end to end.
 */
test('J6 注册：未配置 SMTP 提示 → 配置后收码 → 注册 → 登录 → 自动建 email 通道', async ({ page }) => {
  const smtp = await startSmtpCatcher();
  const username = 'e2e-reg';
  const password = 'e2eRegPass123';
  const email = 'e2e-reg@example.com';

  try {
    await page.goto('/register');
    await page.locator('#username').fill(username);
    await page.locator('#password').fill(password);
    await page.locator('#email').fill(email);

    // 1) SMTP 未配置：必须给出真实失败提示，而不是假装发送成功。
    await page.getByRole('button', { name: '获取验证码' }).click();
    await expect(page.getByText('管理员未开启邮箱验证')).toBeVisible();

    // 2) 配置本机 SMTP sink 后再开启邮箱验证（依赖校验要求先有 host+account）。
    await setOption(page.request, 'SMTPServer', '127.0.0.1');
    await setOption(page.request, 'SMTPAccount', 'qa@example.com');
    await setOption(page.request, 'SMTPToken', 'qa-pass');
    await setOption(page.request, 'SMTPPort', String(smtp.port));
    await setOption(page.request, 'EmailVerificationEnabled', 'true');

    await page.getByRole('button', { name: '获取验证码' }).click();
    await expect(page.getByText('验证码已发送，请查收邮箱')).toBeVisible();
    const mail = await smtp.waitForMessage(0);
    expect(mail.to).toEqual([email]);
    const code = /验证码是\s*(\d{6})/.exec(mail.text)?.[1];
    expect(code, `verification code in mail: ${mail.text}`).toBeTruthy();

    await page.locator('#code').fill(code!);
    await page.getByRole('button', { name: '注册' }).click();
    await expect(page.getByText('注册成功，请登录')).toBeVisible();

    // The page still carries the root session — sign it out before testing the
    // new account through the real login form.
    const logout = await page.request.post('/api/auth/logout');
    expect(logout.ok(), await logout.text()).toBeTruthy();
    await page.goto('/login');
    await expect(page).toHaveURL(/\/login/);

    // 3) 新账户可登录，且邮箱绑定后自动创建 email 通道（FR-007）。
    await page.locator('#username').fill(username);
    await page.locator('#password').fill(password);
    await page.getByRole('button', { name: '登录' }).click();
    await expect(page.getByRole('heading', { name: '工作台' })).toBeVisible();

    const me = await page.request.get('/api/me');
    expect((await me.json()).data.email).toBe(email);

    const channels = await page.request.get('/api/channels?brief=true');
    const items = (await channels.json()).data.items as Array<{ name: string; type: string }>;
    expect(items.some((c) => c.type === 'email' && c.name === 'email')).toBeTruthy();
  } finally {
    await smtp.close();
  }
});