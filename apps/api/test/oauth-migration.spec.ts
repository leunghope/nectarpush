import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * D-03 迁移回填回归：对真实迁移 SQL 灌入旧单绑数据，验证
 * 20261113035000_oauth_bindings 的回填/去重/软删跳过/删列/唯一约束。
 * 测试 bootstrap 走 `prisma migrate deploy`（空库），无法覆盖回填，故此处
 * 用 sqlite3 直接对「旧 schema + 旧数据」应用新迁移做断言。
 */
const MIGRATIONS = join(process.cwd(), 'prisma', 'migrations');
const INIT_SQL = readFileSync(join(MIGRATIONS, '20261108152739_init', 'migration.sql'), 'utf8');
const OAUTH_SQL = readFileSync(
  join(MIGRATIONS, '20261113035000_oauth_bindings', 'migration.sql'),
  'utf8',
);

function run(db: string, sql: string): void {
  execFileSync('sqlite3', ['-bail', db], { input: sql, encoding: 'utf8' });
}
function query(db: string, sql: string): any[] {
  const out = execFileSync('sqlite3', ['-json', db, sql], { encoding: 'utf8' }).trim();
  return out ? JSON.parse(out) : [];
}

describe('D-03 oauth_bindings migration backfill', () => {
  let dir = '';
  let db = '';

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'np-mig-'));
    db = join(dir, 'legacy.db');
    // 1) 旧 schema（含 User.oauthProvider/oauthId 单绑字段）。
    run(db, INIT_SQL);
    // 2) 旧单绑数据：正常 / 重复身份 / 另一 provider / 软删 / 无身份。
    run(
      db,
      `
      INSERT INTO User (username, displayName, oauthProvider, oauthId) VALUES ('legacy_a','A','github','gh-1');
      INSERT INTO User (username, displayName, oauthProvider, oauthId) VALUES ('legacy_b','B','github','gh-1');
      INSERT INTO User (username, displayName, oauthProvider, oauthId) VALUES ('legacy_c','C','authentik','ak-9');
      INSERT INTO User (username, displayName, oauthProvider, oauthId, deletedAt) VALUES ('legacy_del','D','github','gh-del','2026-01-01 00:00:00');
      INSERT INTO User (username, displayName) VALUES ('legacy_null','N');
      `,
    );
    // 3) 应用新迁移：建表 + 回填 + 重建 User 删旧列。
    run(db, OAUTH_SQL);
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('backfills active single-bind identities into OAuthBinding', () => {
    const rows = query(db, 'SELECT userId, provider, oauthId FROM OAuthBinding ORDER BY id');
    // legacy_a(id=1) github/gh-1 与 legacy_c(id=3) authentik/ak-9。
    expect(rows).toEqual([
      { userId: 1, provider: 'github', oauthId: 'gh-1' },
      { userId: 3, provider: 'authentik', oauthId: 'ak-9' },
    ]);
  });

  it('keeps the earliest active user for a duplicated identity and skips soft-deleted rows', () => {
    const gh = query(db, "SELECT userId FROM OAuthBinding WHERE provider='github' AND oauthId='gh-1'");
    expect(gh).toEqual([{ userId: 1 }]); // legacy_a 而非 legacy_b(id=2)
    expect(query(db, "SELECT * FROM OAuthBinding WHERE oauthId='gh-del'")).toEqual([]);
    expect(query(db, 'SELECT COUNT(*) AS n FROM OAuthBinding')).toEqual([{ n: 2 }]);
  });

  it('drops the legacy User columns and enforces (provider, oauthId) uniqueness', () => {
    const cols = query(db, 'PRAGMA table_info(User)').map((c: any) => c.name);
    expect(cols).not.toContain('oauthProvider');
    expect(cols).not.toContain('oauthId');
    const uniqueIdx = query(db, 'PRAGMA index_list(OAuthBinding)').filter((i: any) => i.unique === 1);
    expect(uniqueIdx.length).toBeGreaterThanOrEqual(1);
    // 重复 (provider, oauthId) 必须撞唯一约束。
    expect(() =>
      run(db, "INSERT INTO OAuthBinding (userId, provider, oauthId) VALUES (2,'github','gh-1')"),
    ).toThrow();
  });
});
