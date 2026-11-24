/**
 * Stage 12 / B1：`client` 通道 WS 端到端验证（V1–V5）。
 *
 * WS 只在 dist/main.js 启动路径挂载（main.ts 在 listen 之后 attachWsServer），
 * 进程内 harness（helpers/app.ts）不挂 WS，所以这里必须 spawn 真进程。
 * 运行前需先 `pnpm --filter api build`；缺 dist/main.js 会直接抛错，不许出假结果。
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { spawnMainServer, type ServerHandle } from './helpers/server';
import { call, cookieOf, loginRoot } from './helpers/app';

const MAIN_JS = resolve(__dirname, '../dist/main.js');
if (!existsSync(MAIN_JS)) {
  throw new Error(`client WS 集成测试需要 ${MAIN_JS}：先跑 "pnpm --filter api build"。`);
}

const ROOT_PASSWORD = 'root-ws-pass';
const CHANNEL = 'ws-e2e';
const IDLE_CHANNEL = 'ws-e2e-idle';
const SECRET = 'ws-secret-42';

interface Frame {
  type?: string;
  [key: string]: unknown;
}

interface Client {
  ws: WebSocket;
  frames: Frame[];
  closed: Promise<{ code: number; reason: string }>;
}

let server: ServerHandle;
let base = '';
let wsBase = '';
let cookie = '';
const clients: Client[] = [];

/** 打开一个 WS 客户端，收集所有服务端帧，并暴露 close 事件。 */
function connect(params: Record<string, string> = {}): Client {
  const qs = new URLSearchParams(params).toString();
  const ws = new WebSocket(`${wsBase}/ws/client?${qs}`);
  const frames: Frame[] = [];
  ws.on('message', (raw) => {
    try {
      frames.push(JSON.parse(raw.toString()) as Frame);
    } catch {
      // 非 JSON 帧直接丢弃，测试只关心协议帧
    }
  });
  const closed = new Promise<{ code: number; reason: string }>((resolveClose) => {
    ws.on('close', (code, reason) => resolveClose({ code, reason: reason.toString() }));
  });
  const client = { ws, frames, closed };
  clients.push(client);
  return client;
}

async function waitForFrame(
  frames: Frame[],
  pred: (f: Frame) => boolean,
  what = '目标帧',
  timeoutMs = 5_000,
): Promise<Frame> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = frames.find(pred);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`等待${what}超时；已收到：${JSON.stringify(frames)}`);
}

async function waitOpen(ws: WebSocket, timeoutMs = 5_000): Promise<void> {
  if (ws.readyState === WebSocket.OPEN) return;
  await new Promise<void>((resolveOpen, rejectOpen) => {
    const timer = setTimeout(() => rejectOpen(new Error('WS 连接超时')), timeoutMs);
    ws.once('open', () => {
      clearTimeout(timer);
      resolveOpen();
    });
    ws.once('error', (err) => {
      clearTimeout(timer);
      rejectOpen(err);
    });
  });
}

/** 建通道并断言成功，返回通道名。 */
async function createChannel(type: string, name: string, config: Record<string, string> = {}): Promise<void> {
  const res = await call(base, '/api/channels', {
    method: 'POST',
    cookie,
    body: JSON.stringify({ type, name, config }),
  });
  expect(res.status, res.raw).toBe(200);
  expect(res.body?.success, res.raw).toBe(true);
}

async function pushMessage(channel: string, body: Record<string, unknown> = {}) {
  return call(base, '/api/messages', {
    method: 'POST',
    cookie,
    body: JSON.stringify({ channel, content: 'WS 端到端验证正文', ...body }),
  });
}

