import { PushMessage } from '../channels/adapter.interface';

/**
 * Registry of live /ws/client connections, keyed by "userId:channelName".
 * Single connection per key: a newer connection evicts the older one (F-10).
 */
interface ClientEntry {
  socket: { readyState: number; send: (data: string) => void; close: (code?: number, reason?: string) => void };
  alive: boolean;
}

const connections = new Map<string, ClientEntry>();

export function clientKey(userId: number, channelName: string): string {
  return `${userId}:${channelName}`;
}

export function registerClient(
  key: string,
  socket: ClientEntry['socket'],
  onEvicted?: () => void,
): void {
  const prev = connections.get(key);
  if (prev) {
    try {
      prev.socket.send(
        JSON.stringify({ type: 'offline', message: '已有新客户端连接，本连接将被断开' }),
      );
      prev.socket.close(4000, 'evicted by newer connection');
    } catch { /* already dead */ }
    onEvicted?.();
  }
  connections.set(key, { socket, alive: true });
}

export function dropClient(key: string): void {
  connections.delete(key);
}

export function isClientConnected(key: string): boolean {
  const entry = connections.get(key);
  return Boolean(entry && entry.socket.readyState === 1);
}

/** Deliver a message frame; returns false when no live connection. */
export function pushToClient(key: string, msg: PushMessage, htmlContent: string): boolean {
  const entry = connections.get(key);
  if (!entry || entry.socket.readyState !== 1) return false;
  entry.socket.send(
    JSON.stringify({
      type: 'message',
      title: msg.title ?? '',
      description: msg.description ?? '',
      content: msg.content ?? '',
      html_content: htmlContent,
      url: msg.url ?? '',
      render_mode: msg.renderMode ?? 'markdown',
    }),
  );
  return true;
}

export function listClientKeys(): string[] {
  return [...connections.entries()]
    .filter(([, e]) => e.socket.readyState === 1)
    .map(([k]) => k);
}

export function markAlive(key: string, alive: boolean): void {
  const entry = connections.get(key);
  if (entry) entry.alive = alive;
}

export function isAlive(key: string): boolean {
  return connections.get(key)?.alive ?? false;
}
