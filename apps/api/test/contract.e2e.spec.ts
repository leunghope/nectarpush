import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrap, call, cookieOf, loginRoot } from './helpers/app';
import { PrismaService } from '../src/prisma/prisma.service';

let base = '';
let rootCookie = '';

afterAll(async () => {
  const t = await bootstrap();
  await t.close();
  t.cleanup();
});

describe('public endpoints (contract: /api/health, /api/version, /api/public/*)', () => {
  it('GET /api/health returns HealthData', async () => {
    const t = await bootstrap();
    base = t.base;
    const res = await call(base, '/api/health');
    expect(res.status).toBe(200);
    expect(res.body?.success).toBe(true);
    expect(res.body?.data).toMatchObject({ status: 'ok' });
    expect(typeof (res.body?.data as Record<string, unknown>).uptime_seconds).toBe('number');
    expect(['ok', 'degraded']).toContain((res.body?.data as Record<string, unknown>).database);
  });

  it('GET /api/version returns VersionData', async () => {
    const res = await call(base, '/api/version');
    expect(res.status).toBe(200);
    const data = res.body?.data as Record<string, unknown>;
    expect(typeof data.version).toBe('string');
    expect('commit' in data).toBe(true);
  });

  it('GET /api/public/branding returns site name, English name and icon', async () => {
    const res = await call(base, '/api/public/branding');
    expect(res.status).toBe(200);
    const data = res.body?.data as Record<string, unknown>;
    expect(typeof data.site_name).toBe('string');
    expect(typeof data.site_name_en).toBe('string');
    expect(typeof data.icon).toBe('string');
  });

  it('GET /api/update/check requires an authenticated root session', async () => {
    const res = await call(base, '/api/update/check');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false, code: 'UNAUTHORIZED' });
  });

  it('GET /api/public/about and /announcement return {content}', async () => {
    const about = await call(base, '/api/public/about');
    expect(about.status).toBe(200);
    expect(typeof (about.body?.data as Record<string, unknown>).content).toBe('string');
    const ann = await call(base, '/api/public/announcement');
    expect(ann.status).toBe(200);
    expect(typeof (ann.body?.data as Record<string, unknown>).content).toBe('string');
  });

  it('unauthenticated /api/me returns 401 UNAUTHORIZED envelope', async () => {
    const res = await call(base, '/api/me');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false, code: 'UNAUTHORIZED' });
    expect(typeof res.body?.message).toBe('string');
  });
});

describe('auth + me (contract: /api/auth/*, /api/me)', () => {
  it('root login sets cookie and reports must_change_password', async () => {
    const res = await call(base, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'root', password: '123456' }),
    });
    expect(res.status).toBe(200);
    expect(res.setCookie).toContain('np_session=');
    const data = res.body?.data as { user: { username: string; role: string }; must_change_password: boolean };
    expect(data.user.username).toBe('root');
    expect(data.user.role).toBe('root');
    expect(data.must_change_password).toBe(true);
    rootCookie = (res.setCookie ?? '').split(';')[0];
  });

  it('wrong password returns 401 UNAUTHORIZED', async () => {
    const res = await call(base, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'root', password: 'nope-nope' }),
    });
    expect(res.status).toBe(401);
    expect(res.body?.code).toBe('UNAUTHORIZED');
  });

  it('mustChangePassword session is blocked with 403 PASSWORD_CHANGE_REQUIRED until changed (D-02)', async () => {
    // blocked on a protected read (this very endpoint)
    const me = await call(base, '/api/me', { cookie: rootCookie });
    expect(me.status).toBe(403);
    expect(me.body).toMatchObject({ success: false, code: 'PASSWORD_CHANGE_REQUIRED' });

    // blocked on another guarded route as well
    const channels = await call(base, '/api/channels', { cookie: rootCookie });
    expect(channels.status).toBe(403);
    expect(channels.body?.code).toBe('PASSWORD_CHANGE_REQUIRED');

    // exempt: logout stays reachable
    const logout = await call(base, '/api/auth/logout', { method: 'POST', cookie: rootCookie });
    expect(logout.status).toBe(200);

    // exempt: PATCH /api/me performs the change
    const change = await call(base, '/api/me', {
      method: 'PATCH',
      cookie: rootCookie,
      body: JSON.stringify({ old_password: '123456', password: 'root-e2e-pass' }),
    });
    expect(change.status).toBe(200);
    expect((change.body?.data as Record<string, unknown>).must_change_password).toBe(false);

    // recovery: protected endpoints work again with a fresh session
    const relogin = await call(base, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'root', password: 'root-e2e-pass' }),
    });
    expect(relogin.status).toBe(200);
    expect((relogin.body?.data as { must_change_password: boolean }).must_change_password).toBe(false);
    rootCookie = cookieOf(relogin.setCookie);
    const after = await call(base, '/api/me', { cookie: rootCookie });
    expect(after.status).toBe(200);
  });

  it('GET /api/me returns UserView for the session holder', async () => {
    const res = await call(base, '/api/me', { cookie: rootCookie });
    expect(res.status).toBe(200);
    const user = res.body?.data as Record<string, unknown>;
    expect(user.username).toBe('root');
    expect(user.permissions).toEqual(
      expect.objectContaining({ send_email_to_others: true, save_message: true }),
    );
    // D-02: the forced-change flag is part of UserView
    expect(user.must_change_password).toBe(false);
    // D-06: soft-delete timestamp is part of UserView
    expect(user.deleted_at).toBe(null);
  });

  it('GET /api/me/push returns PushSettingsData', async () => {
    const res = await call(base, '/api/me/push', { cookie: rootCookie });
    expect(res.status).toBe(200);
    const data = res.body?.data as Record<string, unknown>;
    expect(data.username).toBe('root');
    expect(String(data.push_endpoint)).toContain('/push/root');
    expect(typeof (data.examples as Record<string, string>).curl).toBe('string');
    expect(data.token_masked === null || typeof data.token_masked === 'string').toBe(true);
  });

  it('POST /api/me/token issues a 32-hex token and masks it afterwards', async () => {
    const res = await call(base, '/api/me/token', { method: 'POST', cookie: rootCookie });
    expect(res.status).toBe(200);
    const token = (res.body?.data as Record<string, unknown>).token as string;
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    const settings = await call(base, '/api/me/push', { cookie: rootCookie });
    const masked = (settings.body?.data as Record<string, unknown>).token_masked as string | null;
    expect(masked).toMatch(/^••••|^[0-9a-f]{4}••••[0-9a-f]{3}$/);
  });

  it('register respects RegisterEnabled and creates a loginable user', async () => {
    const reg = await call(base, '/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username: 'e2euser', password: 'e2e-pass-42', display_name: 'E2E' }),
    });
    expect(reg.status).toBe(200);
    expect(reg.body?.message).toBe('注册成功');

    const login = await call(base, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'e2euser', password: 'e2e-pass-42' }),
    });
    expect(login.status).toBe(200);
    expect((login.body?.data as { must_change_password: boolean }).must_change_password).toBe(false);
  });

  it('duplicate registration returns 422 DUPLICATE_NAME', async () => {
    const res = await call(base, '/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username: 'e2euser', password: 'e2e-pass-42' }),
    });
    expect(res.status).toBe(422);
    expect(res.body?.code).toBe('DUPLICATE_NAME');
  });

  it('logout responds with the 已登出 message envelope', async () => {
    const login = await call(base, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'e2euser', password: 'e2e-pass-42' }),
    });
    const cookie = (login.setCookie ?? '').split(';')[0];
    const res = await call(base, '/api/auth/logout', { method: 'POST', cookie });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, message: '已登出' });
  });
});

describe('channels (contract: /api/channels, /api/channels/types)', () => {
  it('types returns 16 descriptors with form-driving schema', async () => {
    rootCookie = await loginRoot(base, 'root-e2e-pass');
    const res = await call(base, '/api/channels/types', { cookie: rootCookie });
    expect(res.status).toBe(200);
    const data = res.body?.data as { items: Array<Record<string, unknown>>; total: number };
    expect(data.total).toBe(16);
    expect(data.items).toHaveLength(16);
    const tg = data.items.find((i) => i.type === 'telegram') as Record<string, any>;
    expect(tg.display_name).toBe('Telegram');
    expect(tg.status).toBe('core');
    expect(tg.capabilities.to_mode).toBe('chat');
    const secretField = (tg.config_schema.fields as Array<Record<string, unknown>>).find(
      (f) => f.key === 'secret',
    );
    expect(secretField?.secret).toBe(true);
    expect(secretField?.type).toBe('password');
    // one_bot naming (G-01)
    expect(data.items.some((i) => i.type === 'one_bot')).toBe(true);
    expect(data.items.some((i) => i.type === 'email')).toBe(true);
  });

  it('create masks secrets, list paginates, detail/update/delete round-trip', async () => {
    const create = await call(base, '/api/channels', {
      method: 'POST',
      cookie: rootCookie,
      body: JSON.stringify({
        name: 'e2e-bark',
        type: 'bark',
        config: { url: 'https://api.day.app', secret: 'e2e-push-key' },
      }),
    });
    expect(create.status).toBe(200);
    const channel = create.body?.data as Record<string, any>;
    expect(channel.name).toBe('e2e-bark');
    expect(channel.config.secret).toBe('******'); // masked (F: 敏感字段脱敏)
    const id = channel.id as number;

    const list = await call(base, '/api/channels', { cookie: rootCookie });
    const listData = list.body?.data as { items: unknown[]; page: Record<string, number> };
    expect(Array.isArray(listData.items)).toBe(true);
    expect(listData.page).toEqual(
      expect.objectContaining({ page: 1, total: listData.items.length }),
    );

    const detail = await call(base, `/api/channels/${id}`, { cookie: rootCookie });
    expect((detail.body?.data as Record<string, unknown>).name).toBe('e2e-bark');

    const update = await call(base, `/api/channels/${id}?status_only=true`, {
      method: 'PATCH',
      cookie: rootCookie,
      body: JSON.stringify({ enabled: false }),
    });
    expect((update.body?.data as Record<string, unknown>).enabled).toBe(false);

    // empty secret keeps the stored value (F: 空 secret 保留旧值)
    const keep = await call(base, `/api/channels/${id}`, {
      method: 'PATCH',
      cookie: rootCookie,
      body: JSON.stringify({ config: { url: 'https://api.day.app', secret: '' } }),
    });
    expect((keep.body?.data as Record<string, any>).config.secret).toBe('******');

    const del = await call(base, `/api/channels/${id}`, { method: 'DELETE', cookie: rootCookie });
    expect(del.body).toMatchObject({ success: true, message: '通道已删除' });
    const gone = await call(base, `/api/channels/${id}`, { cookie: rootCookie });
    expect(gone.status).toBe(404);
    expect(gone.body?.code).toBe('CHANNEL_NOT_FOUND');
  });

  it('rejects the reserved channel name email', async () => {
    const res = await call(base, '/api/channels', {
      method: 'POST',
      cookie: rootCookie,
      body: JSON.stringify({ name: 'email', type: 'none' }),
    });
    expect(res.status).toBe(422);
    expect(res.body?.code).toBe('CHANNEL_NAME_RESERVED');
  });
});