describe('client 通道 WS 端到端（Stage 12 / B1）', () => {
  beforeAll(async () => {
    server = await spawnMainServer();
    base = server.base;
    wsBase = base.replace(/^http/, 'ws');

    // 新库 root 处于强制改密状态：先改密再重登，否则 /api/* 会被拦。
    cookie = await loginRoot(base);
    const changed = await call(base, '/api/me', {
      method: 'PATCH',
      cookie,
      body: JSON.stringify({ old_password: '123456', password: ROOT_PASSWORD }),
    });
    expect(changed.status, changed.raw).toBe(200);
    const relogin = await call(base, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'root', password: ROOT_PASSWORD }),
    });
    expect(relogin.status, relogin.raw).toBe(200);
    cookie = cookieOf(relogin.setCookie);

    await createChannel('client', CHANNEL, { secret: SECRET });
    await createChannel('client', IDLE_CHANNEL, { secret: SECRET });
    // 非 client 类型通道，用于拒绝路径
    await createChannel('none', 'ws-not-client');
  }, 60_000);

  afterAll(async () => {
    for (const c of clients) {
      try {
        c.ws.terminate();
      } catch {
        // 已断开，忽略
      }
    }
    await server?.stop();
  });

  it('V1 连接鉴权：正确的 username/channel/secret 连接后收到 welcome', async () => {
    const c = connect({ username: 'root', channel: CHANNEL, secret: SECRET });
    await waitOpen(c.ws);
    const welcome = await waitForFrame(c.frames, (f) => f.type === 'welcome', 'welcome 帧');
    expect(welcome.channel).toBe(CHANNEL);
  });

  it('V2 真实推送：POST /api/messages 后客户端收到逐字段匹配的 message 帧', async () => {
    const c = connect({ username: 'root', channel: CHANNEL, secret: SECRET });
    await waitOpen(c.ws);
    await waitForFrame(c.frames, (f) => f.type === 'welcome', 'welcome 帧');

    const res = await pushMessage(CHANNEL, {
      title: 'WS 标题',
      description: 'WS 描述',
      url: 'https://example.com/ws-e2e',
      render_mode: 'markdown',
    });
    expect(res.status, res.raw).toBe(200);
    expect(res.body?.success, res.raw).toBe(true);

    const frame = await waitForFrame(c.frames, (f) => f.type === 'message', 'message 帧');
    expect(frame).toMatchObject({
      type: 'message',
      title: 'WS 标题',
      description: 'WS 描述',
      content: 'WS 端到端验证正文',
      html_content: '',
      url: 'https://example.com/ws-e2e',
      render_mode: 'markdown',
    });
  });

  it('V3 拒绝路径：缺参/用户不存在 → 4401，非 client 通道/密钥错误 → 4403', async () => {
    const missing = connect({});
    expect((await missing.closed).code).toBe(4401);

    const unknownUser = connect({ username: 'nobody-ws', channel: CHANNEL, secret: SECRET });
    expect((await unknownUser.closed).code).toBe(4401);

    const notClient = connect({ username: 'root', channel: 'ws-not-client', secret: SECRET });
    expect((await notClient.closed).code).toBe(4403);

    const badSecret = connect({ username: 'root', channel: CHANNEL, secret: 'wrong-secret' });
    expect((await badSecret.closed).code).toBe(4403);
  });

  it('V4 无客户端连接时推送失败，错误来自适配器', async () => {
    const res = await pushMessage(IDLE_CHANNEL);
    expect(res.status, res.raw).toBe(200);
    expect(res.body?.success, res.raw).toBe(false);
    expect(String(res.body?.message ?? ''), res.raw).toContain('客户端未连接');
  });

  it('V5 同 key 单连接：新连接驱逐旧连接，旧连接收 offline 帧 + close 4000', async () => {
    const first = connect({ username: 'root', channel: CHANNEL, secret: SECRET });
    await waitOpen(first.ws);
    await waitForFrame(first.frames, (f) => f.type === 'welcome', 'welcome 帧');

    const second = connect({ username: 'root', channel: CHANNEL, secret: SECRET });
    await waitOpen(second.ws);
    await waitForFrame(second.frames, (f) => f.type === 'welcome', 'welcome 帧');

    const offline = await waitForFrame(first.frames, (f) => f.type === 'offline', 'offline 帧');
    expect(String(offline.message ?? '')).toContain('新客户端');
    expect((await first.closed).code).toBe(4000);
    // 新连接仍可用：推送落到新连接
    const res = await pushMessage(CHANNEL, { title: '驱动后仍可投递' });
    expect(res.body?.success, res.raw).toBe(true);
    const frame = await waitForFrame(second.frames, (f) => f.type === 'message', 'message 帧');
    expect(frame.title).toBe('驱动后仍可投递');
  });
});
