import { createContext, useCallback, useContext, useRef, type ReactNode } from 'react';
import type { MessageDelivery, MessageSummary } from '@nectarpush/shared';
import { useSse, type SseStatus } from '@/hooks/useSse';

export type SseEvent =
  | { type: 'message.created'; payload: MessageSummary }
  | { type: 'delivery.updated'; payload: MessageDelivery & { message_id?: number } };

type Listener = (event: SseEvent) => void;

type SseContextValue = {
  status: SseStatus;
  subscribe: (listener: Listener) => () => void;
};

const SseContext = createContext<SseContextValue>({
  status: 'connecting',
  subscribe: () => () => {},
});

/** Single shared SSE connection for the authenticated app. */
export function SseProvider({ children, enabled = true }: { children: ReactNode; enabled?: boolean }) {
  const listeners = useRef<Set<Listener>>(new Set());

  const status = useSse(
    {
      onMessageCreated: (payload) => {
        listeners.current.forEach((l) => l({ type: 'message.created', payload }));
      },
      onDeliveryUpdated: (payload) => {
        listeners.current.forEach((l) => l({ type: 'delivery.updated', payload }));
      },
    },
    enabled,
  );

  const subscribe = useCallback((listener: Listener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  return <SseContext.Provider value={{ status, subscribe }}>{children}</SseContext.Provider>;
}

export const useSseContext = (): SseContextValue => useContext(SseContext);