describe('messages + push (contract: /push/{username}, /api/messages)', () => {
  it('console send via none channel persists and lists with filters', async () => {
    await call(base, '/api/channels', {
      method: 'POST',
      cookie: rootCookie,
      body: JSON.stringify({ name: 'e2e-none', type: 'none' }),
    });

    const send = await call(base, '/api/messages', {
      method: 'POST',
      cookie: rootCookie,
      body: JSON.stringify({ channel: 'e2e-none', title: 'e2e 构建完成', content: '# ok' }),
    });
    expect(send.status).toBe(200);
    const data = send.body?.data as { uuid: string; status: string };
    expect(data.status).toBe('success');
    expect(data.uuid).toMatch(/^[0-9a-f]{32}$/);

    const list = await call(base, '/api/messages?keyword=%E6%9E%84%E5%BB%BA', {
      cookie: rootCookie,
    });
    const page = list.body?.data as { items: Array<Record<string, unknown>>; page: Record<string, number> };
    expect(page.items.length).toBeGreaterThanOrEqual(1);
    expect(page.page.page_size).toBe(20);

    const detail = await call(base, `/api/messages/${page.items[0].id}`, { cookie: rootCookie });
    const d = detail.body?.data as Record<string, any>;
    expect(Array.isArray(d.deliveries)).toBe(true);
    expect(d.deliveries[0]).toEqual(
      expect.objectContaining({ channel_name: 'e2e-none', status: 'success' }),
    );

    const status = await call(base, `/api/messages/${data.uuid}/status`);
    expect(status.status).toBe(200);
    expect(status.body?.data).toMatchObject({ uuid: data.uuid, status: 'success' });

    const resend = await call(
      base,
      `/api/messages/${page.items[0].id}/resend`,
      { method: 'POST', cookie: rootCookie },
    );
    expect(resend.body?.data).toMatchObject({ status: 'success' });

    const del = await call(base, `/api/messages/${page.items[0].id}`, {
      method: 'DELETE',
      cookie: rootCookie,
    });
    expect(del.body).toMatchObject({ success: true, message: '消息已删除' });
  });

  it('GET /push/{username} honors the two-level token scheme', async () => {
    // no token yet -> the default channel is missing, but the error must be a contract error
    const noUser = await call(base, '/push/nosuchuser?title=x');
    expect(noUser.status).toBe(404);
    expect(noUser.body?.code).toBe('USER_NOT_FOUND');

    const token = await call(base, '/api/me/token', { method: 'POST', cookie: rootCookie });
    const pushToken = (token.body?.data as Record<string, unknown>).token as string;

    const bad = await call(base, `/push/root?title=x&channel=e2e-none&token=wrong`);
    expect(bad.status).toBe(401);
    expect(bad.body?.code).toBe('INVALID_TOKEN');

    const none = await call(base, `/push/root?title=x&channel=e2e-none`);
    expect(none.status).toBe(401);
    expect(none.body?.code).toBe('TOKEN_REQUIRED');

    const ok = await call(base, `/push/root?title=hi&channel=e2e-none&token=${pushToken}`);
    expect(ok.status).toBe(200);
    expect((ok.body?.data as Record<string, unknown>).uuid).toMatch(/^[0-9a-f]{32}$/);
    expect((ok.body?.data as Record<string, unknown>).status).toBeUndefined(); // push data carries uuid only

    // Server酱-style aliases (B 表: short/desp/openid)
    const post = await call(base, '/push/root', {
      method: 'POST',
      body: JSON.stringify({ title: 't', desp: '# d', openid: 'e2e-none', token: pushToken }),
    });
    expect(post.status).toBe(200);
    expect((post.body?.data as Record<string, unknown>).uuid).toMatch(/^[0-9a-f]{32}$/);

    // versioned alias
    const v1 = await call(base, '/api/v1/push/root', {
      method: 'POST',
      body: JSON.stringify({ title: 't', channel: 'e2e-none', token: pushToken }),
    });
    expect(v1.status).toBe(200);
  });

  it('Q-02 (FR-042): /push accepts Authorization: Bearer on GET, POST and /api/v1', async () => {
    const token = await call(base, '/api/me/token', { method: 'POST', cookie: rootCookie });
    const pushToken = (token.body?.data as Record<string, unknown>).token as string;

    // Bearer only on GET
    const get = await call(base, '/push/root?title=b&channel=e2e-none', {
      headers: { authorization: `Bearer ${pushToken}` },
    });
    expect(get.status).toBe(200);

    // RFC 7235: the auth scheme is case-insensitive
    const lower = await call(base, '/push/root?title=b&channel=e2e-none', {
      headers: { authorization: `bearer ${pushToken}` },
    });
    expect(lower.status).toBe(200);

    // Bearer only on POST /push/{username}
    const post = await call(base, '/push/root', {
      method: 'POST',
      headers: { authorization: `Bearer ${pushToken}` },
      body: JSON.stringify({ title: 'b', channel: 'e2e-none' }),
    });
    expect(post.status).toBe(200);

    // Bearer only on POST /api/v1/push/{username}
    const v1 = await call(base, '/api/v1/push/root', {
      method: 'POST',
      headers: { authorization: `Bearer ${pushToken}` },
      body: JSON.stringify({ title: 'b', channel: 'e2e-none' }),
    });
    expect(v1.status).toBe(200);

    // A wrong Bearer is still rejected with the contract code
    const bad = await call(base, '/push/root?title=b&channel=e2e-none', {
      headers: { authorization: 'Bearer wrong' },
    });
    expect(bad.status).toBe(401);
    expect(bad.body?.code).toBe('INVALID_TOKEN');

    // No token in header/body/query -> TOKEN_REQUIRED
    const missing = await call(base, '/push/root?title=b&channel=e2e-none');
    expect(missing.status).toBe(401);
    expect(missing.body?.code).toBe('TOKEN_REQUIRED');

    // Body token keeps precedence over a stale/wrong header (legacy clients)
    const precedence = await call(base, '/push/root', {
      method: 'POST',
      headers: { authorization: 'Bearer wrong' },
      body: JSON.stringify({ title: 'b', channel: 'e2e-none', token: pushToken }),
    });
    expect(precedence.status).toBe(200);
  });

  it('Q-03 (AC-044): async message status converges to success/partial/failed', async () => {
    const token = await call(base, '/api/me/token', { method: 'POST', cookie: rootCookie });
    const pushToken = (token.body?.data as Record<string, unknown>).token as string;

    // --- success: async send to a none channel ---
    const ok = await call(base, `/push/root?title=q03-ok&channel=e2e-none&async=true&token=${pushToken}`);
    expect(ok.status).toBe(200);
    const okUuid = (ok.body?.data as Record<string, unknown>).uuid as string;
    expect(await pollMessageStatus(okUuid)).toBe('success');

    // --- partial: group whose second child is disabled ---
    const a = await call(base, '/api/channels', {
      method: 'POST',
      cookie: rootCookie,
      body: JSON.stringify({ name: 'q03-a', type: 'none' }),
    });
    const b = await call(base, '/api/channels', {
      method: 'POST',
      cookie: rootCookie,
      body: JSON.stringify({ name: 'q03-b', type: 'none' }),
    });
    const idA = (a.body?.data as Record<string, unknown>).id as number;
    const idB = (b.body?.data as Record<string, unknown>).id as number;
    await call(base, `/api/channels/${idB}`, {
      method: 'PATCH',
      cookie: rootCookie,
      body: JSON.stringify({ status_only: true, enabled: false }),
    });
    const group = await call(base, '/api/channels', {
      method: 'POST',
      cookie: rootCookie,
      body: JSON.stringify({
        name: 'q03-group',
        type: 'group',
        config: { other: `${idA},${idB}` },
      }),
    });
    expect(group.status).toBe(200);
    const partial = await call(
      base,
      `/push/root?title=q03-partial&channel=q03-group&async=true&token=${pushToken}`,
    );
    expect(partial.status).toBe(200);
    const partialUuid = (partial.body?.data as Record<string, unknown>).uuid as string;
    expect(await pollMessageStatus(partialUuid)).toBe('partial');

    // 1.1/1.3: a group message carries one delivery row per child channel, each
    // with its own status, so the detail page can show the real per-channel result.
    const partialList = await call(base, '/api/messages?keyword=q03-partial', { cookie: rootCookie });
    const partialId = (partialList.body?.data as { items: Array<{ id: number }> }).items[0].id;
    const partialDetail = await call(base, `/api/messages/${partialId}`, { cookie: rootCookie });
    const pd = partialDetail.body?.data as Record<string, any>;
    expect(pd.deliveries).toHaveLength(2);
    expect(pd.deliveries[0]).toMatchObject({ channel_name: 'q03-a', status: 'success', error: null });
    expect(pd.deliveries[1]).toMatchObject({ channel_name: 'q03-b', status: 'failed' });
    expect(String(pd.deliveries[1].error)).toContain('已被禁用');

    // 1.2: retry re-sends only the failed rows in place (same message, same uuid).
    const retry = await call(base, `/api/messages/${partialId}/retry`, {
      method: 'POST',
      cookie: rootCookie,
    });
    expect(retry.status).toBe(200);
    const retried = retry.body?.data as Record<string, any>;
    expect(retried.uuid).toBe(partialUuid);
    expect(retried.status).toBe('partial');
    expect(retried.deliveries).toHaveLength(2);
    expect(retried.deliveries[0]).toMatchObject({ channel_name: 'q03-a', status: 'success' });
    expect(retried.deliveries[1]).toMatchObject({ channel_name: 'q03-b', status: 'failed' });

    // Nothing to retry -> 422, not a silent no-op.
    const okList = await call(base, '/api/messages?keyword=q03-ok', { cookie: rootCookie });
    const okId = (okList.body?.data as { items: Array<{ id: number }> }).items[0].id;
    const noFail = await call(base, `/api/messages/${okId}/retry`, {
      method: 'POST',
      cookie: rootCookie,
    });
    expect(noFail.status).toBe(422);
    expect(noFail.body?.code).toBe('VALIDATION_FAILED');

    // --- validation: children must be the owner's own, non-group channels ---
    const missing = await call(base, '/api/channels', {
      method: 'POST',
      cookie: rootCookie,
      body: JSON.stringify({ name: 'q03-bad', type: 'group', config: { other: '999999' } }),
    });
    expect(missing.status).toBe(422);

    const groupId = (group.body?.data as Record<string, unknown>).id as number;
    const nested = await call(base, '/api/channels', {
      method: 'POST',
      cookie: rootCookie,
      body: JSON.stringify({ name: 'q03-nested', type: 'group', config: { other: String(groupId) } }),
    });
    expect(nested.status).toBe(422);

    const selfRef = await call(base, `/api/channels/${groupId}`, {
      method: 'PATCH',
      cookie: rootCookie,
      body: JSON.stringify({ config: { other: String(groupId) } }),
    });
    expect(selfRef.status).toBe(422);

    // A channel owned by somebody else is not a valid child either.
    const otherLogin = await call(base, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'e2euser', password: 'e2e-pass-42' }),
    });
    const otherCookie = (otherLogin.setCookie ?? '').split(';')[0];
    const otherChannel = await call(base, '/api/channels', {
      method: 'POST',
      cookie: otherCookie,
      body: JSON.stringify({ name: 'q03-other', type: 'none' }),
    });
    expect(otherChannel.status).toBe(200);
    const otherId = (otherChannel.body?.data as Record<string, unknown>).id as number;
    const foreign = await call(base, '/api/channels', {
      method: 'POST',
      cookie: rootCookie,
      body: JSON.stringify({ name: 'q03-foreign', type: 'group', config: { other: String(otherId) } }),
    });
    expect(foreign.status).toBe(422);

    // --- failed: a child that existed at save time was deleted afterwards ---
    const gone = await call(base, '/api/channels', {
      method: 'POST',
      cookie: rootCookie,
      body: JSON.stringify({ name: 'q03-gone', type: 'none' }),
    });
    const goneId = (gone.body?.data as Record<string, unknown>).id as number;
    const group2 = await call(base, '/api/channels', {
      method: 'POST',
      cookie: rootCookie,
      body: JSON.stringify({ name: 'q03-group2', type: 'group', config: { other: String(goneId) } }),
    });
    expect(group2.status).toBe(200);
    await call(base, `/api/channels/${goneId}`, { method: 'DELETE', cookie: rootCookie });
    const failed = await call(
      base,
      `/push/root?title=q03-failed&channel=q03-group2&async=true&token=${pushToken}`,
    );
    expect(failed.status).toBe(200);
    const failedUuid = (failed.body?.data as Record<string, unknown>).uuid as string;
    expect(await pollMessageStatus(failedUuid)).toBe('failed');

    // A deleted child still gets its own failed row, with channel_id null.
    const failedList = await call(base, '/api/messages?keyword=q03-failed', { cookie: rootCookie });
    const failedId = (failedList.body?.data as { items: Array<{ id: number }> }).items[0].id;
    const failedDetail = await call(base, `/api/messages/${failedId}`, { cookie: rootCookie });
    const fd = failedDetail.body?.data as Record<string, any>;
    expect(fd.deliveries).toHaveLength(1);
    expect(fd.deliveries[0]).toMatchObject({ status: 'failed', channel_id: null });
    expect(String(fd.deliveries[0].channel_name)).toContain('已删除通道');
  });

  it('Q-04 (AC-004): reset-request never reveals whether an email is registered', async () => {
    // Register a user whose email is known, then compare the response with an
    // unknown address. SMTP is intentionally NOT configured in this test db:
    // before the fix the registered branch returned 422 SMTP_NOT_CONFIGURED
    // while the unknown branch returned 200 (account enumeration).
    const reg = await call(base, '/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: 'q04user',
        password: 'q04-pass-99',
        email: 'q04@example.com',
      }),
    });
    expect(reg.status).toBe(200);

    const known = await call(base, '/api/auth/reset-request', {
      method: 'POST',
      body: JSON.stringify({ email: 'q04@example.com' }),
    });
    const unknown = await call(base, '/api/auth/reset-request', {
      method: 'POST',
      body: JSON.stringify({ email: 'nobody-at-all@example.com' }),
    });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
    expect(known.body?.message).toBe('若邮箱已注册，重置邮件已发送');

    // A configured-but-broken SMTP (connection refused) must behave the same.
    await call(base, '/api/options', {
      method: 'PATCH',
      cookie: rootCookie,
      body: JSON.stringify({ key: 'SMTPServer', value: '127.0.0.1' }),
    });
    await call(base, '/api/options', {
      method: 'PATCH',
      cookie: rootCookie,
      body: JSON.stringify({ key: 'SMTPPort', value: '9' }),
    });
    const broken = await call(base, '/api/auth/reset-request', {
      method: 'POST',
      body: JSON.stringify({ email: 'q04@example.com' }),
    });
    expect(broken.status).toBe(200);
    expect(broken.body?.message).toBe('若邮箱已注册，重置邮件已发送');
    // restore the unconfigured default for the remaining tests
    await call(base, '/api/options', {
      method: 'PATCH',
      cookie: rootCookie,
      body: JSON.stringify({ key: 'SMTPServer', value: '' }),
    });
  });

  it('async without persistence permission returns 422 ASYNC_NOT_ALLOWED', async () => {
    const token = await call(base, '/api/me/token', { method: 'POST', cookie: rootCookie });
    const pushToken = (token.body?.data as Record<string, unknown>).token as string;
    // root has allowSaveMessage=true; force the branch via a user without it
    const reg = await call(base, '/api/users', {
      method: 'POST',
      cookie: rootCookie,
      body: JSON.stringify({ username: 'noasync', password: 'no-async-99' }),
    });
    expect(reg.status).toBe(200);
    const createdId = (reg.body?.data as Record<string, unknown>).id as number;
    const disallow = await call(base, `/api/users/${createdId}/manage`, {
      method: 'POST',
      cookie: rootCookie,
      body: JSON.stringify({ action: 'disallow_save_message' }),
    });
    expect(disallow.status).toBe(200);
    const userToken = await call(base, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'noasync', password: 'no-async-99' }),
    });
    const cookie = (userToken.setCookie ?? '').split(';')[0];
    const tok = await call(base, '/api/me/token', { method: 'POST', cookie });
    const t = (tok.body?.data as Record<string, unknown>).token as string;
    const res = await call(base, '/push/noasync?title=x&async=true&token=' + t);
    expect(res.status).toBe(422);
    expect(res.body?.code).toBe('ASYNC_NOT_ALLOWED');
    void pushToken;
  });
});

