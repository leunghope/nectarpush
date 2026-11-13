import { useEffect, useRef, useState } from 'react';
import type { MessageDelivery, MessageSummary } from '@nectarpush/shared';

export type SseStatus = 'connecting' | 'open' | 'reconnecting';

type SseHandlers = {
  onMessageCreated?: (msg: MessageSummary) => void;
  onDeliveryUpdated?: (delivery: MessageDelivery & { message_id?: number }) => void;
  /** Fired on every (re)connect — use to backfill missed events. */
  onOpen?: () => void;
};

/**
 * Subscribe to GET /api/events. EventSource reconnects automatically using the
 * server-provided `retry: 5000` directive; we surface the connection state so
 * the UI can show a reconnect banner and backfill on reopen.
 */
export function useSse(handlers: SseHandlers, enabled = true): SseStatus {
  const [status, setStatus] = useState<SseStatus>('connecting');
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;
    let es: EventSource | null = null;
    let closedByUs = false;

    const connect = () => {
      es = new EventSource('/api/events', { withCredentials: true });
      es.onopen = () => {
        setStatus('open');
        handlersRef.current.onOpen?.();
      };
      es.addEventListener('message.created', (e) => {
        try {
          handlersRef.current.onMessageCreated?.(JSON.parse((e as MessageEvent).data));
        } catch {
          /* ignore malformed frame */
        }
      });
      es.addEventListener('delivery.updated', (e) => {
        try {
          handlersRef.current.onDeliveryUpdated?.(JSON.parse((e as MessageEvent).data));
        } catch {
          /* ignore malformed frame */
        }
      });
      es.onerror = () => {
        // EventSource will retry on its own; reflect the state meanwhile.
        if (!closedByUs) setStatus('reconnecting');
      };
    };

    connect();

    return () => {
      closedByUs = true;
      es?.close();
    };
  }, [enabled]);

  return status;
}
