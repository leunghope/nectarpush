import { expect, request as pwRequest, test } from '@playwright/test';
import { BASE, ROOT_STATE, setOption } from './helpers';
import { startSmtpCatcher } from './smtp-catcher';

/**
 * 13 — 修复轮回归（用户报告 8 项）
 * 覆盖：导航图标/头像/菜单高亮/深色描边、公告即时关闭、Webhook 提取规则增删、
 * 个人设置邮箱与第三方绑定入口、登录页 OAuth 按钮、OIDC 发现表单。
 */

test.use({ storageState: ROOT_STATE });

async function patchOption(page: import('@playwright/test').Page, key: string, value: string) {
  const res = await page.request.patch('/api/options', { data: { key, value } });
  expect(res.ok(), `${key}: ${await res.text()}`).toBeTruthy();
}

test('13a 侧栏图标有描边、头像显示用户名首字母、子菜单不再同时高亮', async ({ page }) => {
  await page.goto('/messages');
  await expect(page.getByRole('heading', { name: '消息' })).toBeVisible();

  // 修复 2/4：Icon 合并基础类后，open-path 图标有 stroke 且不被填黑。
  const navIcon = page.locator('.nav-item[href="/messages"] .nav-icon');
  await expect(navIcon).toBeVisible();
  const style = await navIcon.evaluate((el) => {
    const s = getComputedStyle(el);
    return { fill: s.fill, stroke: s.stroke, width: el.getBoundingClientRect().width };
  });
  expect(style.fill).toBe('none');
  expect(style.stroke).not.toBe('rgb(0, 0, 0)');
  expect(style.width).toBeGreaterThan(8);

  // 修复 1：顶栏头像使用 display_name/username 的首字母，不再渲染 user glyph。
  const me = (await (await page.request.get('/api/me')).json()).data as {
    username: string;
    display_name?: string | null;
  };
  const name = (me.display_name || me.username).trim();
  const initial = Array.from(name)[0]?.toLocaleUpperCase() ?? '?';
  const avatar = page.locator('.topbar .account-trigger .avatar');
  await expect(avatar).toBeVisible();
  await expect(avatar).toHaveText(initial);
  await expect(avatar.locator('svg')).toHaveCount(0);
  const avatarBox = await avatar.boundingBox();
  expect(avatarBox?.width ?? 0).toBeGreaterThan(8);

  // 修复 3：/settings/other 只高亮自身。
  await page.goto('/settings/other');
  await expect(page.getByRole('heading', { name: '其他设置' })).toBeVisible();
  await expect(page.locator('.nav-item[href="/settings/other"]')).toHaveClass(/active/);
  await expect(page.locator('.nav-item[href="/settings"]')).not.toHaveClass(/active/);

  // 同类问题：/me/push 不应把 /me 也点亮。
  await page.goto('/me/push');
  await expect(page.locator('.nav-item[href="/me/push"]')).toHaveClass(/active/);
  await expect(page.locator('.nav-item[href="/me"]')).not.toHaveClass(/active/);
});

test('13b 公告点击关闭后立即消失（无需刷新）', async ({ page }) => {
  await patchOption(page, 'Notice', 'E2E 公告：维护通知');
  try {
    await page.goto('/');
    const banner = page.locator('.sse-banner');
    await expect(banner).toContainText('E2E 公告：维护通知');
    await page.getByRole('button', { name: '关闭公告' }).click();
    await expect(banner).toHaveCount(0);
    const dismissed = await page.evaluate(() => localStorage.getItem('np-announcement-dismissed'));
    expect(dismissed).toContain('E2E 公告');
    // 刷新后仍保持关闭
    await page.reload();
    await expect(page.locator('.sse-banner')).toHaveCount(0);
  } finally {
    await patchOption(page, 'Notice', '');
  }
});