describe('webhooks (contract: /api/webhooks, /webhook/{name})', () => {
  it('create → trigger → list → delete round-trip', async () => {
    const create = await call(base, '/api/webhooks', {
      method: 'POST',
      cookie: rootCookie,
      body: JSON.stringify({
        name: 'e2e-ci',
        target_channel: 'e2e-none',
        extract_rule: { repo: 'repository.full_name', who: 'sender.login' },
        construct_rule: { title: 'CI: $repo', description: 'by $who' },
      }),
    });
    expect(create.status).toBe(200);
    const wh = create.body?.data as Record<string, any>;
    expect(wh.link).toMatch(/^[0-9a-f]{32}$/);
    expect(String(wh.trigger_url)).toContain(`/webhook/${wh.link}`);
    expect(wh.extract_rule).toEqual({ repo: 'repository.full_name', who: 'sender.login' });

    const trigger = await call(base, `/webhook/${wh.link}`, {
      method: 'POST',
      body: JSON.stringify({
        repository: { full_name: 'org/repo' },
        sender: { login: 'octocat' },
      }),
    });
    expect(trigger.status).toBe(200);
    expect((trigger.body?.data as Record<string, unknown>).uuid).toMatch(/^[0-9a-f]{32}$/);

    const list = await call(base, '/api/webhooks?keyword=e2e', { cookie: rootCookie });
    const data = list.body?.data as { items: unknown[]; page: Record<string, number> };
    expect(data.items.length).toBe(1);

    const del = await call(base, `/api/webhooks/${wh.id}`, { method: 'DELETE', cookie: rootCookie });
    expect(del.body).toMatchObject({ success: true, message: 'Webhook 已删除' });
    const gone = await call(base, `/webhook/${wh.link}`, {
      method: 'POST',
      body: JSON.stringify({ repository: { full_name: 'x' } }),
    });
    expect(gone.status).toBe(404);
    expect(gone.body?.code).toBe('WEBHOOK_NOT_FOUND');
  });
});

