/**
 * 阶段3 D-08（批 B2）：push 向他人邮箱发信。
 * 覆盖：收件人语义（to-as-email）、发送前权限门控（403）、更严限流（429，按发送者计桶）、
 * 本人邮箱/无 to 不回归、非 email 通道与通道选择器不回归、testChannel 适配器门控不回归。
 * 测试环境未配置 SMTP：通过门控后适配器返回「邮件服务未配置」，以此区分
 * 「发送前被拒（403/429 错误信封）」与「已到达适配器」。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { bootstrap, call, cookieOf, loginRoot } from './helpers/app';
import { resetRateLimits } from '../src/common/rate-limit';

let base = '';
let rootCookie = '';
let userCookie = '';
let userId = 0;

afterAll(async () => {
  const t = await bootstrap();
  await t.close();
  t.cleanup();
});

async function push(username: string, body: Record<string, unknown>) {
  return call(base, `/push/${username}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('push email-to-others (阶段3 D-08)', () => {
  it('setup: register mailuser with an email channel and a none channel', async () => {
    const t = await bootstrap();
    base = t.base;
    rootCookie = await loginRoot(base);
    // 新库 root 处于强制改密状态（D-02）：先改密再重登，否则管理端点被 PASSWORD_CHANGE_REQUIRED 拦截
    const change = await call(base, '/api/me', {
      method: 'PATCH',
      cookie: rootCookie,
      body: JSON.stringify({ old_password: '123456', password: 'root-mail-pass' }),
    });
    expect(change.status).toBe(200);
    const relogin = await call(base, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'root', password: 'root-mail-pass' }),
    });
    expect(relogin.status).toBe(200);
    rootCookie = cookieOf(relogin.setCookie);
    const reg = await call(base, '/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username: 'mailuser', password: 'mail-pass-42' }),
    });
    expect(reg.status).toBe(200);
    const login = await call(base, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'mailuser', password: 'mail-pass-42' }),
    });
    userCookie = cookieOf(login.setCookie);
    const emailCh = await call(base, '/api/channels', {
      method: 'POST',
      cookie: userCookie,
      body: JSON.stringify({ name: 'mail', type: 'email', config: { account_id: 'bound@example.com' } }),
    });
    expect(emailCh.status).toBe(200);
    const noneCh = await call(base, '/api/channels', {
      method: 'POST',
      cookie: userCookie,
      body: JSON.stringify({ name: 'm-none', type: 'none' }),
    });
    expect(noneCh.status).toBe(200);
    const list = await call(base, '/api/users?keyword=mailuser', { cookie: rootCookie });
    const items = (list.body?.data as { items: Array<{ id: number; username: string }> }).items;
    userId = items.find((u) => u.username === 'mailuser')!.id;
  });

  it('unauthorized push to another mailbox is rejected before sending (403 FORBIDDEN)', async () => {
    const res = await push('mailuser', { channel: 'mail', to: 'other@example.com', title: 'D08 未授权' });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      success: false,
      code: 'FORBIDDEN',
      message: '管理员未允许向他人邮箱发送邮件',
    });
    // 发送前拒绝：不产生消息记录
    const list = await call(base, '/api/messages', { cookie: userCookie });
    expect((list.body?.data as { page: { total: number } }).page.total).toBe(0);
  });

  it('unauthorized push to own bound mailbox still works (to-as-recipient, self)', async () => {
    const res = await push('mailuser', { channel: 'mail', to: 'bound@example.com', title: 'D08 本人' });
    expect(res.status).toBe(200);
    // 已通过门控到达适配器；测试环境无 SMTP → 适配器报「邮件服务未配置」
    expect(res.body?.message).toBe('邮件服务未配置');
  });

  it('authorized push to another mailbox reaches the adapter and records the recipient', async () => {
    const grant = await call(base, `/api/users/${userId}/manage`, {
      method: 'POST',
      cookie: rootCookie,
      body: JSON.stringify({ action: 'allow_send_email_to_others' }),
    });
    expect(grant.status).toBe(200);
    const res = await push('mailuser', { channel: 'mail', to: 'other@example.com', title: 'D08 已授权' });
    expect(res.status).toBe(200);
    expect(res.body?.message).toBe('邮件服务未配置');
    // 消息记录的 to 字段为收件人邮箱（而非通道选择器）
    const list = await call(base, '/api/messages', { cookie: userCookie });
    const items = (list.body?.data as { items: Array<{ to: string | null; title: string | null }> }).items;
    const row = items.find((m) => m.title === 'D08 已授权');
    expect(row?.to).toBe('other@example.com');
  });

  it('push without to still targets the bound mailbox (no regression)', async () => {
    const res = await push('mailuser', { channel: 'mail', title: 'D08 无 to' });
    expect(res.status).toBe(200);
    expect(res.body?.message).toBe('邮件服务未配置');
  });

  it('stricter rate limit applies per sender for sends to others (429 RATE_LIMITED)', async () => {
    resetRateLimits();
    for (let i = 0; i < 10; i += 1) {
      const res = await push('mailuser', { channel: 'mail', to: `victim${i}@example.com`, title: `D08 限流 ${i}` });
      expect(res.status).toBe(200);
    }
    const limited = await push('mailuser', { channel: 'mail', to: 'victim-last@example.com', title: 'D08 超限' });
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ success: false, code: 'RATE_LIMITED' });
    // 发本人邮箱不受该桶限制
    const self = await push('mailuser', { channel: 'mail', to: 'bound@example.com', title: 'D08 本人不限流' });
    expect(self.status).toBe(200);
  });

  it('rate limit is keyed by sender, not IP; testChannel adapter gate unchanged', async () => {
    const reg = await call(base, '/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username: 'mailuser2', password: 'mail-pass-42' }),
    });
    expect(reg.status).toBe(200);
    const login = await call(base, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'mailuser2', password: 'mail-pass-42' }),
    });
    const cookie2 = cookieOf(login.setCookie);
    const ch = await call(base, '/api/channels', {
      method: 'POST',
      cookie: cookie2,
      body: JSON.stringify({ name: 'mail2', type: 'email', config: { account_id: 'bound2@example.com' } }),
    });
    expect(ch.status).toBe(200);
    const channelId = (ch.body?.data as { id: number }).id;

    // testChannel 不回归：未授权发他人 → 适配器门控 success:false（非 HTTP 403）
    const test = await call(base, `/api/channels/${channelId}/test`, {
      method: 'POST',
      cookie: cookie2,
      body: JSON.stringify({ to: 'other@example.com' }),
    });
    expect(test.status).toBe(200);
    expect(test.body?.data).toMatchObject({ success: false, message: '管理员未允许向他人邮箱发送邮件' });

    // push 链路：未授权 → 发送前 403
    const denied = await push('mailuser2', { channel: 'mail2', to: 'other@example.com', title: 'D08 二号未授权' });
    expect(denied.status).toBe(403);

    // 授权后：mailuser 已被限流，但限流按发送者计桶 → mailuser2 仍可发
    const list = await call(base, '/api/users?keyword=mailuser2', { cookie: rootCookie });
    const items = (list.body?.data as { items: Array<{ id: number; username: string }> }).items;
    const id2 = items.find((u) => u.username === 'mailuser2')!.id;
    const grant = await call(base, `/api/users/${id2}/manage`, {
      method: 'POST',
      cookie: rootCookie,
      body: JSON.stringify({ action: 'allow_send_email_to_others' }),
    });
    expect(grant.status).toBe(200);
    const ok = await push('mailuser2', { channel: 'mail2', to: 'other@example.com', title: 'D08 二号已授权' });
    expect(ok.status).toBe(200);
    expect(ok.body?.message).toBe('邮件服务未配置');
  });

  it('non-email channels and channel selectors do not regress', async () => {
    // 指定 none 通道
    const byChannel = await push('mailuser', { channel: 'm-none', title: 'D08 none' });
    expect(byChannel.status).toBe(200);
    expect(byChannel.body?.success).toBe(true);
    // to 作为通道选择器（非邮箱值）
    const bySelector = await push('mailuser', { to: 'm-none', title: 'D08 选择器' });
    expect(bySelector.status).toBe(200);
    expect(bySelector.body?.success).toBe(true);
    // @all 广播：email 无 SMTP 失败 + none 成功 → partial，包络 success:true
    const broadcast = await push('mailuser', { to: '@all', title: 'D08 广播' });
    expect(broadcast.status).toBe(200);
    expect(broadcast.body?.success).toBe(true);
  });

  it('email-like to with a non-email target channel keeps selector semantics', async () => {
    const res = await push('mailuser', { channel: 'm-none', to: 'someone@example.com', title: 'D08 语义边界' });
    expect(res.status).toBe(404);
    expect(res.body?.code).toBe('CHANNEL_NOT_FOUND');
  });

  it('default channel resolution: email recipient without explicit channel param', async () => {
    // 前面的限流用例已耗尽 mailuser 的桶，这里重置
    resetRateLimits();
    // 设默认通道为 mail，不带 channel 参数、to 为邮箱 → 收件人模式
    const patch = await call(base, '/api/me', {
      method: 'PATCH',
      cookie: userCookie,
      body: JSON.stringify({ default_channel: 'mail' }),
    });
    expect(patch.status).toBe(200);
    const res = await push('mailuser', { to: 'default-recipient@example.com', title: 'D08 默认通道' });
    expect(res.status).toBe(200);
    expect(res.body?.message).toBe('邮件服务未配置');
    const list = await call(base, '/api/messages', { cookie: userCookie });
    const items = (list.body?.data as { items: Array<{ to: string | null; title: string | null }> }).items;
    expect(items.find((m) => m.title === 'D08 默认通道')?.to).toBe('default-recipient@example.com');
  });
});
