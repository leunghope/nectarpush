import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
    };
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/**
 * Cloudflare Turnstile widget, injected on demand. Only mounted when
 * GET /api/public/turnstile-sitekey reports `enabled: true`.
 */
export function Turnstile({ siteKey, onToken }: { siteKey: string; onToken: (token: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    let cancelled = false;

    const render = () => {
      if (cancelled || !window.turnstile || !ref.current) return;
      ref.current.innerHTML = '';
      window.turnstile.render(ref.current, {
        sitekey: siteKey,
        callback: (token: string) => onTokenRef.current(token),
        'error-callback': () => onTokenRef.current(''),
        'expired-callback': () => onTokenRef.current(''),
      });
    };

    if (window.turnstile) {
      render();
    } else {
      const existing = document.querySelector<HTMLScriptElement>('script[data-np-turnstile]');
      if (existing) {
        existing.addEventListener('load', render, { once: true });
      } else {
        const s = document.createElement('script');
        s.src = SCRIPT_SRC;
        s.async = true;
        s.defer = true;
        s.dataset.npTurnstile = '1';
        s.addEventListener('load', render, { once: true });
        document.head.appendChild(s);
      }
    }

    return () => {
      cancelled = true;
    };
  }, [siteKey]);

  return <div ref={ref} className="turnstile-widget" />;
}