describe('users + options (contract: /api/users, /api/options)', () => {
  it('admin user management with rank rules and soft-delete anonymization', async () => {
    const create = await call(base, '/api/users', {
      method: 'POST',
      cookie: rootCookie,
      body: JSON.stringify({ username: 'tempadmin', password: 'temp-admin-1', role: 'admin' }),
    });
    expect(create.status).toBe(200);
    const user = create.body?.data as Record<string, any>;
    expect(user.role).toBe('admin');
    const id = user.id as number;

    // cannot create a user at/above own rank
    const selfRank = await call(base, '/api/users', {
      method: 'POST',
      cookie: rootCookie,
      body: JSON.stringify({ username: 'root2', password: 'root2-pass-1', role: 'root' }),
    });
    expect(selfRank.status).toBe(403);

    const oauthList = await call(base, `/api/users/${id}/oauth`, { cookie: rootCookie });
    expect(oauthList.status).toBe(200);
    expect((oauthList.body?.data as { items: unknown[] }).items).toEqual([]);
    const missingBinding = await call(base, `/api/users/${id}/oauth/github`, { method: 'DELETE', cookie: rootCookie });
    expect(missingBinding.status).toBe(404);
    expect(missingBinding.body?.code).toBe('OAUTH_BINDING_NOT_FOUND');

    const manage = await call(base, `/api/users/${id}/manage`, {
      method: 'POST',
      cookie: rootCookie,
      body: JSON.stringify({ action: 'disallow_send_email_to_others' }),
    });
    expect((manage.body?.data as Record<string, any>).permissions.send_email_to_others).toBe(false);

    const patch = await call(base, `/api/users/${id}`, {
      method: 'PATCH',
      cookie: rootCookie,
      body: JSON.stringify({ display_name: 'Temp Admin 2' }),
    });
    expect((patch.body?.data as Record<string, unknown>).display_name).toBe('Temp Admin 2');

    const del = await call(base, `/api/users/${id}`, { method: 'DELETE', cookie: rootCookie });
    expect(del.body).toMatchObject({ success: true, message: '用户已删除' });
    const gone = await call(base, `/api/users/${id}`, { cookie: rootCookie });
    expect(gone.status).toBe(404);
    expect(gone.body?.code).toBe('USER_NOT_FOUND');

    // pagination shape
    const list = await call(base, '/api/users?page=1&page_size=2', { cookie: rootCookie });
    const page = list.body?.data as { items: unknown[]; page: Record<string, number> };
    expect(page.page).toEqual({ page: 1, page_size: 2, total: expect.any(Number), total_pages: expect.any(Number) });
    expect(page.items.length).toBeLessThanOrEqual(2);
  });

  it('options list masks sensitive values and patch echoes the message', async () => {
    const list = await call(base, '/api/options', { cookie: rootCookie });
    const items = (list.body?.data as { items: Array<Record<string, any>> }).items;
    const smtp = items.find((i) => i.key === 'SMTPToken');
    expect(smtp.value).toBe('');
    expect(smtp.sensitive).toBe(true);

    const patch = await call(base, '/api/options', {
      method: 'PATCH',
      cookie: rootCookie,
      body: JSON.stringify({ key: 'SystemName', value: 'E2E NectarPush' }),
    });
    expect(patch.body).toMatchObject({ success: true, message: '设置已保存' });
    const after = await call(base, '/api/options', { cookie: rootCookie });
    const name = ((after.body?.data as { items: Array<Record<string, any>> }).items)
      .find((i) => i.key === 'SystemName');
    expect(name.value).toBe('E2E NectarPush');
  });

  it('Q-05 (AC-068): boolean switches are echoed verbatim, only real secrets are masked', async () => {
    const list = await call(base, '/api/options', { cookie: rootCookie });
    const items = (list.body?.data as { items: Array<Record<string, any>> }).items;
    const byKey = Object.fromEntries(items.map((i) => [i.key, i]));

    // Before the fix "PasswordLoginEnabled" matched /password/ and came back as
    // value:"" + sensitive:true, so the settings page rendered "关闭".
    expect(byKey.PasswordLoginEnabled).toMatchObject({
      value: 'true',
      sensitive: false,
      configured: true,
    });
    expect(byKey.RegisterEnabled).toMatchObject({ value: 'true', sensitive: false });
    expect(byKey.EmailVerificationEnabled).toMatchObject({ value: 'false', sensitive: false });

    // Real secret material keeps the mask contract.
    expect(byKey.SMTPToken.sensitive).toBe(true);
    expect(byKey.SMTPToken.value).toBe('');

    // Toggle persists the literal boolean, not a masked value.
    await call(base, '/api/options', {
      method: 'PATCH',
      cookie: rootCookie,
      body: JSON.stringify({ key: 'PasswordLoginEnabled', value: 'false' }),
    });
    const after = await call(base, '/api/options', { cookie: rootCookie });
    const toggled = ((after.body?.data as { items: Array<Record<string, any>> }).items)
      .find((i) => i.key === 'PasswordLoginEnabled');
    expect(toggled).toMatchObject({ value: 'false', sensitive: false });
    await call(base, '/api/options', {
      method: 'PATCH',
      cookie: rootCookie,
      body: JSON.stringify({ key: 'PasswordLoginEnabled', value: 'true' }),
    });
  });

  it('non-root cannot read options (403 FORBIDDEN)', async () => {
    const login = await call(base, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'e2euser', password: 'e2e-pass-42' }),
    });
    const cookie = (login.setCookie ?? '').split(';')[0];
    const res = await call(base, '/api/options', { cookie });
    expect(res.status).toBe(403);
    expect(res.body?.code).toBe('FORBIDDEN');
  });
});

/* ---------- Stage 9: OAuth2 form config (O-1 form encoding, O-2 redaction) ---------- */

describe('OAuth2 providers form config (Stage 9 O-1/O-2)', () => {
  const authentik = {
    id: 'authentik',
    display_name: 'Example SSO',
    authorize_url: 'https://sso.example.com/application/o/authorize/',
    token_url: 'https://sso.example.com/application/o/token/',
    userinfo_url: 'https://sso.example.com/application/o/userinfo/',
    client_id: 'test-client-id',
    client_secret: 'S3CR3T-VALUE-9',
    scope: 'openid email profile',
    map_username: 'sub',
    map_email: 'email',
  };

  async function patchOption(key: string, value: string) {
    return call(base, '/api/options', {
      method: 'PATCH',
      cookie: rootCookie,
      body: JSON.stringify({ key, value }),
    });
  }

  async function oauthOptionValue(): Promise<string> {
    const res = await call(base, '/api/options', { cookie: rootCookie });
    const item = (res.body?.data?.items ?? []).find(
      (i: { key: string }) => i.key === 'OAuth2Providers',
    );
    return item?.value ?? '';
  }

  it('O-2: saving a provider never echoes client_secret, only has_secret', async () => {
    const res = await patchOption('OAuth2Providers', JSON.stringify([authentik]));
    expect(res.status).toBe(200);
    const value = await oauthOptionValue();
    expect(value).not.toContain('S3CR3T-VALUE-9');
    const list = JSON.parse(value);
    expect(list[0].has_secret).toBe(true);
    expect('client_secret' in list[0]).toBe(false);
    // full response body must not leak the secret anywhere
    const raw = await call(base, '/api/options', { cookie: rootCookie });
    expect(JSON.stringify(raw.body)).not.toContain('S3CR3T-VALUE-9');
  });

  it('O-2: blank secret on re-save keeps the stored secret (has_secret stays true)', async () => {
    const res = await patchOption(
      'OAuth2Providers',
      JSON.stringify([{ ...authentik, client_secret: '' }]),
    );
    expect(res.status).toBe(200);
    const list = JSON.parse(await oauthOptionValue());
    expect(list[0].has_secret).toBe(true);
    expect(list[0].client_id).toBe('test-client-id');
  });

  it('O-1: a configured provider start endpoint redirects to authorize URL with client_id', async () => {
    const res = await fetch(`${base}/api/auth/oauth/authentik/start`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('sso.example.com/application/o/authorize/');
    expect(location).toContain('client_id=test-client-id');
  });

  it('O-3: invalid config → 422 VALIDATION_FAILED and existing config is not cleared', async () => {
    const bad = [
      [{ ...authentik, id: '' }],
      [authentik, { ...authentik }],
      [{ ...authentik, authorize_url: 'ftp://x' }],
      [{ ...authentik, client_id: '' }],
    ];
    for (const list of bad) {
      const res = await patchOption('OAuth2Providers', JSON.stringify(list));
      expect(res.status).toBe(422);
      expect(res.body?.code).toBe('VALIDATION_FAILED');
    }
    // previous valid config still present
    const after = JSON.parse(await oauthOptionValue());
    expect(after[0].id).toBe('authentik');
    expect(after[0].has_secret).toBe(true);
  });

  it('restores OAuth2Providers to empty so later provider tests stay unconfigured', async () => {
    const res = await patchOption('OAuth2Providers', '[]');
    expect(res.status).toBe(200);
    expect(JSON.parse(await oauthOptionValue())).toEqual([]);
  });
});

/* ---------- OAuth2 callback base: ServerAddress beats env/localhost (O-6/O-7) ---------- */

describe('OAuth2 callback base address (contract: /api/options/oauth2/callback)', () => {
  const provider = {
    id: 'authentik',
    display_name: 'Example SSO',
    authorize_url: 'https://sso.example.com/application/o/authorize/',
    token_url: 'https://sso.example.com/application/o/token/',
    userinfo_url: 'https://sso.example.com/application/o/userinfo/',
    client_id: 'test-client-id',
    client_secret: 'S3CR3T-VALUE-9',
    scope: 'openid email profile',
    map_username: 'sub',
    map_email: 'email',
  };
  const publicAddress = 'http://198.51.100.10:3300';

  async function patchOption(key: string, value: string) {
    return call(base, '/api/options', {
      method: 'PATCH',
      cookie: rootCookie,
      body: JSON.stringify({ key, value }),
    });
  }

  async function callbackBase() {
    const res = await call(base, '/api/options/oauth2/callback', { cookie: rootCookie });
    expect(res.status).toBe(200);
    return res.body?.data as { base_url: string; source: string };
  }

  it('O-6: start redirects with the redirect_uri built from ServerAddress', async () => {
    expect((await patchOption('OAuth2Providers', JSON.stringify([provider]))).status).toBe(200);
    expect((await patchOption('ServerAddress', `${publicAddress}/`)).status).toBe(200);

    // 基址按 ServerAddress 归一化（去尾斜杠），并标记来源
    expect(await callbackBase()).toEqual({ base_url: publicAddress, source: 'server_address' });

    const start = await fetch(`${base}/api/auth/oauth/authentik/start`, { redirect: 'manual' });
    expect(start.status).toBe(302);
    const location = decodeURIComponent(start.headers.get('location') ?? '');
    expect(location).toContain(
      `redirect_uri=${publicAddress}/api/auth/oauth/authentik/callback`,
    );

    // 绑定走同一个回调地址，否则第三方会以 redirect_uri 不匹配拒绝
    const bind = await fetch(`${base}/api/me/oauth/authentik/start`, {
      headers: { cookie: rootCookie },
      redirect: 'manual',
    });
    expect(bind.status).toBe(302);
    expect(decodeURIComponent(bind.headers.get('location') ?? '')).toContain(
      `redirect_uri=${publicAddress}/api/auth/oauth/authentik/callback`,
    );
  });

  it('O-7: clearing ServerAddress falls back to env/localhost and reports the fallback source', async () => {
    expect((await patchOption('ServerAddress', '')).status).toBe(200);
    const data = await callbackBase();
    const expected = process.env.PUBLIC_BASE_URL
      ? { source: 'public_base_url', base_url: process.env.PUBLIC_BASE_URL.replace(/\/+$/, '') }
      : { source: 'fallback', base_url: `http://127.0.0.1:${process.env.PORT || 3000}` };
    expect(data).toEqual(expected);
    expect((await patchOption('OAuth2Providers', '[]')).status).toBe(200);
  });

  it('O-6: the callback base endpoint is root-only', async () => {
    const anonymous = await call(base, '/api/options/oauth2/callback');
    expect(anonymous.status).toBe(401);
  });
});

/* ---------- S5 defect fixes (D-01 ~ D-07) ---------- */

/** Minimal SSE client for the /api/events contract (D-01). */
async function openSse(base: string, cookie: string) {
  const controller = new AbortController();
  const res = await fetch(`${base}/api/events`, {
    headers: { cookie },
    signal: controller.signal,
  });
  if (res.status !== 200 || !res.body) throw new Error(`sse connect failed: ${res.status}`);
  let text = '';
  const pump = (async () => {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  })().catch(() => undefined);
  return {
    text: () => text,
    close: async () => {
      controller.abort();
      await pump;
    },
  };
}

/**
 * Poll the public message status endpoint until it leaves the async_pending/
 * pending states (Q-03 / AC-044).
 */
async function pollMessageStatus(uuid: string, timeoutMs = 5000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await call(base, `/api/messages/${uuid}/status`);
    const status = res.status === 200 ? (res.body?.data as { status?: string })?.status : undefined;
    if (status && status !== 'async_pending' && status !== 'pending') return status;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`message ${uuid} status did not converge within ${timeoutMs}ms`);
}

