import { createHash } from 'node:crypto';

/**
 * In-process token cache for token-based channels (wechat test account,
 * wecom corp_app, feishu lark_app).
 *
 * - Lazily populated on first send/test; entries expire 5 minutes before the
 *   upstream-reported lifetime.
 * - The cache key never contains the plaintext secret: it is a sha256 digest
 *   truncated to 16 hex chars, so a memory dump or log cannot leak credentials.
 * - No scheduler: entries are dropped lazily, matching F-11 "TTL + lazy load".
 */

interface CacheEntry {
  token: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/** Key = type + appId + ':' + sha256(secret).slice(0, 16) (no plaintext secret). */
export function cacheKey(type: string, appId: string, secret: string): string {
  const digest = createHash('sha256').update(secret).digest('hex').slice(0, 16);
  return `${type}${appId}:${digest}`;
}

/** Return a still-valid cached token, or null on miss/expired. */
export function getCachedToken(key: string): string | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.token;
}

/** Store a token with `expiresInSec`, expiring 5 minutes early. */
export function putToken(key: string, token: string, expiresInSec: number): void {
  const ttl = Math.max(60, Math.floor(expiresInSec) - 300);
  cache.set(key, { token, expiresAt: Date.now() + ttl * 1000 });
}

/** Drop a token so the next call refetches (used on invalid-token errcodes). */
export function invalidateToken(key: string): void {
  cache.delete(key);
}

/** Clear the whole cache (test hook). */
export function clearTokenCache(): void {
  cache.clear();
}
