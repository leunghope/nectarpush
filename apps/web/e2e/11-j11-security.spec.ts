import { expect, request as pwRequest, test, type APIRequestContext } from '@playwright/test';
import { BASE, ROOT_PASS, adminResetPassword, apiLogin, createUser, storageStateFor } from './helpers';

/**
 * J11 — 安全回归（PRD FR-055 / FR-002 / FR-045 / FR-024 / FR-026 / FR-013 /
 * FR-042 / FR-033 / FR-047 / FR-076；NFR 安全、限流、Cookie）。
 * Covers the D-01/D-02 regressions plus XSS, masking, token rotation, SQLi,
 * authentication and privilege boundaries. J11j (rate limit) lives in
 * 12-j11-rate-limit.spec.ts.
 */
test.use({ extraHTTPHeaders: { 'x-forwarded-for': '10.77.11.1' } });
const SEC_IP = '10.77.11.50';

type StorageState = Awaited<ReturnType<typeof storageStateFor>>;

function cookieHeader(state: StorageState): string {
  return state.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

async function ensureNoneChannel(req: APIRequestContext, name = 'e2e-none') {
  const list = await req.get('/api/channels?brief=true');
  const items = (await list.json()).data.items as { name: string }[];
  if (!items.some((c) => c.name === name)) {
    const created = await req.post('/api/channels', { data: { type: 'none', name, config: {}, enabled: true } });
    expect(created.ok(), await created.text()).toBeTruthy();
  }
}

async function waitForEvent(events: string[], needle: string, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (events.some((e) => e.includes(needle))) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

async function openSse(cookie: string) {
  const ac = new AbortController();
  const res = await fetch(`${BASE}/api/events`, {
    headers: { cookie, accept: 'text/event-stream' },
    signal: ac.signal,
  });
  const events: string[] = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          events.push(buffer.slice(0, idx));
          buffer = buffer.slice(idx + 2);
        }
      }
    } catch {
      /* aborted */
    }
  })();
  return { res, events, close: () => ac.abort() };
}

test('J11a SSE 跨用户隔离（D-01 回归）', async ({ page }) => {
  for (const [username, password] of [
    ['e2e-sse-a', 'sseUserA123'],
    ['e2e-sse-b', 'sseUserB123'],
  ] as const) {
    await createUser(page.request, username, password);
  }
  const a = await storageStateFor('e2e-sse-a', 'sseUserA123', SEC_IP);
  const b = await storageStateFor('e2e-sse-b', 'sseUserB123', SEC_IP);
  const aCtx = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { 'x-forwarded-for': SEC_IP, cookie: cookieHeader(a) } });
  const bCtx = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { 'x-forwarded-for': SEC_IP, cookie: cookieHeader(b) } });

  const channel = await aCtx.post('/api/channels', {
    data: { type: 'none', name: 'sse-none-a', config: {}, enabled: true },
  });
  if (!channel.ok()) expect([409, 422]).toContain(channel.status());
  const tokenRes = await aCtx.post('/api/me/token');
  expect(tokenRes.ok()).toBeTruthy();
  const token = (await tokenRes.json()).data.token as string;

  const sseA = await openSse(cookieHeader(a));
  const sseB = await openSse(cookieHeader(b));
  expect(sseA.res.status).toBe(200);
  expect(sseB.res.status).toBe(200);
  expect(await waitForEvent(sseA.events, 'event: connected')).toBeTruthy();
  expect(await waitForEvent(sseB.events, 'event: connected')).toBeTruthy();

  const title = `SSE 隔离 ${Date.now()}`;
  const pushed = await aCtx.post('/push/e2e-sse-a', {
    data: { token, channel: 'sse-none-a', title, content: '仅 A 可见' },
  });
  expect(pushed.ok(), await pushed.text()).toBeTruthy();

  expect(await waitForEvent(sseA.events, title)).toBeTruthy();
  await page.waitForTimeout(1200);
  expect(sseB.events.some((e) => e.includes(title))).toBeFalsy();
  sseA.close();
  sseB.close();
  await aCtx.dispose();
  await bCtx.dispose();
});

test('J11b 强制改密服务端拦截（D-02 回归）', async ({ page }) => {
  const id = await createUser(page.request, 'e2e-d02', 'd02OldPass1');
  await adminResetPassword(page.request, id, 'd02ResetPass1');

  const login = await apiLogin(page.request, 'e2e-d02', 'd02ResetPass1');
  expect(login.must_change_password).toBe(true);
  const state = await storageStateFor('e2e-d02', 'd02ResetPass1', SEC_IP);
  const ctx = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { 'x-forwarded-for': SEC_IP, cookie: cookieHeader(state) } });
  const blocked = await ctx.get('/api/messages');
  expect(blocked.status()).toBe(403);
  expect((await blocked.json()).code).toBe('PASSWORD_CHANGE_REQUIRED');

  const changed = await ctx.patch('/api/me', { data: { old_password: 'd02ResetPass1', password: 'd02NewPass12' } });
  expect(changed.ok(), await changed.text()).toBeTruthy();
  expect((await ctx.get('/api/messages')).status()).toBe(200);
  await ctx.dispose();
});