async function waitUntil(cond: () => boolean, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`waitUntil timed out after ${timeoutMs}ms`);
}

describe('message defect fixes (D-03/D-04/D-05)', () => {
  it('clear-all default scope=own only deletes own messages (阶段3 D-18)', async () => {
    const login = await call(base, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'e2euser', password: 'e2e-pass-42' }),
    });
    const userCookie = (login.setCookie ?? '').split(';')[0];

    await call(base, '/api/channels', {
      method: 'POST',
      cookie: userCookie,
      body: JSON.stringify({ name: 'user-none', type: 'none' }),
    });
    const send = await call(base, '/api/messages', {
      method: 'POST',
      cookie: userCookie,
      body: JSON.stringify({ channel: 'user-none', title: 'e2euser 私有消息' }),
    });
    expect(send.status).toBe(200);

    // 不带 scope 默认 own：root 也只清本人，不影响其他用户
    const clear = await call(base, '/api/messages?scope=own', { method: 'DELETE', cookie: rootCookie });
    expect(clear.status).toBe(200);
    expect(clear.body).toMatchObject({ success: true, message: '已清空全部消息' });

    const rootList = await call(base, '/api/messages', { cookie: rootCookie });
    const rootPage = rootList.body?.data as { items: unknown[]; page: Record<string, number> };
    expect(rootPage.items).toHaveLength(0);
    expect(rootPage.page.total).toBe(0);

    const userList = await call(base, '/api/messages', { cookie: userCookie });
    const userPage = userList.body?.data as { items: unknown[]; page: Record<string, number> };
    expect(userPage.items.length).toBeGreaterThanOrEqual(1);
  });

  it('anonymous GET /api/messages/{uuid} returns the body without private fields (D-04)', async () => {
    const send = await call(base, '/api/messages', {
      method: 'POST',
      cookie: rootCookie,
      body: JSON.stringify({
        channel: 'e2e-none',
        title: '公开正文标题',
        content: '# 公开内容 <script>alert(1)</script>',
        url: 'https://example.com/e2e',
      }),
    });
    expect(send.status).toBe(200);
    const uuid = (send.body?.data as { uuid: string }).uuid;

    const res = await call(base, `/api/messages/${uuid}`);
    expect(res.status).toBe(200);
    const data = res.body?.data as Record<string, unknown>;
    expect(data.uuid).toBe(uuid);
    expect(data.title).toBe('公开正文标题');
    expect(data.content).toBe('# 公开内容 <script>alert(1)</script>'); // raw content, sanitized client-side
    expect(data.url).toBe('https://example.com/e2e');
    expect(data.status).toBe('success');
    expect(typeof data.render_mode).toBe('string');
    expect(typeof data.created_at).toBe('string');
    // no private fields leak
    expect(data.deliveries).toBeUndefined();
    expect('id' in data).toBe(false);
    expect('owner_id' in data).toBe(false);
    expect('ownerId' in data).toBe(false);
    expect('channel_name' in data).toBe(false);
    expect('to' in data).toBe(false);

    const unknown = await call(base, `/api/messages/${'0'.repeat(32)}`);
    expect(unknown.status).toBe(404);
    expect(unknown.body?.code).toBe('NOT_FOUND');

    // numeric path still requires a session
    const numeric = await call(base, '/api/messages/1');
    expect(numeric.status).toBe(401);
    expect(numeric.body?.code).toBe('UNAUTHORIZED');
  });

  it('PATCH /api/messages/{id} edits failed messages but rejects delivered ones (D-05)', async () => {
    // a channel that always fails fast (port 1 refuses connections)
    await call(base, '/api/channels', {
      method: 'POST',
      cookie: rootCookie,
      body: JSON.stringify({ name: 'e2e-fail', type: 'bark', config: { url: 'http://127.0.0.1:1', secret: 'k' } }),
    });
    const failed = await call(base, '/api/messages', {
      method: 'POST',
      cookie: rootCookie,
      body: JSON.stringify({ channel: 'e2e-fail', title: '会失败的消息', content: 'x' }),
    });
    expect(failed.status).toBe(200);
    const failedData = failed.body?.data as { uuid: string; status: string };
    expect(failedData.status).toBe('failed');

    const list = await call(base, '/api/messages?keyword=%E4%BC%9A%E5%A4%B1%E8%B4%A5', { cookie: rootCookie });
    const failedId = ((list.body?.data as { items: Array<Record<string, unknown>> }).items[0]).id as number;

    const edit = await call(base, `/api/messages/${failedId}`, {
      method: 'PATCH',
      cookie: rootCookie,
      body: JSON.stringify({ title: '编辑后的标题', content: '# 编辑后内容', render_mode: 'raw' }),
    });
    expect(edit.status).toBe(200);
    const edited = edit.body?.data as Record<string, unknown>;
    expect(edited.title).toBe('编辑后的标题');
    expect(edited.content).toBe('# 编辑后内容');
    expect(edited.render_mode).toBe('raw');
    expect(edited.status).toBe('failed');

    // success messages cannot be edited (resend instead)
    const ok = await call(base, '/api/messages', {
      method: 'POST',
      cookie: rootCookie,
      body: JSON.stringify({ channel: 'e2e-none', title: '成功的消息' }),
    });
    const okList = await call(base, '/api/messages?keyword=%E6%88%90%E5%8A%9F', { cookie: rootCookie });
    const okId = ((okList.body?.data as { items: Array<Record<string, unknown>> }).items[0]).id as number;
    void ok;
    const reject = await call(base, `/api/messages/${okId}`, {
      method: 'PATCH',
      cookie: rootCookie,
      body: JSON.stringify({ title: '不应生效' }),
    });
    expect(reject.status).toBe(422);
    expect(reject.body?.code).toBe('VALIDATION_FAILED');

    // missing / foreign messages 404
    const missing = await call(base, '/api/messages/999999', {
      method: 'PATCH',
      cookie: rootCookie,
      body: JSON.stringify({ title: 'x' }),
    });
    expect(missing.status).toBe(404);

    const login = await call(base, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'e2euser', password: 'e2e-pass-42' }),
    });
    const foreign = await call(base, `/api/messages/${okId}`, {
      method: 'PATCH',
      cookie: (login.setCookie ?? '').split(';')[0],
      body: JSON.stringify({ title: '别人的消息' }),
    });
    expect(foreign.status).toBe(404);
  });
});

describe('realtime isolation (D-01)', () => {
  it('SSE message events only reach the owning user', async () => {
    await call(base, '/api/users', {
      method: 'POST',
      cookie: rootCookie,
      body: JSON.stringify({ username: 'sseuser', password: 'sse-user-001' }),
    });
    const login = await call(base, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'sseuser', password: 'sse-user-001' }),
    });
    const bCookie = cookieOf(login.setCookie);

    const b = await openSse(base, bCookie);
    const a = await openSse(base, rootCookie);
    try {
      const marker = `sse-only-for-root-${Date.now()}`;
      const send = await call(base, '/api/messages', {
        method: 'POST',
        cookie: rootCookie,
        body: JSON.stringify({ channel: 'e2e-none', title: marker, content: 'A 的私有事件' }),
      });
      expect(send.status).toBe(200);

      await waitUntil(() => a.text().includes('message.created') && a.text().includes(marker), 5000);
      expect(a.text()).toContain('delivery.updated'); // owner also sees delivery transitions

      // give B a moment to (wrongly) receive anything, then assert isolation
      await new Promise((r) => setTimeout(r, 400));
      expect(b.text()).toContain('connected'); // the connection itself is fine
      expect(b.text()).not.toContain('message.created');
      expect(b.text()).not.toContain('delivery.updated');
      expect(b.text()).not.toContain(marker);
    } finally {
      await a.close();
      await b.close();
    }
  });
});

