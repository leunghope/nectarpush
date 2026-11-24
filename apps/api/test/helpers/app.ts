/**
 * Shared e2e harness: boots the full Nest app against a throwaway SQLite db.
 *
 * Contract conformance tests live in *.contract.spec.ts files and exercise the
 * real HTTP surface (envelopes, error codes, auth) against docs/openapi.yaml.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

export interface TestApp {
  app: NestFastifyApplication;
  base: string;
  close: () => Promise<void>;
  cleanup: () => void;
}

let cached: TestApp | null = null;

export async function bootstrap(): Promise<TestApp> {
  if (cached) return cached;

  const dir = mkdtempSync(join(tmpdir(), 'np-e2e-'));
  const dbFile = join(dir, 'test.db');
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.SESSION_SECRET = 'test-session-secret-0123456789abcdef';
  process.env.PORT = '0';
  delete process.env.ENCRYPTION_KEY;

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: process.cwd(),
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: `file:${dbFile}` },
  });

  const { AppModule } = await import('../../src/app.module');
  const { default: fastifyCookie } = await import('@fastify/cookie');
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
  );
  await app.register(fastifyCookie, {});
  await app.init();
  await app.listen(0, '127.0.0.1');
  const url = await app.getUrl();

  cached = {
    app,
    base: url.replace('127.0.0.1', '127.0.0.1'),
    close: async () => {
      await app.close();
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
  return cached;
}

export interface Envelope<T = unknown> {
  success: boolean;
  message: string;
  data: T;
  code?: string;
}

/** Thin fetch wrapper that parses the unified envelope. */
export async function call<T = unknown>(
  base: string,
  path: string,
  init?: RequestInit & { cookie?: string },
): Promise<{ status: number; body: Envelope<T> | null; raw: string; setCookie?: string }> {
  const { cookie, ...rest } = init ?? {};
  const res = await fetch(`${base}${path}`, {
    ...rest,
    headers: {
      ...(rest.body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...(rest.headers ?? {}),
    },
    redirect: 'manual',
  });
  const raw = await res.text();
  let body: Envelope<T> | null = null;
  try {
    body = JSON.parse(raw) as Envelope<T>;
  } catch {
    body = null;
  }
  return { status: res.status, body, raw, setCookie: res.headers.get('set-cookie') ?? undefined };
}

export function cookieOf(setCookie: string | undefined): string {
  if (!setCookie) throw new Error('no set-cookie header');
  return setCookie.split(';')[0];
}

/** Login as the seeded root (default password 123456 until the D-02 flow changes it). */
export async function loginRoot(base: string, password = '123456'): Promise<string> {
  const res = await call(base, '/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'root', password }),
  });
  if (res.status !== 200) throw new Error(`root login failed: ${res.raw}`);
  return cookieOf(res.setCookie);
}
