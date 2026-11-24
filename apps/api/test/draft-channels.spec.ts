import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { ChannelAdapter, SendResult, AdapterCtx } from '../src/channels/adapter.interface';
import { CorpAdapter } from '../src/channels/corp/corp.adapter';
import { CorpAppAdapter } from '../src/channels/corp_app/corp_app.adapter';
import { TestWechatAdapter } from '../src/channels/test/test.adapter';
import { LarkAppAdapter } from '../src/channels/lark_app/lark_app.adapter';
import { OneBotAdapter } from '../src/channels/one_bot/one_bot.adapter';
import { cacheKey, clearTokenCache } from '../src/channels/token-cache';

interface FetchMock {
  calls: Array<{ url: string; init: RequestInit }>;
  respond: (status: number, body: unknown) => void;
  respondSeq: (responses: Array<{ status: number; body: unknown }>) => void;
}

/**
 * fetch stub: a queue of scripted responses; when the queue empties the last
 * response is reused. Every call is recorded for assertions.
 */
function mockFetch(): FetchMock {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const queue: Array<{ status: number; body: unknown }> = [];
  let fallback: { status: number; body: unknown } = { status: 200, body: {} };
  const state: FetchMock = {
    calls,
    respond: (status, body) => {
      fallback = { status, body };
      queue.push({ status, body });
    },
    respondSeq: (responses) => {
      for (const r of responses) queue.push(r);
    },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      state.calls.push({ url: String(url), init: init ?? {} });
      const item = queue.length ? queue.shift()! : fallback;
      const nullBody = item.status === 204 || item.status === 205 || item.status === 304;
      return new Response(nullBody ? null : JSON.stringify(item.body), {
        status: item.status,
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

const MSG = { title: 't', description: 'd', content: 'c', url: 'https://example.com/x' };

async function send(
  adapter: ChannelAdapter,
  config: Record<string, string>,
  ctx: AdapterCtx = CTX,
): Promise<SendResult> {
  const validation = adapter.validateConfig(config as never);
  if (!validation.valid) throw new Error(`invalid config: ${JSON.stringify(validation.errors)}`);
  return adapter.send(config as never, MSG, ctx);
}

/** Call send without the validateConfig guard (used by the missing-field cases). */
async function sendRaw(
  adapter: ChannelAdapter,
  config: Record<string, string>,
  ctx: AdapterCtx = CTX,
): Promise<SendResult> {
  return adapter.send(config as never, MSG, ctx);
}

beforeEach(() => {
  clearTokenCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('corp adapter（企业微信群机器人）', () => {
  it('sends text + mentioned_list when @ members are configured', async () => {
    const m = mockFetch();
    m.respond(200, { errcode: 0 });
    const res = await send(new CorpAdapter(), { url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=k', mentioned: '@all' });
    expect(res.success).toBe(true);
    expect(m.calls[0].url).toContain('webhook/send');
    const body = JSON.parse(String(m.calls[0].init.body));
    expect(body.msgtype).toBe('text');
    expect(body.text.mentioned_list).toEqual(['@all']);
  });

  it('sends markdown when no @ members are configured', async () => {
    const m = mockFetch();
    m.respond(200, { errcode: 0 });
    const res = await send(new CorpAdapter(), { url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=k' });
    expect(res.success).toBe(true);
    const body = JSON.parse(String(m.calls[0].init.body));
    expect(body.msgtype).toBe('markdown');
    expect(body.markdown.content).toContain('c');
  });

  it('fails on a non-zero errcode and echoes the upstream errmsg', async () => {
    const m = mockFetch();
    m.respond(200, { errcode: 310000, errmsg: 'sign not match' });
    const res = await send(new CorpAdapter(), { url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=k' });
    expect(res.success).toBe(false);
    expect(res.message).toContain('sign not match');
  });

  it('reports a missing url without throwing', async () => {
    const m = mockFetch();
    const res = await sendRaw(new CorpAdapter(), {});
    expect(res.success).toBe(false);
    expect(res.message).toContain('Webhook 地址');
    expect(m.calls).toHaveLength(0);
  });
});

describe('corp_app adapter（企业微信应用号）', () => {
  it('fetches a token then sends a markdown message to @all', async () => {
    const m = mockFetch();
    m.respondSeq([
      { status: 200, body: { errcode: 0, access_token: 'TOK', expires_in: 7200 } },
      { status: 200, body: { errcode: 0 } },
    ]);
    const res = await send(new CorpAppAdapter(), {
      app_id: 'corpid',
      secret: 'secret',
      account_id: '1000002',
    });
    expect(res.success).toBe(true);
    expect(m.calls[0].url).toContain('gettoken');
    expect(m.calls[1].url).toContain('access_token=TOK');
    const body = JSON.parse(String(m.calls[1].init.body));
    expect(body.touser).toBe('@all');
    expect(body.agentid).toBe(1000002);
    expect(body.msgtype).toBe('markdown');
  });

  it('builds a textcard body when msg_type is textcard', async () => {
    const m = mockFetch();
    m.respondSeq([
      { status: 200, body: { errcode: 0, access_token: 'TOK', expires_in: 7200 } },
      { status: 200, body: { errcode: 0 } },
    ]);
    const res = await send(new CorpAppAdapter(), {
      app_id: 'corpid',
      secret: 'secret',
      account_id: '1000002',
      msg_type: 'textcard',
    });
    expect(res.success).toBe(true);
    const body = JSON.parse(String(m.calls[1].init.body));
    expect(body.msgtype).toBe('textcard');
    expect(body.textcard.title).toBe('t');
    expect(body.textcard.url).toBe('https://example.com/x');
  });

  it('reports a failed gettoken with the upstream body', async () => {
    const m = mockFetch();
    m.respond(200, { errcode: 40013, errmsg: 'invalid corpid' });
    const res = await send(new CorpAppAdapter(), { app_id: 'corpid', secret: 'secret', account_id: '1000002' });
    expect(res.success).toBe(false);
    expect(res.message).toContain('invalid corpid');
  });

  it('reports missing required fields without throwing', async () => {
    const res = await sendRaw(new CorpAppAdapter(), { app_id: 'corpid' });
    expect(res.success).toBe(false);
    expect(res.message).toContain('CorpSecret');
    expect(res.message).toContain('AgentID');
  });
});

describe('test adapter（微信测试号）', () => {
  it('fetches a token then sends a template message with the fixed data keys', async () => {
    const m = mockFetch();
    m.respondSeq([
      { status: 200, body: { errcode: 0, access_token: 'TOK', expires_in: 7200 } },
      { status: 200, body: { errcode: 0 } },
    ]);
    const res = await send(new TestWechatAdapter(), {
      app_id: 'wxid',
      secret: 'secret',
      account_id: 'OPENID',
      template_id: 'TPL',
    });
    expect(res.success).toBe(true);
    expect(m.calls[0].url).toContain('grant_type=client_credential');
    expect(m.calls[1].url).toContain('template/send');
    const body = JSON.parse(String(m.calls[1].init.body));
    expect(body.touser).toBe('OPENID');
    expect(body.template_id).toBe('TPL');
    expect(body.url).toBe('https://example.com/x');
    expect(body.data.title).toEqual({ value: 't' });
    expect(body.data.text).toEqual({ value: expect.any(String) });
  });

  it('fails on a non-zero template send errcode', async () => {
    const m = mockFetch();
    m.respondSeq([
      { status: 200, body: { errcode: 0, access_token: 'TOK', expires_in: 7200 } },
      { status: 200, body: { errcode: 47003, errmsg: 'argument error' } },
    ]);
    const res = await send(new TestWechatAdapter(), {
      app_id: 'wxid',
      secret: 'secret',
      account_id: 'OPENID',
      template_id: 'TPL',
    });
    expect(res.success).toBe(false);
    expect(res.message).toContain('argument error');
  });

  it('reports missing template_id without throwing', async () => {
    const res = await sendRaw(new TestWechatAdapter(), {
      app_id: 'wxid',
      secret: 'secret',
      account_id: 'OPENID',
    });
    expect(res.success).toBe(false);
    expect(res.message).toContain('模板 ID');
  });
});

describe('lark_app adapter（飞书自建应用）', () => {
  it('fetches a token and sends a text message as a JSON-string content', async () => {
    const m = mockFetch();
    m.respondSeq([
      { status: 200, body: { code: 0, tenant_access_token: 'TOK', expire: 7200 } },
      { status: 200, body: { code: 0 } },
    ]);
    const res = await send(new LarkAppAdapter(), {
      app_id: 'cli_app',
      secret: 'secret',
      receive_id_type: 'chat_id',
      receive_id: 'oc_chat',
      msg_type: 'text',
    });
    expect(res.success).toBe(true);
    expect(m.calls[1].url).toContain('receive_id_type=chat_id');
    expect((m.calls[1].init.headers as Record<string, string>).authorization).toBe('Bearer TOK');
    const body = JSON.parse(String(m.calls[1].init.body));
    expect(body.receive_id).toBe('oc_chat');
    expect(body.msg_type).toBe('text');
    expect(() => JSON.parse(body.content as string)).not.toThrow();
    expect(JSON.parse(body.content as string).text).toContain('c');
  });

  it('builds an interactive card with a header when msg_type is interactive', async () => {
    const m = mockFetch();
    m.respondSeq([
      { status: 200, body: { code: 0, tenant_access_token: 'TOK', expire: 7200 } },
      { status: 200, body: { code: 0 } },
    ]);
    const res = await send(new LarkAppAdapter(), {
      app_id: 'cli_app',
      secret: 'secret',
      receive_id: 'oc_chat',
      msg_type: 'interactive',
    });
    expect(res.success).toBe(true);
    const body = JSON.parse(String(m.calls[1].init.body));
    expect(body.msg_type).toBe('interactive');
    const card = JSON.parse(body.content as string);
    expect(card.config.wide_screen_mode).toBe(true);
    expect(card.header.title.content).toBe('t');
    expect(card.elements[0].text.tag).toBe('lark_md');
  });

  it('drops the token, refetches and retries once on code 99991663', async () => {
    const m = mockFetch();
    m.respondSeq([
      { status: 200, body: { code: 0, tenant_access_token: 'TOK1', expire: 7200 } },
      { status: 200, body: { code: 99991663, msg: 'token invalid' } },
      { status: 200, body: { code: 0, tenant_access_token: 'TOK2', expire: 7200 } },
      { status: 200, body: { code: 0 } },
    ]);
    const res = await send(new LarkAppAdapter(), {
      app_id: 'cli_app',
      secret: 'secret',
      receive_id: 'oc_chat',
    });
    expect(res.success).toBe(true);
    expect(m.calls).toHaveLength(4);
    expect(m.calls[1].url).toContain('receive_id_type=chat_id');
    expect((m.calls[3].init.headers as Record<string, string>).authorization).toBe('Bearer TOK2');
  });

  it('reports missing receive_id without throwing', async () => {
    const res = await sendRaw(new LarkAppAdapter(), { app_id: 'cli_app', secret: 'secret' });
    expect(res.success).toBe(false);
    expect(res.message).toContain('接收 ID');
  });
});

describe('one_bot adapter（QQ / OneBot）', () => {
  it('sends a private message and normalizes the url to /send_msg', async () => {
    const m = mockFetch();
    m.respond(200, { retcode: 0 });
    const res = await send(new OneBotAdapter(), {
      url: 'http://127.0.0.1:8080/',
      secret: 'TK',
      account_id: '10001',
      target_type: 'private',
    });
    expect(res.success).toBe(true);
    expect(m.calls[0].url).toBe('http://127.0.0.1:8080/send_msg');
    expect((m.calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer TK');
    const body = JSON.parse(String(m.calls[0].init.body));
    expect(body.message_type).toBe('private');
    expect(body.user_id).toBe('10001');
  });

  it('sends a group message with a numeric group_id', async () => {
    const m = mockFetch();
    m.respond(200, { retcode: 0 });
    const res = await send(new OneBotAdapter(), {
      url: 'http://127.0.0.1:8080/send_msg',
      account_id: '20002',
      target_type: 'group',
    });
    expect(res.success).toBe(true);
    expect(m.calls[0].url).toBe('http://127.0.0.1:8080/send_msg');
    const body = JSON.parse(String(m.calls[0].init.body));
    expect(body.message_type).toBe('group');
    expect(body.group_id).toBe(20002);
  });

  it('fails on a non-zero retcode and echoes the upstream wording', async () => {
    const m = mockFetch();
    m.respond(200, { retcode: 140000, message: 'permission denied' });
    const res = await send(new OneBotAdapter(), { url: 'http://127.0.0.1:8080', account_id: '10001' });
    expect(res.success).toBe(false);
    expect(res.message).toContain('permission denied');
  });

  it('reports a missing url without throwing', async () => {
    const res = await sendRaw(new OneBotAdapter(), { account_id: '10001' });
    expect(res.success).toBe(false);
    expect(res.message).toContain('OneBot 服务地址');
  });
});

describe('token cache（懒加载 + 失效重取）', () => {
  it('the cache key never contains the plaintext secret', () => {
    const key = cacheKey('corp_app', 'corpid', 'super-secret-value');
    expect(key).not.toContain('super-secret-value');
    expect(key).toMatch(/^corp_appcorpid:[0-9a-f]{16}$/);
  });

  it('reuses a cached token across sends (no second gettoken call)', async () => {
    const m = mockFetch();
    m.respondSeq([
      { status: 200, body: { errcode: 0, access_token: 'TOK', expires_in: 7200 } },
      { status: 200, body: { errcode: 0 } },
      { status: 200, body: { errcode: 0 } },
    ]);
    const adapter = new CorpAppAdapter();
    const cfg = { app_id: 'corpid', secret: 'secret', account_id: '1000002' };
    const first = await adapter.send(cfg as never, MSG, CTX);
    const second = await adapter.send(cfg as never, MSG, CTX);
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    const gettokenCalls = m.calls.filter((c) => c.url.includes('gettoken'));
    expect(gettokenCalls).toHaveLength(1);
    expect(m.calls.filter((c) => c.url.includes('message/send')).length).toBe(2);
  });

  it('invalidates the token and refetches once when the send errcode says the token is gone', async () => {
    const m = mockFetch();
    m.respondSeq([
      { status: 200, body: { errcode: 0, access_token: 'TOK1', expires_in: 7200 } },
      { status: 200, body: { errcode: 42001, errmsg: 'expired' } },
      { status: 200, body: { errcode: 0, access_token: 'TOK2', expires_in: 7200 } },
      { status: 200, body: { errcode: 0 } },
    ]);
    const adapter = new CorpAppAdapter();
    const res = await adapter.send(
      { app_id: 'corpid', secret: 'secret', account_id: '1000002' } as never,
      MSG,
      CTX,
    );
    expect(res.success).toBe(true);
    const gettokenCalls = m.calls.filter((c) => c.url.includes('gettoken'));
    expect(gettokenCalls).toHaveLength(2);
    expect(m.calls.filter((c) => c.url.includes('message/send')).length).toBe(2);
  });

  it('gives up and echoes the upstream body when the retry still fails', async () => {
    const m = mockFetch();
    m.respondSeq([
      { status: 200, body: { errcode: 0, access_token: 'TOK1', expires_in: 7200 } },
      { status: 200, body: { errcode: 40001, errmsg: 'invalid' } },
      { status: 200, body: { errcode: 0, access_token: 'TOK2', expires_in: 7200 } },
      { status: 200, body: { errcode: 40001, errmsg: 'still invalid' } },
    ]);
    const adapter = new CorpAppAdapter();
    const res = await adapter.send(
      { app_id: 'corpid', secret: 'secret', account_id: '1000002' } as never,
      MSG,
      CTX,
    );
    expect(res.success).toBe(false);
    expect(res.message).toContain('still invalid');
  });
});
