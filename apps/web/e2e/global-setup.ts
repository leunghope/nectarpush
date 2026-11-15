import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const API_DIR = resolve(HERE, '../../api');
const WEB_DIST = resolve(HERE, '../dist');
const PORT = 3100;
const BASE = `http://127.0.0.1:${PORT}`;

async function waitForHealth(timeoutMs = 40_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error('API did not become healthy on ' + BASE);
}

async function assertPortFree(): Promise<void> {
  try {
    const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(700) });
    if (res.ok) {
      throw new Error(
        `port ${PORT} already serves a NectarPush instance — stop it before running E2E ` +
          `(stale servers would reuse an old database and leak test data)`,
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('already serves')) throw err;
    /* connection refused / timeout: port is free */
  }
}

/**
 * Boots the real API against a temporary SQLite database. The SeedService creates
 * root/123456 (must_change_password) on first boot — exactly the state J1 expects.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  if (!existsSync(join(WEB_DIST, 'index.html'))) {
    throw new Error('apps/web/dist is missing — run `pnpm --filter web build` first');
  }
  if (!existsSync(join(API_DIR, 'dist/main.js'))) {
    throw new Error('apps/api/dist is missing — run `pnpm --filter api build` first');
  }
  await assertPortFree();

  const dir = mkdtempSync(join(tmpdir(), 'np-web-e2e-'));
  const dbFile = join(dir, 'e2e.db');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: `file:${dbFile}`,
    PORT: String(PORT),
    SERVER_ADDRESS: BASE,
    SESSION_SECRET: 'e2e-session-secret-0123456789abcdef',
    NODE_ENV: 'production',
    // E2E 模拟"部署在可信反向代理之后"的生产形态：各 spec 用 X-Forwarded-For
    // 隔离限流桶（Q-09）。默认 TRUST_PROXY=false 时伪造 XFF 不换桶的行为由
    // apps/api/test/proxy.int.spec.ts 的真实 main.js 集成测试覆盖。
    TRUST_PROXY: 'true',
    // 整个套件共用一个 API 进程，默认 300/min 桶会被页面加载与 API 调用打满；
    // 仅放宽 default 桶，critical（登录/注册/验证码）与 push 阈值保持生产值。
    RATE_LIMIT_DEFAULT_MAX: '5000',
  };

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], { cwd: API_DIR, env, stdio: 'pipe' });

  const child = spawn(process.execPath, [join(API_DIR, 'dist/main.js')], {
    cwd: API_DIR,
    env,
    stdio: 'ignore',
  });
  child.unref();

  try {
    await waitForHealth();
  } catch (err) {
    child.kill('SIGTERM');
    throw err;
  }

  return async () => {
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      const force = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 3_000);
      child.once('exit', () => {
        clearTimeout(force);
        resolve();
      });
      child.kill('SIGTERM');
    });
    rmSync(dir, { recursive: true, force: true });
  };
}
