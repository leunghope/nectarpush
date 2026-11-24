import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { spawnMainServer, type ServerHandle } from './helpers/server';

/**
 * Q-09 (Stage 8): the rate limiter used to key on the first X-Forwarded-For hop
 * unconditionally, so any caller could rotate buckets with a forged header.
 * These tests exercise the real main.ts wiring (spawned dist/main.js), which the
 * in-process AppModule harness does not cover.
 */

const MAIN_JS = resolve(__dirname, '../dist/main.js');
if (!existsSync(MAIN_JS)) {
  throw new Error(
    `Q-09 integration tests need ${MAIN_JS}. Run "pnpm --filter api build" before "pnpm --filter api test".`,
  );
}

const LIMIT = 20; // common/rate-limit.ts CRITICAL_LIMIT for /api/auth/*
const handles: ServerHandle[] = [];

afterAll(async () => {
  for (const h of handles) {
    await h.stop();
    h.cleanup();
  }
});

async function loginAttempt(base: string, xff: string) {
  return fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': xff },
    body: JSON.stringify({ username: 'nobody', password: 'wrong-password' }),
  });
}

describe('Q-09 forged X-Forwarded-For cannot bypass the rate limit', () => {
  it('default (TRUST_PROXY unset): forged XFF still shares one bucket', async () => {
    const server = await spawnMainServer({ TRUST_PROXY: undefined });
    handles.push(server);

    const statuses: number[] = [];
    for (let i = 1; i <= LIMIT + 1; i += 1) {
      // Different spoofed client per request — the Stage 7 bypass.
      const res = await loginAttempt(server.base, `10.99.0.${i}`);
      statuses.push(res.status);
      if (i === LIMIT + 1) {
        expect(res.headers.get('retry-after')).toBeTruthy();
        expect(await res.json()).toMatchObject({ success: false, code: 'RATE_LIMITED' });
      }
    }
    expect(statuses.slice(0, LIMIT).every((s) => s === 401)).toBe(true);
    expect(statuses[LIMIT]).toBe(429);
  });

  it('TRUST_PROXY=true: XFF is honoured and still limits per forwarded client', async () => {
    const server = await spawnMainServer({ TRUST_PROXY: 'true' });
    handles.push(server);

    // Distinct real clients behind the proxy → distinct buckets, no 429.
    for (let i = 1; i <= LIMIT + 1; i += 1) {
      const res = await loginAttempt(server.base, `10.77.0.${i}`);
      expect(res.status).toBe(401);
    }

    // Same forwarded client → the shared bucket still trips.
    const statuses: number[] = [];
    for (let i = 1; i <= LIMIT + 1; i += 1) {
      const res = await loginAttempt(server.base, '10.77.9.9');
      statuses.push(res.status);
    }
    expect(statuses.slice(0, LIMIT).every((s) => s === 401)).toBe(true);
    expect(statuses[LIMIT]).toBe(429);
  });
});