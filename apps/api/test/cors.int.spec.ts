import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { spawnMainServer, type ServerHandle } from './helpers/server';

/**
 * Stage 12 / A7: CORS used to be hard-coded to `origin: true` with
 * `credentials: true`, so any website could call the API with the user's
 * session cookie. `CORS_ORIGINS` now turns that into an explicit allowlist;
 * leaving it unset keeps the old reflecting behaviour for local development.
 *
 * These tests spawn the real dist/main.js (the in-process harness never runs
 * the main.ts wiring), so `pnpm --filter api build` must run first.
 */

const MAIN_JS = resolve(__dirname, '../dist/main.js');
if (!existsSync(MAIN_JS)) {
  throw new Error(
    `A7 integration tests need ${MAIN_JS}. Run "pnpm --filter api build" before "pnpm --filter api test".`,
  );
}

const handles: ServerHandle[] = [];

afterAll(async () => {
  for (const h of handles) {
    await h.stop();
    h.cleanup();
  }
});

async function getWithOrigin(base: string, origin: string) {
  return fetch(`${base}/api/health`, { headers: { origin } });
}

describe('A7 CORS allowlist', () => {
  it('unset CORS_ORIGINS: reflects the request origin (dev behaviour)', async () => {
    const server = await spawnMainServer({ CORS_ORIGINS: undefined });
    handles.push(server);

    const res = await getWithOrigin(server.base, 'https://evil.example');
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://evil.example');
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it('CORS_ORIGINS: only the listed origins are allowed', async () => {
    // Note the space after the comma: entries must be trimmed.
    const server = await spawnMainServer({
      CORS_ORIGINS: 'https://push.example.com, https://admin.example.com',
    });
    handles.push(server);

    const allowed = await getWithOrigin(server.base, 'https://push.example.com');
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://push.example.com');

    const denied = await getWithOrigin(server.base, 'https://evil.example');
    expect(denied.status).toBe(200);
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('CORS_ORIGINS: preflight from a listed origin is allowed', async () => {
    const server = await spawnMainServer({ CORS_ORIGINS: 'https://push.example.com' });
    handles.push(server);

    const preflight = await fetch(`${server.base}/api/health`, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://push.example.com',
        'access-control-request-method': 'GET',
      },
    });
    expect(preflight.status).toBeLessThan(400);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('https://push.example.com');
    expect(preflight.headers.get('access-control-allow-methods')).toContain('GET');
  });
});