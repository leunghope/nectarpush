import { EventEmitter } from 'node:events';

/**
 * SSE hub: in-process event bus fanned out to connected consoles.
 * Clients subscribe at GET /api/events; heartbeat every 25s.
 * Each client is bound to a userId so user-scoped events (message.created,
 * delivery.updated) are only delivered to their owner's consoles.
 */
export interface SseEvent {
  event: string;
  data: unknown;
}

type Client = {
  userId: number;
  write: (chunk: string) => void;
};

const clients = new Set<Client>();
const bus = new EventEmitter();
bus.setMaxListeners(0);

export function sseSubscribe(client: Client): () => void {
  clients.add(client);
  client.write('retry: 5000\n\n');
  client.write(`event: connected\ndata: {}\n\n`);
  return () => clients.delete(client);
}

/**
 * Fan out an event. Pass targetUserId to deliver only to that user's
 * connections (user-scoped events); omit it for instance-wide system events.
 */
export function sseBroadcast(event: SseEvent, targetUserId?: number): void {
  const frame = `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
  for (const c of clients) {
    if (targetUserId !== undefined && c.userId !== targetUserId) continue;
    try {
      c.write(frame);
    } catch {
      clients.delete(c);
    }
  }
}

export function sseHeartbeat(): void {
  for (const c of clients) {
    try {
      c.write(': heartbeat\n\n');
    } catch {
      clients.delete(c);
    }
  }
}

export function sseClientCount(): number {
  return clients.size;
}
