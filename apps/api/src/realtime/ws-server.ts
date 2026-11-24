import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import { PrismaService } from '../prisma/prisma.service';
import { decrypt } from '../common/crypto';
import {
  clientKey,
  dropClient,
  isAlive,
  isCurrentClient,
  markAlive,
  registerClient,
} from './client-hub';

const PING_INTERVAL_MS = 56_000;
const PONG_TIMEOUT_MS = 60_000;

interface ClientChannelConfig {
  secret?: string;
}

/**
 * Attaches the raw WebSocket endpoint at /ws/client.
 *
 * Handshake query: username, channel (client-type channel name), secret
 * (the channel's connection secret — NOT the push token).
 */
export function attachWsServer(server: HttpServer, prisma: PrismaService): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const { pathname } = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (pathname !== '/ws/client') return; // other upgrades fail naturally
    wss.handleUpgrade(req, socket, head, (ws) => {
      void handleConnection(wss, ws, req, prisma);
    });
  });
}

async function handleConnection(
  wss: WebSocketServer,
  ws: WebSocket,
  req: IncomingMessage,
  prisma: PrismaService,
): Promise<void> {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const username = url.searchParams.get('username') || '';
  const channelName = url.searchParams.get('channel') || '';
  const secret = url.searchParams.get('secret') || '';

  const reject = (code: number, message: string) => {
    try {
      ws.close(code, message);
    } catch { /* already closed */ }
  };

  if (!username || !channelName) {
    return reject(4401, '缺少 username 或 channel 参数');
  }

  const user = await prisma.user.findFirst({
    where: { username, deletedAt: null, status: 'active' },
  });
  if (!user) return reject(4401, '用户不存在或被禁用');

  const channel = await prisma.channel.findFirst({
    where: { ownerId: user.id, name: channelName },
  });
  if (!channel || channel.type !== 'client') {
    return reject(4403, '通道不存在或不是 client 类型');
  }

  let config: ClientChannelConfig = {};
  try {
    config = JSON.parse(channel.config || '{}') as ClientChannelConfig;
  } catch { /* treat as empty */ }
  const stored = config.secret
    ? config.secret.startsWith('enc:')
      ? decrypt(config.secret.slice(4))
      : config.secret
    : null;
  if (!stored || stored !== secret) {
    return reject(4403, '连接密钥错误');
  }

  const key = clientKey(user.id, channelName);
  registerClient(key, ws);

  ws.send(
    JSON.stringify({
      type: 'welcome',
      message: '已连接，等待推送',
      channel: channelName,
    }),
  );

  ws.on('pong', () => markAlive(key, true, ws));
  ws.on('close', () => cleanup());
  ws.on('error', () => cleanup());

  let closed = false;
  const timers: NodeJS.Timeout[] = [];

  const pingTimer = setInterval(() => {
    markAlive(key, false, ws); // expect a pong before the watchdog fires
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.ping();
      } catch {
        dropClient(key, ws);
      }
    }
  }, PING_INTERVAL_MS);
  timers.push(pingTimer);

  // Watchdog: no pong since the last ping window -> terminate.
  const pongWatch = setInterval(() => {
    if (closed) return;
    // A newer connection replaced this one: stop this socket's housekeeping
    // without touching the live entry under the shared key.
    if (!isCurrentClient(key, ws)) {
      cleanup();
      return;
    }
    if (!isAlive(key)) {
      try {
        ws.terminate();
      } catch { /* ignore */ }
      dropClient(key, ws);
      cleanup();
    }
  }, PONG_TIMEOUT_MS);
  timers.push(pongWatch);

  function cleanup() {
    if (closed) return;
    closed = true;
    dropClient(key, ws);
    for (const t of timers) clearInterval(t);
  }

  // Housekeeping stops with the server too.
  wss.on('close', () => cleanup());
}