describe('message clear-all scopes (阶段3 D-18)', () => {
  it('root scope=all deletes every user\'s messages and cascades deliveries', async () => {
    const t = await bootstrap();
    const prisma = t.app.get(PrismaService);
    const login = await call(base, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'e2euser', password: 'e2e-pass-42' }),
    });
    const userCookie = cookieOf(login.setCookie);
    // 为普通用户建 none 通道并各发一条消息（会落 MessageDelivery 行）
    await call(base, '/api/channels', {
      method: 'POST',
      cookie: userCookie,
      body: JSON.stringify({ name: 'd18-user-none', type: 'none' }),
    });
    const userSend = await call(base, '/api/messages', {
      method: 'POST',
      cookie: userCookie,
      body: JSON.stringify({ channel: 'd18-user-none', title: 'D18 用户消息' }),
    });
    expect(userSend.status).toBe(200);
    const rootSend = await call(base, '/api/messages', {
      method: 'POST',
      cookie: rootCookie,
      body: JSON.stringify({ channel: 'e2e-none', title: 'D18 root 消息' }),
    });
    expect(rootSend.status).toBe(200);

    expect(await prisma.message.count()).toBeGreaterThanOrEqual(2);
    expect(await prisma.messageDelivery.count()).toBeGreaterThanOrEqual(2);

    const clear = await call(base, '/api/messages?scope=all', { method: 'DELETE', cookie: rootCookie });
    expect(clear.status).toBe(200);
    expect(clear.body).toMatchObject({ success: true, message: '已清空全部用户的消息' });

    // 全部用户的消息与其投递明细均被删除（FK 级联）
    expect(await prisma.message.count()).toBe(0);
    expect(await prisma.messageDelivery.count()).toBe(0);
    for (const cookie of [rootCookie, userCookie]) {
      const list = await call(base, '/api/messages', { cookie });
      const page = list.body?.data as { items: unknown[]; page: { total: number } };
      expect(page.items).toHaveLength(0);
      expect(page.page.total).toBe(0);
    }
  });

  it('regular user scope=own clears only own messages', async () => {
    const login = await call(base, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'e2euser', password: 'e2e-pass-42' }),
    });
    const userCookie = cookieOf(login.setCookie);
    // 通道仍在（清空消息不删通道），双方各再发一条
    const userSend = await call(base, '/api/messages', {
      method: 'POST',
      cookie: userCookie,
      body: JSON.stringify({ channel: 'd18-user-none', title: 'D18 own 用户消息' }),
    });
    expect(userSend.status).toBe(200);
    const rootSend = await call(base, '/api/messages', {
      method: 'POST',
      cookie: rootCookie,
      body: JSON.stringify({ channel: 'e2e-none', title: 'D18 own root 消息' }),
    });
    expect(rootSend.status).toBe(200);

    const clear = await call(base, '/api/messages?scope=own', { method: 'DELETE', cookie: userCookie });
    expect(clear.status).toBe(200);
    expect(clear.body).toMatchObject({ success: true, message: '已清空全部消息' });

    const userList = await call(base, '/api/messages', { cookie: userCookie });
    expect((userList.body?.data as { page: { total: number } }).page.total).toBe(0);
    const rootList = await call(base, '/api/messages', { cookie: rootCookie });
    expect((rootList.body?.data as { page: { total: number } }).page.total).toBeGreaterThanOrEqual(1);
  });

  it('regular user scope=all is rejected with 403 FORBIDDEN and wipes nothing', async () => {
    const login = await call(base, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'e2euser', password: 'e2e-pass-42' }),
    });
    const userCookie = cookieOf(login.setCookie);
    const res = await call(base, '/api/messages?scope=all', { method: 'DELETE', cookie: userCookie });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ success: false, code: 'FORBIDDEN' });
    const rootList = await call(base, '/api/messages', { cookie: rootCookie });
    expect((rootList.body?.data as { page: { total: number } }).page.total).toBeGreaterThanOrEqual(1);
  });

  it('invalid scope returns 422 VALIDATION_FAILED; anonymous clear returns 401', async () => {
    const res = await call(base, '/api/messages?scope=bogus', { method: 'DELETE', cookie: rootCookie });
    expect(res.status).toBe(422);
    expect(res.body?.code).toBe('VALIDATION_FAILED');
    const anon = await call(base, '/api/messages', { method: 'DELETE' });
    expect(anon.status).toBe(401);
  });

  it('root account cannot be deleted or disabled (D-18 account protection)', async () => {
    const list = await call(base, '/api/users?keyword=root', { cookie: rootCookie });
    const items = (list.body?.data as { items: Array<{ id: number; username: string }> }).items;
    const rootRow = items.find((u) => u.username === 'root');
    expect(rootRow).toBeDefined();
    const del = await call(base, `/api/users/${rootRow!.id}`, { method: 'DELETE', cookie: rootCookie });
    expect(del.status).toBe(403);
    expect(del.body).toMatchObject({ success: false, code: 'FORBIDDEN' });
    const disable = await call(base, `/api/users/${rootRow!.id}/manage`, {
      method: 'POST',
      cookie: rootCookie,
      body: JSON.stringify({ action: 'disable' }),
    });
    expect(disable.status).toBe(403);
    expect(disable.body).toMatchObject({ success: false, code: 'FORBIDDEN' });
    // root 会话仍然有效
    const me = await call(base, '/api/me', { cookie: rootCookie });
    expect(me.status).toBe(200);
  });
});

describe('user soft-delete restore (D-06)', () => {
  it('include_deleted lists soft-deleted users and restore reactivates them', async () => {
    const create = await call(base, '/api/users', {
      method: 'POST',
      cookie: rootCookie,
      body: JSON.stringify({ username: 'deluser', password: 'del-user-001' }),
    });
    const id = (create.body?.data as Record<string, unknown>).id as number;

    const del = await call(base, `/api/users/${id}`, { method: 'DELETE', cookie: rootCookie });
    expect(del.body).toMatchObject({ success: true, message: '用户已删除' });

    const gone = await call(base, `/api/users/${id}`, { cookie: rootCookie });
    expect(gone.status).toBe(404);
    expect(gone.body?.code).toBe('USER_NOT_FOUND');

    // default list excludes; include_deleted shows the anonymized row
    const plain = await call(base, '/api/users?page_size=100', { cookie: rootCookie });
    expect((plain.body?.data as { items: Array<Record<string, unknown>> }).items.some((u) => u.id === id)).toBe(false);

    const withDeleted = await call(base, '/api/users?include_deleted=true&page_size=100', { cookie: rootCookie });
    const row = (withDeleted.body?.data as { items: Array<Record<string, unknown>> }).items.find((u) => u.id === id);
    expect(row).toBeTruthy();
    expect(row!.status).toBe('disabled');
    expect(typeof row!.deleted_at).toBe('string');
    expect(row!.username).toBe(`deleted_${id}`);

    const restore = await call(base, `/api/users/${id}/restore`, {
      method: 'POST',
      cookie: rootCookie,
      body: JSON.stringify({}),
    });
    expect(restore.status).toBe(200);
    const restored = restore.body?.data as Record<string, unknown>;
    expect(restored.status).toBe('active');
    expect(restored.deleted_at).toBe(null);
    // the stored anonymized name is free — restore keeps it usable
    expect(restored.username).toBe(`deleted_${id}`);

    const again = await call(base, `/api/users/${id}`, { cookie: rootCookie });
    expect(again.status).toBe(200);

    const twice = await call(base, `/api/users/${id}/restore`, {
      method: 'POST',
      cookie: rootCookie,
      body: JSON.stringify({}),
    });
    expect(twice.status).toBe(404);
    expect(twice.body?.code).toBe('USER_NOT_FOUND');
  });

  // Q-12: OpenAPI declares requestBody.required=false; an omitted body must
  // behave like {} instead of 422 "(body) Required".
  it('restore accepts an omitted body', async () => {
    const create = await call(base, '/api/users', {
      method: 'POST',
      cookie: rootCookie,
      body: JSON.stringify({ username: 'restbody', password: 'restore-001' }),
    });
    const id = (create.body?.data as Record<string, unknown>).id as number;
    await call(base, `/api/users/${id}`, { method: 'DELETE', cookie: rootCookie });

    const restore = await call(base, `/api/users/${id}/restore`, {
      method: 'POST',
      cookie: rootCookie,
    });
    expect(restore.status).toBe(200);
    expect((restore.body?.data as Record<string, unknown>).status).toBe('active');
  });

  it('restore resolves username conflicts (auto-generated or explicit)', async () => {
    const create = await call(base, '/api/users', {
      method: 'POST',
      cookie: rootCookie,
      body: JSON.stringify({ username: 'conflictu', password: 'conflict-001' }),
    });
    const id = (create.body?.data as Record<string, unknown>).id as number;
    await call(base, `/api/users/${id}`, { method: 'DELETE', cookie: rootCookie });

    // the anonymized name deleted_<id> cannot be registered by anyone else
    // (global unique constraint), so default restore is conflict-free; but an
    // EXPLICIT username that is taken must fail cleanly with 422
    const create2 = await call(base, '/api/users', {
      method: 'POST',
      cookie: rootCookie,
      body: JSON.stringify({ username: 'namedel', password: 'namedel-001' }),
    });
    const id2 = (create2.body?.data as Record<string, unknown>).id as number;
    await call(base, `/api/users/${id2}`, { method: 'DELETE', cookie: rootCookie });

    const taken = await call(base, `/api/users/${id2}/restore`, {
      method: 'POST',
      cookie: rootCookie,
      body: JSON.stringify({ username: 'e2euser' }),
    });
    expect(taken.status).toBe(422);
    expect(taken.body?.code).toBe('DUPLICATE_NAME');

    const explicit = await call(base, `/api/users/${id2}/restore`, {
      method: 'POST',
      cookie: rootCookie,
      body: JSON.stringify({ username: 'back-again' }),
    });
    expect(explicit.status).toBe(200);
    expect((explicit.body?.data as Record<string, unknown>).username).toBe('back-again');

    // restoring a live user is a 404
    const live = await call(base, `/api/users/${id2}/restore`, {
      method: 'POST',
      cookie: rootCookie,
      body: JSON.stringify({}),
    });
    expect(live.status).toBe(404);

    // non-admin cannot restore
    const login = await call(base, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'e2euser', password: 'e2e-pass-42' }),
    });
    const forbidden = await call(base, `/api/users/${id2}/restore`, {
      method: 'POST',
      cookie: (login.setCookie ?? '').split(';')[0],
      body: JSON.stringify({}),
    });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body?.code).toBe('FORBIDDEN');
  });
});

describe('public footer & turnstile sitekey (D-07)', () => {
  it('anonymous footer reflects the configured option', async () => {
    const before = await call(base, '/api/public/footer');
    expect(before.status).toBe(200);
    expect(typeof (before.body?.data as Record<string, unknown>).content).toBe('string');

    await call(base, '/api/options', {
      method: 'PATCH',
      cookie: rootCookie,
      body: JSON.stringify({ key: 'Footer', value: '© e2e NectarPush' }),
    });
    const after = await call(base, '/api/public/footer');
    expect(after.status).toBe(200);
    expect((after.body?.data as Record<string, unknown>).content).toBe('© e2e NectarPush');
  });

  it('anonymous turnstile-sitekey exposes the switch and site key but never the secret', async () => {
    const off = await call(base, '/api/public/turnstile-sitekey');
    expect(off.status).toBe(200);
    const offData = off.body?.data as Record<string, unknown>;
    expect(typeof offData.enabled).toBe('boolean');
    expect(typeof offData.site_key).toBe('string');

    // configure + enable, then verify the public view
    await call(base, '/api/options', {
      method: 'PATCH',
      cookie: rootCookie,
      body: JSON.stringify({ key: 'TurnstileSiteKey', value: '0x4AAAe2eSiteKey' }),
    });
    await call(base, '/api/options', {
      method: 'PATCH',
      cookie: rootCookie,
      body: JSON.stringify({ key: 'TurnstileSecretKey', value: 'e2e-secret-value-001' }),
    });
    const enable = await call(base, '/api/options', {
      method: 'PATCH',
      cookie: rootCookie,
      body: JSON.stringify({ key: 'TurnstileCheckEnabled', value: 'true' }),
    });
    expect(enable.status).toBe(200);

    const on = await call(base, '/api/public/turnstile-sitekey');
    expect(on.status).toBe(200);
    const onData = on.body?.data as Record<string, unknown>;
    expect(onData.enabled).toBe(true);
    expect(onData.site_key).toBe('0x4AAAe2eSiteKey');
    expect('secret' in onData).toBe(false);
    expect(on.raw).not.toContain('e2e-secret-value-001');

    // restore the default so later flows are unaffected
    await call(base, '/api/options', {
      method: 'PATCH',
      cookie: rootCookie,
      body: JSON.stringify({ key: 'TurnstileCheckEnabled', value: 'false' }),
    });
  });
});