test('13c Webhook 提取规则可增删并保存为键值对', async ({ page }) => {
  // 独立准备目标通道：不依赖 root 的邮箱/邮箱验证开关状态，避免被其它 spec 污染。
  const channels = await (await page.request.get('/api/channels')).json();
  for (const c of channels.data.items as { id: number; name: string }[]) {
    if (c.name === 'e2e-email') await page.request.delete(`/api/channels/${c.id}`);
  }
  const channelRes = await page.request.post('/api/channels', {
    data: { type: 'email', name: 'e2e-email', config: { account_id: 'root-webhook@example.com' } },
  });
  expect(channelRes.ok(), await channelRes.text()).toBeTruthy();
  const channel = (await channelRes.json()).data as { id: number };
  const webhookName = `e2e-rules-${Date.now().toString().slice(-6)}`;

  try {
    await page.goto('/webhooks/new');
    await expect(page.getByRole('heading', { name: '新建 Webhook' })).toBeVisible();

    await page.getByLabel('名称').fill(webhookName);
    await page.getByLabel('目标通道').selectOption('e2e-email');

    // 默认三行，添加后变四行（修复 5：此前按钮只改 state，永远不渲染）
    const rows = page.locator('.rule-row');
    await expect(rows).toHaveCount(3);
    await page.getByRole('button', { name: '添加提取规则' }).click();
    await expect(rows).toHaveCount(4);

    await page.getByLabel('变量名 4').fill('repo');
    await page.getByLabel('JSONPath 4').fill('repository.full_name');
    await page.getByLabel('变量名 1').fill('title');
    await page.getByLabel('JSONPath 1').fill('$.head_commit.message');
    await page.getByLabel('变量名 2').fill('content');
    await page.getByLabel('JSONPath 2').fill('$.head_commit.url');
    await page.getByLabel('变量名 3').fill('url');
    await page.getByLabel('JSONPath 3').fill('$.repository.html_url');

    await page.getByLabel('标题').fill('⭐ 新 Star：$repo');
    await page.getByLabel('正文').fill('$title');
    await page.getByRole('button', { name: '保存 Webhook' }).click();
    await expect(page.getByText('Webhook 已创建')).toBeVisible({ timeout: 15_000 });

    const list = await (await page.request.get('/api/webhooks')).json();
    const created = list.data.items.find((w: { name: string }) => w.name === webhookName);
    expect(created).toBeTruthy();
    expect(created.extract_rule).toEqual({
      title: '$.head_commit.message',
      content: '$.head_commit.url',
      url: '$.repository.html_url',
      repo: 'repository.full_name',
    });
    expect(created.construct_rule.title).toBe('⭐ 新 Star：$repo');
  } finally {
    const list = await (await page.request.get('/api/webhooks')).json();
    for (const w of list.data.items as { id: number; name: string }[]) {
      if (w.name.startsWith('e2e-rules-')) await page.request.delete(`/api/webhooks/${w.id}`);
    }
    await page.request.delete(`/api/channels/${channel.id}`);
  }
});

