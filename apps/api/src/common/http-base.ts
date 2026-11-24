/**
 * 环境变量层面的对外基址回退：`PUBLIC_BASE_URL` → `http://127.0.0.1:PORT`。
 * 业务代码应优先使用 `OptionsService.publicBase()`（系统设置里的服务器地址优先），
 * 这里只保留环境变量与本地回退，供设置尚未加载或单测使用。
 */
export function serverBase(): string {
  const raw = process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;
  return raw.replace(/\/+$/, '');
}