/* ---------- Q-06: malformed ids / pagination / JSON must be 4xx, not 500 ---------- */

describe('Q-06 invalid ids, paging and JSON bodies', () => {
  beforeAll(async () => {
    if (!base) base = (await bootstrap()).base;
    if (!rootCookie) {
      rootCookie = await loginRoot(base);
      // Isolated runs skip the D-02 test, so the seeded root is still flagged
      // for a forced password change; clear it so the fixtures can be created.
      const probe = await call(base, '/api/me', { cookie: rootCookie });
      if (probe.body?.code === 'PASSWORD_CHANGE_REQUIRED') {
        await call(base, '/api/me', {
          method: 'PATCH',
          cookie: rootCookie,
          body: JSON.stringify({ old_password: '123456', password: 'Q06RootPass1' }),
        });
        rootCookie = await loginRoot(base, 'Q06RootPass1');
      }
    }
  });
  const hugeId = '9223372036854775808';
  const hugeMessageId = '204988590768121178658861755872051200';

  it('oversized numeric ids are 404 NOT_FOUND-family instead of 500', async () => {
    const ch = await call(base, '/api/channels', {
      method: 'POST',
      cookie: rootCookie,
      body: JSON.stringify({ name: 'q06-none', type: 'none' }),
    });
    expect(ch.status, ch.raw).toBe(200);
    const channelId = (ch.body?.data as { id: number }).id;

    const cases: Array<[string, string, string]> = [
      [`/api/channels/${hugeId}`, 'PATCH', 'CHANNEL_NOT_FOUND'],
      [`/api/channels/${hugeId}/test`, 'POST', 'CHANNEL_NOT_FOUND'],
      [`/api/channels/${hugeId}`, 'DELETE', 'CHANNEL_NOT_FOUND'],
      [`/api/channels/${hugeId}`, 'GET', 'CHANNEL_NOT_FOUND'],
      [`/api/messages/${hugeMessageId}`, 'GET', 'NOT_FOUND'],
      [`/api/users/${hugeId}`, 'GET', 'USER_NOT_FOUND'],
      [`/api/webhooks/${hugeId}`, 'GET', 'WEBHOOK_NOT_FOUND'],
    ];
    for (const [path, method, code] of cases) {
      const res = await call(base, path, { method, cookie: rootCookie, body: method === 'PATCH' ? '{}' : undefined });
      expect({ path, status: res.status }).toEqual({ path, status: 404 });
      expect({ path, code: res.body?.code }).toEqual({ path, code });
    }

    // A valid id still works: the fix must not turn normal routing into 404s.
    const ok = await call(base, `/api/channels/${channelId}`, {
      method: 'PATCH',
      cookie: rootCookie,
      body: JSON.stringify({ description: 'q06 still works' }),
    });
    expect(ok.status).toBe(200);
  });

  // The project-wide envelope maps VALIDATION_FAILED to 422 (documented in
  // OpenAPI for these operations); the defect was the 500, not the 4xx flavour.
  it('invalid paging/date params are 4xx VALIDATION_FAILED', async () => {
    const cases = [
      '/api/messages?page_size=abc',
      '/api/messages?page=abc',
      '/api/messages?page=0',
      '/api/messages?page_size=101',
      '/api/messages?until=not-a-date',
      '/api/messages?since=0677-13-45T99:99:99Z',
      '/api/users?page_size=abc',
      '/api/users?page_size=101',
      '/api/users?page=-1628',
    ];
    for (const path of cases) {
      const res = await call(base, path, { cookie: rootCookie });
      expect({ path, status: res.status }).toEqual({ path, status: 422 });
      expect({ path, code: res.body?.code }).toEqual({ path, code: 'VALIDATION_FAILED' });
    }
  });

  it('malformed JSON body returns 400 VALIDATION_FAILED (not INTERNAL_ERROR)', async () => {
    const res = await call(base, '/api/channels/1', {
      method: 'PATCH',
      cookie: rootCookie,
      body: '{bad json',
    });
    expect(res.status).toBe(400);
    expect(res.body?.code).toBe('VALIDATION_FAILED');
    expect(res.body?.message).toContain('JSON');
  });

  // Contract run 4 surfaced this: soft-deleted users keep the DB-level unique
  // index, so the `deletedAt: null` pre-check passed and Prisma threw P2002
  // (unhandled -> 500). Both entry points must answer 422 DUPLICATE_NAME.
  it('reusing a soft-deleted username returns 422 DUPLICATE_NAME, not 500', async () => {
    const username = 'q06del';
    const reg = await call(base, '/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password: 'q06-deleted-1' }),
    });
    expect(reg.status, reg.raw).toBe(200);

    const list = await call(base, `/api/users?keyword=${username}`, { cookie: rootCookie });
    const row = (list.body?.data as { items: Array<{ id: number; username: string }> }).items.find(
      (u) => u.username === username,
    );
    expect(row).toBeTruthy();
    const del = await call(base, `/api/users/${row!.id}`, { method: 'DELETE', cookie: rootCookie });
    expect(del.status, del.raw).toBe(200);

    // Delete anonymizes the row to `deleted_<id>`; the unique index still holds
    // that value, so creating a user with it hits P2002 (this is what
    // schemathesis fuzzed as POST /api/users with username "deleted_2").
    const anonymized = `deleted_${row!.id}`;
    const again = await call(base, '/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username: anonymized, password: 'q06-deleted-2' }),
    });
    expect(again.status, again.raw).toBe(422);
    expect(again.body?.code).toBe('DUPLICATE_NAME');

    const created = await call(base, '/api/users', {
      method: 'POST',
      cookie: rootCookie,
      body: JSON.stringify({ username: anonymized, password: 'q06-deleted-3' }),
    });
    expect(created.status, created.raw).toBe(422);
    expect(created.body?.code).toBe('DUPLICATE_NAME');
  });
});

/* ---------- Q-08: session cookie Secure flag ---------- */

describe('Q-08 session cookie flags', () => {
  beforeAll(async () => {
    if (!base) base = (await bootstrap()).base;
  });

  async function loginCookie(): Promise<string> {
    for (const password of ['root-e2e-pass', '123456']) {
      const res = await call(base, '/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: 'root', password }),
      });
      if (res.status === 200) return res.setCookie ?? '';
    }
    throw new Error('Q-08: root login failed with both known passwords');
  }

  it('COOKIE_SECURE=true sets Secure on the session cookie', async () => {
    process.env.COOKIE_SECURE = 'true';
    try {
      const cookie = await loginCookie();
      expect(cookie).toContain('np_session=');
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).toContain('Secure');
    } finally {
      delete process.env.COOKIE_SECURE;
    }
  });

  it('PUBLIC_BASE_URL=https://… implies Secure', async () => {
    process.env.PUBLIC_BASE_URL = 'https://push.example.com';
    try {
      const cookie = await loginCookie();
      expect(cookie).toContain('Secure');
    } finally {
      delete process.env.PUBLIC_BASE_URL;
    }
  });

  it('plain HTTP development keeps the cookie usable (no Secure)', async () => {
    process.env.COOKIE_SECURE = 'false';
    try {
      const cookie = await loginCookie();
      expect(cookie).not.toContain('Secure');
    } finally {
      delete process.env.COOKIE_SECURE;
    }
  });
});

/* ---------- Q-07: channel token lifecycle (FR-042) ---------- */

describe('Q-07 channel-level token lifecycle', () => {
  beforeAll(async () => {
    if (!base) base = (await bootstrap()).base;
    if (!rootCookie) {
      rootCookie = await loginRoot(base);
      const probe = await call(base, '/api/me', { cookie: rootCookie });
      if (probe.body?.code === 'PASSWORD_CHANGE_REQUIRED') {
        await call(base, '/api/me', {
          method: 'PATCH',
          cookie: rootCookie,
          body: JSON.stringify({ old_password: '123456', password: 'Q07RootPass1' }),
        });
        rootCookie = await loginRoot(base, 'Q07RootPass1');
      }
    }
  });

  it('create echoes the token once, list/detail never do, rotation kills the old value', async () => {
    const created = await call(base, '/api/channels', {
      method: 'POST',
      cookie: rootCookie,
      body: JSON.stringify({ name: 'q07-none', type: 'none', token: 'q07-token-old' }),
    });
    expect(created.status).toBe(200);
    const channel = created.body?.data as { id: number; access_token?: string | null };
    expect(channel.access_token).toBe('q07-token-old');
    const id = channel.id;

    // The plaintext must not come back on any read path.
    const detail = await call(base, `/api/channels/${id}`, { cookie: rootCookie });
    expect(detail.status).toBe(200);
    expect(detail.raw).not.toContain('q07-token-old');
    expect((detail.body?.data as Record<string, unknown>).access_token).toBeUndefined();
    const list = await call(base, '/api/channels', { cookie: rootCookie });
    expect(list.raw).not.toContain('q07-token-old');

    const pushWith = async (token: string) =>
      call(base, `/push/root?channel=q07-none&title=q07&token=${encodeURIComponent(token)}`);

    // Old token works before rotation.
    expect((await pushWith('q07-token-old')).status).toBe(200);

    // Rotate to a caller-supplied value: plaintext returned exactly once.
    const rotated = await call(base, `/api/channels/${id}/token`, {
      method: 'POST',
      cookie: rootCookie,
      body: JSON.stringify({ token: 'q07-token-new' }),
    });
    expect(rotated.status).toBe(200);
    expect((rotated.body?.data as { access_token: string }).access_token).toBe('q07-token-new');
    const detailAfter = await call(base, `/api/channels/${id}`, { cookie: rootCookie });
    expect(detailAfter.raw).not.toContain('q07-token-new');

    // Old value is dead immediately; new value works.
    const oldPush = await pushWith('q07-token-old');
    expect(oldPush.status).toBe(401);
    expect(oldPush.body?.code).toBe('INVALID_TOKEN');
    const newPush = await pushWith('q07-token-new');
    expect(newPush.status).toBe(200);

    // Generated rotation (no body) yields a 32-hex token, also returned once.
    const generated = await call(base, `/api/channels/${id}/token`, {
      method: 'POST',
      cookie: rootCookie,
      body: JSON.stringify({}),
    });
    const fresh = (generated.body?.data as { access_token: string }).access_token;
    expect(fresh).toMatch(/^[0-9a-f]{32}$/);
    expect((await pushWith('q07-token-new')).body?.code).toBe('INVALID_TOKEN');
    expect((await pushWith(fresh)).status).toBe(200);

    const missing = await call(base, '/api/channels/999999/token', {
      method: 'POST',
      cookie: rootCookie,
      body: JSON.stringify({}),
    });
    expect(missing.status).toBe(404);
    expect(missing.body?.code).toBe('CHANNEL_NOT_FOUND');
  });
});