test('13d 个人设置改邮箱：SMTP 就绪时必须验证码，且同步 email 通道', async ({ page }) => {
  const smtp = await startSmtpCatcher();
  const options = (await (await page.request.get('/api/options')).json()).data.items as { key: string; value: string }[];
  const previous = (key: string) => options.find((o) => o.key === key)?.value ?? '';
  const restore = [
    'SMTPServer',
    'SMTPAccount',
    'SMTPToken',
    'SMTPPort',
    'EmailVerificationEnabled',
  ].map((key) => [key, previous(key)] as const);

  await setOption(page.request, 'SMTPServer', '127.0.0.1');
  await setOption(page.request, 'SMTPAccount', 'qa@example.com');
  await setOption(page.request, 'SMTPToken', 'qa-pass');
  await setOption(page.request, 'SMTPPort', String(smtp.port));
  // Deliberately keep the registration-mail toggle off: email changes must be
  // verified whenever SMTP is ready, independent of this option.
  await setOption(page.request, 'EmailVerificationEnabled', 'false');

  try {
    await page.goto('/me');
    await expect(page.getByRole('heading', { name: '个人设置' })).toBeVisible();

    const emailInput = page.getByLabel('邮箱');
    await emailInput.fill('root-me-e2e@example.com');
    await expect(page.locator('#me-email-code')).toBeVisible();

    // Without a code the save must fail even though EmailVerificationEnabled is off.
    await page.getByRole('button', { name: '保存资料' }).click();
    await expect(page.getByText('请填写 6 位邮箱验证码')).toBeVisible();

    await page.getByRole('button', { name: '发送验证码' }).click();
    const mail = await smtp.waitForMessage(0);
    expect(mail.to).toEqual(['root-me-e2e@example.com']);
    const code = /验证码是\s*(\d{6})/.exec(mail.text)?.[1];
    expect(code, `verification code in mail: ${mail.text}`).toBeTruthy();

    await page.locator('#me-email-code').fill(code!);
    await page.getByRole('button', { name: '保存资料' }).click();
    await expect(page.getByText('账户信息已更新')).toBeVisible({ timeout: 15_000 });

    const me = await (await page.request.get('/api/me')).json();
    expect(me.data.email).toBe('root-me-e2e@example.com');

    const channels = await (await page.request.get('/api/channels')).json();
    const emailChannel = channels.data.items.find((c: { type: string }) => c.type === 'email');
    expect(emailChannel.config.account_id).toBe('root-me-e2e@example.com');
    expect(emailChannel.enabled).toBe(true);

    const after = (await (await page.request.get('/api/options')).json()).data.items as { key: string; value: string }[];
    expect(after.find((o) => o.key === 'EmailVerificationEnabled')?.value).toBe('false');
  } finally {
    await page.request.patch('/api/me', { data: { email: '' } });
    for (const [key, value] of restore) await setOption(page.request, key, value);
    await smtp.close();
  }
});

test('13e 系统设置的自定义 OAuth 提供方展示发现端点入口', async ({ page }) => {
  const provider = {
    id: 'e2e-sso',
    display_name: 'E2E SSO',
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
    await expect(page.getByRole('heading', { name: '系统设置' })).toBeVisible();
    const discovery = page.getByLabel('发现端点（OIDC）').first();
    await expect(discovery).toBeVisible();
    await expect(page.getByRole('button', { name: '获取端点' }).first()).toBeVisible();
    // 已有 discovery 时默认折叠为摘要，但仍可展开手改
    await page.goto('/settings#oauth');
    await expect(page.locator('#oauth')).toContainText('OAuth2');
  } finally {
    await patchOption(page, 'OAuth2Providers', '[]');
  }
});

test.describe('匿名访问：登录页第三方登录按钮', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('13f 已配置提供方时登录页渲染按钮，且 start 端点 302', async ({ page }) => {
    // 复用已登录的 root 会话改配置，避免额外登录触发 auth 限流（12-j11 会打满该桶）
    const admin = await pwRequest.newContext({ baseURL: BASE, storageState: ROOT_STATE });
    const provider = {
      id: 'login-sso',
      display_name: 'Login SSO',
      authorize_url: 'https://sso.example.com/authorize',
      token_url: 'https://sso.example.com/token',
      userinfo_url: 'https://sso.example.com/userinfo',
      client_id: 'login-client',
      client_secret: 'login-secret',
      scope: 'openid profile email',
      map_username: 'sub',
    };
    const patched = await admin.patch('/api/options', {
      data: { key: 'OAuth2Providers', value: JSON.stringify([provider]) },
    });
    expect(patched.ok(), await patched.text()).toBeTruthy();

    try {
      await page.goto('/login');
      const sso = page.getByRole('link', { name: '使用 Login SSO 登录' });
      await expect(sso).toBeVisible();
      await expect(sso).toHaveAttribute('href', '/api/auth/oauth/login-sso/start');

      const start = await page.request.get('/api/auth/oauth/login-sso/start', { maxRedirects: 0 });
      expect(start.status()).toBe(302);
      expect(start.headers()['location']).toContain('https://sso.example.com/authorize');
    } finally {
      await admin.patch('/api/options', { data: { key: 'OAuth2Providers', value: '[]' } });
      await admin.dispose();
    }
  });
});
