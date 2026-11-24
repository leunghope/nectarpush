/**
 * Spawns the compiled `apps/api/dist/main.js` on a throwaway SQLite database.
 *
 * Needed for behaviour that only exists in main.ts (rate limiting, trustProxy,
 * SPA fallback): the in-process harness imports AppModule directly and never
 * runs that wiring. Requires `pnpm --filter api build` first.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export interface ServerHandle {
  base: string;
  dbFile: string;
  stop: () => Promise<void>;
  cleanup: () => void;
}

const API_DIR = resolve(__dirname, '../..');
const MAIN_JS = join(API_DIR, 'dist', 'main.js');

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      srv.close(() => resolvePort(port));
    });
  });
}

async function waitForHealth(base: string, timeoutMs = 40_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server at ${base} did not become healthy within ${timeoutMs}ms`);
}

export async function spawnMainServer(extraEnv: NodeJS.ProcessEnv = {}): Promise<ServerHandle> {
  const dir = mkdtempSync(join(tmpdir(), 'np-int-'));
  const dbFile = join(dir, 'it.db');
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: API_DIR,
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: `file:${dbFile}` },
  });

  const port = await freePort();
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    DATABASE_URL: `file:${dbFile}`,
    SESSION_SECRET: 'int-session-secret-0123456789abcdef',
    PORT: String(port),
    NODE_ENV: 'production',
  };
  for (const [key, value] of Object.entries(extraEnv)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  const child: ChildProcess = spawn(process.execPath, [MAIN_JS], {
    cwd: API_DIR,
    stdio: 'ignore',
    env,
  });
  child.unref();

  const base = `http://127.0.0.1:${port}`;
  try {
    await waitForHealth(base);
  } catch (e) {
    child.kill('SIGKILL');
    throw e;
  }

  return {
    base,
    dbFile,
    stop: async () => {
      child.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 300));
      child.kill('SIGKILL');
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}