test('J11c 消息正文 XSS 被转义', async ({ page, browser }) => {
  await ensureNoneChannel(page.request);
  const tokenRes = await page.request.post('/api/me/token');
  expect(tokenRes.ok()).toBeTruthy();
  const token = (await tokenRes.json()).data.token as string;
  const title = `XSS <script>alert(1)</script> ${Date.now()}`;
  const content = '<img src=x onerror=alert(1)><script>window.__xss=1</script><b>safe</b>';
  const pushed = await page.request.post('/push/root', {
    data: { token, channel: 'e2e-none', title, content },
  });
  expect(pushed.ok(), await pushed.text()).toBeTruthy();
  const uuid = (await pushed.json()).data.uuid as string;

  const ctx = await browser.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] } });
  const anon = await ctx.newPage();
  let dialogs = 0;
  anon.on('dialog', async (d) => { dialogs++; await d.dismiss(); });
  await anon.goto(`/message/${uuid}`);
  await expect(anon.locator('.article')).toBeVisible();
  expect(await anon.locator('.article script').count()).toBe(0);
  expect(await anon.locator('.article img[src="x"]').count()).toBe(0);
  expect(await anon.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  expect(dialogs).toBe(0);

  const listed = await page.request.get(`/api/messages?keyword=${encodeURIComponent('XSS <script>')}`);
  const item = (await listed.json()).data.items[0] as { id: number };
  await page.goto(`/messages/${item.id}`);
  await expect(page.locator('h2', { hasText: '消息内容' })).toBeVisible();
  expect(await page.locator('script').filter({ hasText: 'window.__xss' }).count()).toBe(0);
  await ctx.close();
});

test('J11d 通道与系统设置中的密钥不出现明文', async ({ page }) => {
  const created = await page.request.post('/api/channels', {
    data: {
      type: 'telegram',
      name: 'e2e-sec-tg',
      config: { secret: 'SECRET-XYZ-123', account_id: '12345' },
      enabled: true,
    },
  });
  if (!created.ok()) expect([409, 422]).toContain(created.status());

  const list = await page.request.get('/api/channels?brief=false');
  expect(list.ok()).toBeTruthy();
  const raw = await list.text();
  expect(raw).not.toContain('SECRET-XYZ-123');
  const ch = (await list.json()).data.items.find((c: { name: string }) => c.name === 'e2e-sec-tg') as {
    config?: Record<string, unknown>;
  };
  expect(ch, 'e2e-sec-tg channel').toBeTruthy();
  expect(ch.config?.secret).toBe('******');

  const options = await page.request.get('/api/options');
  expect(options.ok()).toBeTruthy();
  const optRaw = await options.text();
  expect(optRaw).not.toContain('qa-pass');
  const sensitive = (await options.json()).data.items.filter((o: { sensitive?: boolean }) => o.sensitive);
  expect(sensitive.length).toBeGreaterThan(0);
  for (const o of sensitive) {
    expect([null, '', '******']).toContain(o.value);
  }
  expect(sensitive.some((o: { configured: boolean }) => o.configured)).toBeTruthy();
});

test('J11e 全局令牌只回显 masked，重新生成后旧令牌失效', async ({ page }) => {
  await ensureNoneChannel(page.request);
  const first = await page.request.post('/api/me/token');
  expect(first.ok()).toBeTruthy();
  const token1 = (await first.json()).data.token as string;
  expect(token1).toMatch(/^[a-f0-9]{32}$/);
  const push1 = await page.request.post('/push/root', {
    data: { token: token1, channel: 'e2e-none', title: '令牌 1', content: 'ok' },
  });
  expect(push1.ok(), await push1.text()).toBeTruthy();

  const second = await page.request.post('/api/me/token');
  expect(second.ok()).toBeTruthy();
  const token2 = (await second.json()).data.token as string;
  expect(token2).not.toBe(token1);
  const old = await page.request.post('/push/root', {
    data: { token: token1, channel: 'e2e-none', title: '旧令牌', content: 'should fail' },
  });
  expect(old.status()).toBe(401);
  expect((await old.json()).code).toBe('INVALID_TOKEN');
  const fresh = await page.request.post('/push/root', {
    data: { token: token2, channel: 'e2e-none', title: '令牌 2', content: 'ok' },
  });
  expect(fresh.ok(), await fresh.text()).toBeTruthy();

  const masked = await page.request.get('/api/me/push');
  const maskedToken = (await masked.json()).data.token_masked as string;
  expect(maskedToken).not.toContain(token2);
  expect(maskedToken).toContain('••••');
});

