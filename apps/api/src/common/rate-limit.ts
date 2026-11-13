/**
 * Minimal in-memory rate limiter (single-node, per-IP buckets).
 *
 * - push + webhook trigger: 60 req / 3 min per IP
 * - auth critical (login/register/verification/reset): 20 req / 20 min per IP
 * - email-to-others (D-08): 10 req / 3 min per sender user — stricter bucket
 *   for pushes addressed to somebody else's mailbox, keyed by user id rather
 *   than IP because the abuse vector is an authorized sender, not an address.
 * - everything else: 300 req / 1 min per IP
 *
 * Returns null when allowed, or the number of seconds until the window
 * resets when limited.
 */
const PUSH_LIMIT = 60;
const PUSH_WINDOW_MS = 3 * 60 * 1000;
const CRITICAL_LIMIT = 20;
const CRITICAL_WINDOW_MS = 20 * 60 * 1000;

/** E2E boots one API for the whole suite, so the default bucket gets a higher ceiling. */
function envLimit(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

const DEFAULT_LIMIT = envLimit('RATE_LIMIT_DEFAULT_MAX', 300);
const DEFAULT_WINDOW_MS = 60 * 1000;
const EMAIL_OTHERS_LIMIT = envLimit('RATE_LIMIT_EMAIL_OTHERS_MAX', 10);
const EMAIL_OTHERS_WINDOW_MS = 3 * 60 * 1000;

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export type RateLimitClass = 'push' | 'critical' | 'default' | 'emailToOthers';

/**
 * Only API and trigger routes are rate limited. Static SPA assets and the HTML
 * document are served by the same Fastify instance; counting them per IP makes
 * a handful of page loads exhaust the default bucket and breaks the app for
 * legitimate users behind a shared address.
 */
export function shouldRateLimit(path: string): boolean {
  if (path === '/push' || path.startsWith('/push/')) return true;
  if (path === '/webhook' || path.startsWith('/webhook/')) return true;
  return path === '/api' || path.startsWith('/api/');
}

export function rateLimitClassOf(path: string): RateLimitClass {
  if (path === '/push' || path.startsWith('/push/') ||
      path === '/webhook' || path.startsWith('/webhook/')) {
    return 'push';
  }
  if (path.startsWith('/api/auth/')) return 'critical';
  return 'default';
}

export function consumeRateLimit(cls: RateLimitClass, key: string): number | null {
  const limit =
    cls === 'push' ? PUSH_LIMIT
    : cls === 'critical' ? CRITICAL_LIMIT
    : cls === 'emailToOthers' ? EMAIL_OTHERS_LIMIT
    : DEFAULT_LIMIT;
  const windowMs =
    cls === 'push' ? PUSH_WINDOW_MS
    : cls === 'critical' ? CRITICAL_WINDOW_MS
    : cls === 'emailToOthers' ? EMAIL_OTHERS_WINDOW_MS
    : DEFAULT_WINDOW_MS;
  const now = Date.now();
  const id = `${cls}:${key}`;
  const bucket = buckets.get(id);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(id, { count: 1, resetAt: now + windowMs });
    return null;
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    return Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  }
  return null;
}

/** Test hook: clear all buckets. */
export function resetRateLimits(): void {
  buckets.clear();
}