// Q-12: OAuth 回调在 Nest 的 @Res({passthrough:true}) 下曾以 200 覆盖 Fastify 的
// 302（Location 头保留），与 OpenAPI 文档的 302 不一致。回归断言状态码与 Location。
describe('Q-12 OAuth redirect status', () => {
  let base = '';
  beforeAll(async () => {
    base = (await bootstrap()).base;
  });

  it('callback returns 302 with an oauth_error redirect when state is missing', async () => {
    const res = await fetch(`${base}/api/auth/oauth/github/callback?code=abc`, {
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/login?oauth_error=');
  });

  it('start returns documented 403 when the provider is not configured', async () => {
    const res = await call(base, '/api/auth/oauth/github/start');
    expect(res.status).toBe(403);
    expect(res.body?.code).toBe('OAUTH_PROVIDER_NOT_CONFIGURED');
  });
});

/* ---------- Account security: mailbox change + OAuth binding (FR-007/FR-008) ---------- */
describe('account security (contract: /api/me/security, email, oauth bind)', () => {
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

  async function patchOption(key: string, value: string) {
    return call(base, '/api/options', {
      method: 'PATCH',
      cookie: rootCookie,
      body: JSON.stringify({ key, value }),
    });
  }

  it('GET /api/me/security reports password, verification and binding state', async () => {
    const res = await call(base, '/api/me/security', { cookie: rootCookie });
    expect(res.status).toBe(200);
    const data = res.body?.data as Record<string, any>;
    expect(data.has_password).toBe(true);
    expect(typeof data.email_verification_enabled).toBe('boolean');
    // Contract DB has no SMTP configured, so email changes can be saved without a code.
    expect(data.email_change_requires_code).toBe(false);
    expect(data.oauth.bindings).toEqual([]);
    expect(Array.isArray(data.oauth.providers)).toBe(true);
  });

  it('PATCH /api/me email syncs the email channel and clearing disables it', async () => {
    const patch = await patchOption('EmailVerificationEnabled', 'false');
    expect(patch.status).toBe(200);

    const saved = await call(base, '/api/me', {
      method: 'PATCH',
      cookie: rootCookie,
      body: JSON.stringify({ email: 'root-e2e@example.com' }),
    });
    expect(saved.status).toBe(200);
    expect((saved.body?.data as Record<string, any>).email).toBe('root-e2e@example.com');

    const channels = await call(base, '/api/channels', { cookie: rootCookie });
    const emailChannel = (channels.body?.data as any).items.find((c: any) => c.type === 'email');
    expect(emailChannel).toBeTruthy();
    expect(emailChannel.config.account_id).toBe('root-e2e@example.com');
    expect(emailChannel.enabled).toBe(true);

    const notice = await call(base, '/api/me/email/verification', {
      method: 'POST',
      cookie: rootCookie,
      body: JSON.stringify({ email: 'root-e2e-2@example.com' }),
    });
    expect(notice.status).toBe(200);
    expect(notice.body?.data).toMatchObject({ sent: false, required: false });

    const cleared = await call(base, '/api/me', {
      method: 'PATCH',
      cookie: rootCookie,
      body: JSON.stringify({ email: '' }),
    });
    expect(cleared.status).toBe(200);
    expect((cleared.body?.data as Record<string, any>).email).toBe(null);

    const after = await call(base, '/api/channels', { cookie: rootCookie });
    const disabled = (after.body?.data as any).items.find((c: any) => c.type === 'email');
    expect(disabled.enabled).toBe(false);
  });

  it('rejects an email that is already taken', async () => {
    await call(base, '/api/me', {
      method: 'PATCH',
      cookie: rootCookie,
      body: JSON.stringify({ email: 'taken@example.com' }),
    });
    const created = await call(base, '/api/users', {
      method: 'POST',
      cookie: rootCookie,
      body: JSON.stringify({ username: 'emaildup', password: 'dup-pass-42' }),
    });
    expect(created.status).toBe(200);
    const other = await call(base, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'emaildup', password: 'dup-pass-42' }),
    });
    expect(other.status).toBe(200);
    const otherCookie = cookieOf(other.setCookie);
    const dup = await call(base, '/api/me', {
      method: 'PATCH',
      cookie: otherCookie,
      body: JSON.stringify({ email: 'taken@example.com' }),
    });
    expect(dup.status).toBe(422);
    expect(dup.body?.code).toBe('DUPLICATE_NAME');

    const self = await call(base, '/api/me', {
      method: 'PATCH',
      cookie: rootCookie,
      body: JSON.stringify({ email: 'taken@example.com' }),
    });
    expect(self.status).toBe(200);
    await call(base, '/api/me', {
      method: 'PATCH',
      cookie: rootCookie,
      body: JSON.stringify({ email: '' }),
    });
  });

  it('POST /api/options/oauth2/discover validates the input URL', async () => {
    const bad = await call(base, '/api/options/oauth2/discover', {
      method: 'POST',
      cookie: rootCookie,
      body: JSON.stringify({ url: 'ftp://example.com' }),
    });
    expect(bad.status).toBe(422);
    expect(bad.body?.code).toBe('VALIDATION_FAILED');
  });

  it('public provider list omits secrets and bind start redirects to the authorize URL', async () => {
    const patched = await patchOption('OAuth2Providers', JSON.stringify([provider]));
    expect(patched.status).toBe(200);

    const list = await call(base, '/api/auth/oauth/providers');
    expect(list.status).toBe(200);
    const items = (list.body?.data as any).items as any[];
    const found = items.find((i) => i.id === 'e2e-sso');
    expect(found).toMatchObject({ id: 'e2e-sso', display_name: 'E2E SSO' });
    expect(found.client_id).toBeUndefined();
    expect(found.discovery_url).toBeUndefined();

    const start = await fetch(`${base}/api/me/oauth/e2e-sso/start`, {
      headers: { cookie: rootCookie },
      redirect: 'manual',
    });
    expect(start.status).toBe(302);
    const location = start.headers.get('location') ?? '';
    expect(location.startsWith('https://sso.example.com/authorize?')).toBe(true);
    expect(location).toContain('state=');

    const unbind = await call(base, '/api/me/oauth/e2e-sso', { method: 'DELETE', cookie: rootCookie });
    expect(unbind.status).toBe(422);
    expect(unbind.body?.code).toBe('VALIDATION_FAILED');

    const restored = await patchOption('OAuth2Providers', '[]');
    expect(restored.status).toBe(200);
  });
});

describe('password reset self-set (阶段3 D-06)', () => {
  const email = 'reset-user@example.com';
  const username = 'resetuser';
  const oldPassword = 'reset-old-pass';
  const newPassword = 'reset-new-pass';
  let oldCookie = '';
  let prisma: PrismaService;

  /** 走真实 reset-request 流程，从 EmailCode 表读取一次性 token（测试环境无 SMTP）。 */
  async function freshResetToken(): Promise<string> {
    const req = await call(base, '/api/auth/reset-request', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
    expect(req.status).toBe(200);
    const row = await prisma.emailCode.findFirst({
      where: { email, purpose: 'reset', used: false },
      orderBy: { id: 'desc' },
    });
    expect(row?.token).toBeTruthy();
    return row!.token!;
  }

  async function confirm(body: Record<string, unknown>) {
    return call(base, '/api/auth/reset-confirm', { method: 'POST', body: JSON.stringify(body) });
  }

  it('setup: register a user with email and an active session', async () => {
    const t = await bootstrap();
    base = t.base;
    prisma = t.app.get(PrismaService);
    const reg = await call(base, '/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password: oldPassword, email }),
    });
    expect(reg.status).toBe(200);
    const login = await call(base, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password: oldPassword }),
    });
    expect(login.status).toBe(200);
    oldCookie = cookieOf(login.setCookie);
  });

  it('self-set password succeeds; no plaintext in response; old password/sessions die; token single-use', async () => {
    const token = await freshResetToken();
    const res = await confirm({ email, token, new_password: newPassword, new_password_confirm: newPassword });
    expect(res.status).toBe(200);
    expect(res.body?.success).toBe(true);
    expect(res.body?.message).toBe('密码已重置');
    // D-06: 响应不含任何明文密码（message-only 信封，无 data）
    expect(res.raw).not.toContain(newPassword);
    expect(res.body?.data).toBeUndefined();

    // 旧会话被撤销
    const me = await call(base, '/api/me', { cookie: oldCookie });
    expect(me.status).toBe(401);
    // 旧密码失效
    const oldLogin = await call(base, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password: oldPassword }),
    });
    expect(oldLogin.status).toBe(401);
    // 新密码可登录，且不再强制改密（D-06）
    const newLogin = await call(base, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password: newPassword }),
    });
    expect(newLogin.status).toBe(200);
    expect((newLogin.body?.data as { must_change_password: boolean }).must_change_password).toBe(false);

    // token 一次性：复用即拒绝
    const reuse = await confirm({ email, token, new_password: 'another-pass-42', new_password_confirm: 'another-pass-42' });
    expect(reuse.status).toBe(422);
    expect(reuse.body?.code).toBe('VALIDATION_FAILED');
  });

  it('weak password / confirm mismatch rejected without consuming the token', async () => {
    const token = await freshResetToken();
    const weak = await confirm({ email, token, new_password: 'short', new_password_confirm: 'short' });
    expect(weak.status).toBe(422);
    expect(weak.body?.code).toBe('VALIDATION_FAILED');
    const mismatch = await confirm({ email, token, new_password: newPassword, new_password_confirm: 'different-pass' });
    expect(mismatch.status).toBe(422);
    expect(mismatch.body?.message).toContain('两次输入的新密码不一致');
    // 校验失败不消耗 token：随后可正常重置
    const ok = await confirm({ email, token, new_password: newPassword, new_password_confirm: newPassword });
    expect(ok.status).toBe(200);
  });

  it('invalid token rejected', async () => {
    const res = await confirm({
      email,
      token: 'deadbeefdeadbeef',
      new_password: newPassword,
      new_password_confirm: newPassword,
    });
    expect(res.status).toBe(422);
    expect(res.body?.message).toContain('重置链接无效或已过期');
  });
});
