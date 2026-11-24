/**
 * 实例版本读取（单一来源）。
 *
 * 优先级：APP_VERSION（Docker/CI 注入）→ npm_package_version（本地 pnpm 启动）→ 0.2.0。
 * 去掉前缀 v，便于和 GitHub tag 直接比较。
 */
export function currentVersion(): string {
  const raw = process.env.APP_VERSION || process.env.npm_package_version || '0.2.0';
  return raw.trim().replace(/^v/i, '') || '0.2.0';
}

export function currentCommit(): string | null {
  return process.env.GIT_COMMIT || null;
}