test('J11f keyword SQL 注入不改变结果集', async ({ page }) => {
  const res = await page.request.get(`/api/messages?page=1&page_size=20&keyword=${encodeURIComponent("' OR 1=1 --")}`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.success).toBe(true);
  expect(body.data.items).toHaveLength(0);
  expect(body.data.page.total).toBe(0);
});

test('J11g 会话 Cookie 标志位', async ({ page }) => {
  const res = await page.request.post('/api/auth/login', {
    headers: { 'x-forwarded-for': '10.77.11.9' },
    data: { username: 'root', password: ROOT_PASS },
  });
  expect(res.ok()).toBeTruthy();
  const setCookie = res.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie').map((h) => h.value).join('\n');
  expect(setCookie).toContain('np_session=');
  expect(setCookie.toLowerCase()).toContain('httponly');
  expect(setCookie.toLowerCase()).toContain('samesite=lax');
  // Q-08: HTTP 开发环境默认不带 Secure（不破坏本地登录）；HTTPS/生产由
  // PUBLIC_BASE_URL=https 或 COOKIE_SECURE=true 打开。该矩阵由
  // apps/api/test/contract.e2e.spec.ts 的 "Q-08 session cookie flags" 用真实
  // 控制器逐项验证（Secure/无 Secure 三种配置）。
  expect(setCookie.toLowerCase()).not.toContain('secure');
});

test('J11h 未授权端点统一 401', async ({ browser }) => {
  const ctx = await browser.newContext({
    baseURL: BASE,
    storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: { 'x-forwarded-for': '10.77.11.2' },
  });
  const req = ctx.request;
  const gets = ['/api/me', '/api/me/push', '/api/channels', '/api/webhooks', '/api/messages', '/api/users', '/api/options', '/api/events'];
  for (const path of gets) {
    const res = await req.get(path);
    expect(res.status(), path).toBe(401);
    expect((await res.json()).code, path).toBe('UNAUTHORIZED');
  }
  for (const [path, data] of [
    ['/api/messages', { channel: 'x', title: 't', content: 'c' }],
    ['/api/channels', { type: 'none', name: 'x', config: {} }],
    ['/api/webhooks', { name: 'x', target_channel: 'x' }],
    ['/api/users', { username: 'x', password: '12345678' }],
  ] as const) {
    const res = await req.post(path, { data });
    expect(res.status(), path).toBe(401);
    expect((await res.json()).code, path).toBe('UNAUTHORIZED');
  }
  const push = await req.post('/push/root', { data: { channel: 'e2e-none', title: 't', content: 'c' } });
  expect(push.status()).toBe(401);
  expect((await push.json()).code).toBe('TOKEN_REQUIRED');
  await ctx.close();
});

test('J11i 越权写入被拒绝', async ({ page }) => {
  await createUser(page.request, 'e2e-sec-user', 'secUser1234');
  await createUser(page.request, 'e2e-sec-adm', 'secAdmin1234', 'admin');

  const user = await storageStateFor('e2e-sec-user', 'secUser1234', SEC_IP);
  const uctx = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { 'x-forwarded-for': SEC_IP, cookie: cookieHeader(user) } });
  for (const [method, path, data] of [
    ['get', '/api/users', undefined],
    ['get', '/api/options', undefined],
    ['post', '/api/users', { username: 'e2e-sec-x', password: 'secXPass1234' }],
    ['patch', '/api/options', { key: 'SystemName', value: 'hacked' }],
  ] as const) {
    const res = method === 'get' ? await uctx.get(path) : method === 'post'
      ? await uctx.post(path, { data })
      : await uctx.patch(path, { data });
    expect(res.status(), path).toBe(403);
    expect((await res.json()).code, path).toBe('FORBIDDEN');
  }
  await uctx.dispose();

  const admin = await storageStateFor('e2e-sec-adm', 'secAdmin1234', SEC_IP);
  const actx = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { 'x-forwarded-for': SEC_IP, cookie: cookieHeader(admin) } });
  expect((await actx.get('/api/users')).status()).toBe(200);
  expect((await actx.patch('/api/options', { data: { key: 'SystemName', value: 'hacked' } })).status()).toBe(403);
  const escalate = await actx.post('/api/users', { data: { username: 'e2e-sec-x', password: 'secXPass1234', role: 'root' } });
  expect(escalate.status()).toBe(403);
  expect((await escalate.json()).code).toBe('FORBIDDEN');
  await actx.dispose();
});
