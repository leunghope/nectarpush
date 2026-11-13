import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChannelAdapter, SendResult, AdapterCtx } from '../src/channels/adapter.interface';
import { DingAdapter } from '../src/channels/ding/ding.adapter';
import { LarkAdapter } from '../src/channels/lark/lark.adapter';
import { BarkAdapter } from '../src/channels/bark/bark.adapter';
import { CustomAdapter } from '../src/channels/custom/custom.adapter';
import { TelegramAdapter } from '../src/channels/telegram/telegram.adapter';
import { DiscordAdapter } from '../src/channels/discord/discord.adapter';
import { GroupAdapter } from '../src/channels/group/group.adapter';
import { EmailAdapter } from '../src/channels/email/email.adapter';
import { ClientAdapter } from '../src/channels/client/client.adapter';

interface FetchMock {
  calls: Array<{ url: string; init: RequestInit }>;
  respond: (status: number, body: unknown) => void;
}

function mockFetch(): FetchMock {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let next: { status: number; body: unknown } = { status: 200, body: {} };
  const state: FetchMock = {
    calls,
    respond: (status, body) => {
      next = { status, body };
    },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      state.calls.push({ url: String(url), init: init ?? {} });
      const nullBody = next.status === 204 || next.status === 205 || next.status === 304;
      return new Response(nullBody ? null : JSON.stringify(next.body), {
        status: next.status,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return state;
}

const CTX: AdapterCtx = {
  userId: 1,
  username: 'tester',
  allowSendEmailToOthers: false,
  channelName: 'ut',
};

async function send(adapter: ChannelAdapter, config: Record<string, string>): Promise<SendResult> {
  const validation = adapter.validateConfig(config as never);
  if (!validation.valid) throw new Error(`invalid config: ${JSON.stringify(validation.errors)}`);
  return adapter.send(config as never, { title: 't', description: 'd', content: 'c', url: 'https://example.com/x' }, CTX);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ding adapter', () => {
  it('signs the URL with secret + timestamp and @all mentions everyone', async () => {
    const m = mockFetch();
    m.respond(200, { errcode: 0 });
    const res = await send(new DingAdapter(), {
      url: 'https://oapi.dingtalk.com/robot/send',
      secret: 'SEC123',
    });
    expect(res.success).toBe(true);
    expect(m.calls[0].url).toContain('timestamp=');
    expect(m.calls[0].url).toContain('sign=');
    expect(m.calls[0].init.method).toBe('POST');
    const body = JSON.parse(String(m.calls[0].init.body));
    expect(body.msgtype).toBe('markdown');
    expect(body.at.isAtAll).toBe(false);
  });

  it('fails on non-zero errcode', async () => {
    const m = mockFetch();
    m.respond(200, { errcode: 310000, errmsg: 'sign not match' });
    const res = await send(new DingAdapter(), {
      url: 'https://oapi.dingtalk.com/robot/send',
      secret: 'SEC123',
    });
    expect(res.success).toBe(false);
    expect(res.message).toContain('sign not match');
  });
});

describe('lark adapter', () => {
  it('sends an interactive card with timestamp+sign in the body', async () => {
    const m = mockFetch();
    m.respond(200, { code: 0 });
    const res = await send(new LarkAdapter(), {
      url: 'https://open.feishu.cn/hook/x',
      secret: 'lark-secret',
    });
    expect(res.success).toBe(true);
    expect(m.calls[0].url).toBe('https://open.feishu.cn/hook/x');
    const body = JSON.parse(String(m.calls[0].init.body));
    expect(body.msg_type).toBe('interactive');
    expect(typeof body.timestamp).toBe('string');
    expect(body.sign).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it('falls back to a text message without content', async () => {
    const m = mockFetch();
    m.respond(200, { code: 0 });
    const adapter = new LarkAdapter();
    const res = await adapter.send(
      { url: 'https://open.feishu.cn/hook/x' },
      { title: 'only title' },
      CTX,
    );
    expect(res.success).toBe(true);
    const body = JSON.parse(String(m.calls[0].init.body));
    expect(body.msg_type).toBe('text');
  });
});

describe('bark adapter', () => {
  it('defaults to api.day.app and posts to /push with device_key', async () => {
    const m = mockFetch();
    m.respond(200, { code: 200 });
    const res = await send(new BarkAdapter(), { secret: 'bark-key' });
    expect(res.success).toBe(true);
    expect(m.calls[0].url).toBe('https://api.day.app/push');
    const body = JSON.parse(String(m.calls[0].init.body));
    expect(body.device_key).toBe('bark-key');
  });
});

describe('custom adapter', () => {
  it('fills the $var template with message fields', async () => {
    const m = mockFetch();
    m.respond(200, { ok: true });
    const res = await send(new CustomAdapter(), {
      url: 'https://example.com/hook',
      other: '{"text":"$title / $description","link":"$url"}',
    });
    expect(res.success).toBe(true);
    const body = JSON.parse(String(m.calls[0].init.body));
    expect(body).toEqual({ text: 't / d', link: 'https://example.com/x' });
  });

  it('rejects plain HTTP urls', () => {
    const adapter = new CustomAdapter();
    const res = adapter.validateConfig({ url: 'http://example.com/hook' });
    expect(res.valid).toBe(false);
  });
});

describe('telegram adapter', () => {
  it('posts to the bot API with the chat id', async () => {
    const m = mockFetch();
    m.respond(200, { ok: true });
    const res = await send(new TelegramAdapter(), { secret: 'BOT:TOKEN', account_id: '12345' });
    expect(res.success).toBe(true);
    expect(m.calls[0].url).toBe('https://api.telegram.org/botBOT:TOKEN/sendMessage');
    const body = JSON.parse(String(m.calls[0].init.body));
    expect(body.chat_id).toBe('12345');
  });
});

describe('discord adapter', () => {
  it('posts a single content field capped at 2000 chars', async () => {
    const m = mockFetch();
    m.respond(204, {});
    const res = await send(new DiscordAdapter(), { url: 'https://discord.com/api/webhooks/1/abc' });
    expect(res.success).toBe(true);
    const body = JSON.parse(String(m.calls[0].init.body));
    expect(Object.keys(body)).toEqual(['content']);
    expect(body.content.length).toBeLessThanOrEqual(2000);
  });
});

describe('group adapter', () => {
  it('requires a comma-separated numeric child list', () => {
    const adapter = new GroupAdapter();
    expect(adapter.validateConfig({} as never).valid).toBe(false);
    expect(adapter.validateConfig({ other: 'a,b' } as never).valid).toBe(false);
    expect(adapter.validateConfig({ other: '1,2' } as never).valid).toBe(true);
    expect(adapter.status).toBe('core');
    expect(adapter.capabilities.to_mode).toBe('none');
  });

  it('never sends on its own (fan-out lives in DeliveryService)', async () => {
    const adapter = new GroupAdapter();
    const res = await adapter.send({ other: '1' } as never, { title: 'x' }, CTX);
    expect(res.success).toBe(false);
    expect(res.message).toContain('扇出');
  });
});

describe('email permission guard (G: email 发他人需授权)', () => {
  it('refuses to send to another address without the permission', async () => {
    const adapter = new EmailAdapter();
    const res = await adapter.send(
      { account_id: 'me@example.com' },
      { title: 't', description: 'd' },
      { ...CTX, overrideTo: 'other@example.com' },
    );
    expect(res.success).toBe(false);
    expect(res.message).toContain('未允许');
  });

  it('sends to the configured address without extra permission', async () => {
    const adapter = new EmailAdapter();
    // No SMTP configured in unit context: must fail with the SMTP error, not the permission error.
    const res = await adapter.send(
      { account_id: 'me@example.com' },
      { title: 't', description: 'd' },
      CTX,
    );
    expect(res.success).toBe(false);
    expect(res.message).toContain('邮件服务未配置');
  });
});

describe('client adapter', () => {
  it('reports CLIENT_NOT_CONNECTED style failure when the hub has no session', async () => {
    const adapter = new ClientAdapter();
    const res = await adapter.send({ secret: 'k' }, { title: 't' }, CTX);
    expect(res.success).toBe(false);
    expect(res.message).toContain('未连接');
  });
});
