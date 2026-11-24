import { expect, test } from '@playwright/test';
import { setOption } from './helpers';
import { startSmtpCatcher } from './smtp-catcher';

test.use({ extraHTTPHeaders: { 'x-forwarded-for': '10.77.7.1' } });

/**
 * J7 — 找回密码闭环（PRD FR-004 / FR-005，阶段3 D-06）。The reset mail is
 * captured on a loopback SMTP sink; the user self-sets the new password on the
 * reset page (the API never returns plaintext), the new password works while
 * the old one is rejected, and the reset token must be single-use.
 */
test('J7 重置密码：邮件取 token → 页面自设新密码 → 新密码可登录 → 旧密码失效 → token 单次使用', async ({ page }) => {
  const smtp = await startSmtpCatcher();
  const username = 'e2e-reset';
  const oldPassword = 'oldPass12345';
  const newPassword = 'newPass12345';
  const email = 'e2e-reset@example.com';

  try {
    await setOption(page.request, 'SMTPServer', '127.0.0.1');
    await setOption(page.request, 'SMTPAccount', 'qa@example.com');
    await setOption(page.request, 'SMTPToken', 'qa-pass');
    await setOption(page.request, 'SMTPPort', String(smtp.port));
    await setOption(page.request, 'EmailVerificationEnabled', 'true');

    // Register a real account that carries an email address.
    const verify = await page.request.post('/api/auth/verification', { data: { email } });
    expect(verify.ok(), await verify.text()).toBeTruthy();
    const verifyMail = await smtp.waitForMessage(0);
    const code = /验证码是\s*(\d{6})/.exec(verifyMail.text)?.[1];
    expect(code).toBeTruthy();

    const register = await page.request.post('/api/auth/register', {
      data: { username, password: oldPassword, email, verification_code: code },
    });
    expect(register.ok(), await register.text()).toBeTruthy();

    // Request a reset and read the token from the delivered link.
    const before = smtp.messages.length;
    const req = await page.request.post('/api/auth/reset-request', { data: { email } });
    expect(req.ok(), await req.text()).toBeTruthy();
    const resetMail = await smtp.waitForMessage(before);
    expect(resetMail.to).toEqual([email]);
    const token = /token=([a-f0-9]{16})/.exec(resetMail.text)?.[1];
    expect(token, `reset token in mail: ${resetMail.text}`).toBeTruthy();

    // D-06: self-set the new password through the real reset page form.
    await page.goto(`/reset-password?token=${token}&email=${encodeURIComponent(email)}`);
    await page.locator('#new-password').fill(newPassword);
    await page.locator('#confirm-password').fill(newPassword);
    await page.getByRole('button', { name: '重置密码' }).click();
    await expect(page.getByText('密码已重置，请使用新密码登录。')).toBeVisible();

    // Old password no longer works.
    const oldLogin = await page.request.post('/api/auth/login', { data: { username, password: oldPassword } });
    expect(oldLogin.status()).toBe(401);

    // The new password works and no longer forces a change (D-06).
    const newLogin = await page.request.post('/api/auth/login', { data: { username, password: newPassword } });
    expect(newLogin.ok(), await newLogin.text()).toBeTruthy();
    expect((await newLogin.json()).data.must_change_password).toBe(false);

    // Reset tokens are single-use.
    const reuse = await page.request.post('/api/auth/reset-confirm', {
      data: { email, token, new_password: 'anotherPass123', new_password_confirm: 'anotherPass123' },
    });
    expect(reuse.status()).toBeGreaterThanOrEqual(400);

    // D-06 envelope contract: a fresh API confirm returns success only —
    // no data payload and no plaintext password anywhere in the response.
    const before2 = smtp.messages.length;
    const req2 = await page.request.post('/api/auth/reset-request', { data: { email } });
    expect(req2.ok(), await req2.text()).toBeTruthy();
    const resetMail2 = await smtp.waitForMessage(before2);
    const token2 = /token=([a-f0-9]{16})/.exec(resetMail2.text)?.[1];
    expect(token2).toBeTruthy();
    const apiPassword = 'apiPass12345';
    const confirm = await page.request.post('/api/auth/reset-confirm', {
      data: { email, token: token2, new_password: apiPassword, new_password_confirm: apiPassword },
    });
    expect(confirm.ok(), await confirm.text()).toBeTruthy();
    const confirmRaw = await confirm.text();
    expect(confirmRaw).not.toContain(apiPassword);
    const confirmBody = JSON.parse(confirmRaw);
    expect(confirmBody.success).toBe(true);
    expect(confirmBody.data?.new_password).toBeUndefined();
    const apiLogin = await page.request.post('/api/auth/login', { data: { username, password: apiPassword } });
    expect(apiLogin.ok(), await apiLogin.text()).toBeTruthy();
  } finally {
    await smtp.close();
  }
});
