import type { MessageStatus, UserRole, UserStatus } from '@nectarpush/shared';

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO 8601 (UTC) → local `YYYY-MM-DD HH:mm` in Asia/Shanghai-independent local tz. */
export function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatLatency(ms?: number | null): string {
  if (ms === null || ms === undefined) return '—';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`;
}

export const MESSAGE_STATUS_LABEL: Record<MessageStatus, string> = {
  pending: '待发送',
  async_pending: '异步等待',
  success: '全部成功',
  partial: '部分成功',
  failed: '发送失败',
};

/** Relative time for the workbench recent list ("刚刚" / "N 分钟前"). */
export function formatRelative(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return formatDate(iso);
}

/** Badge tone class for a message status. */
export const MESSAGE_STATUS_TONE: Record<MessageStatus, string> = {
  pending: 'badge-neutral',
  async_pending: 'badge-info',
  success: 'badge-success',
  partial: 'badge-warning',
  failed: 'badge-danger',
};

export const USER_ROLE_LABEL: Record<UserRole, string> = {
  user: '普通用户',
  admin: '管理员',
  root: '超级管理员',
};

export const USER_STATUS_LABEL: Record<UserStatus, string> = {
  active: '启用',
  disabled: '已停用',
};

export const ROLE_RANK: Record<UserRole, number> = { user: 1, admin: 2, root: 3 };

export const RENDER_MODE_LABEL: Record<string, string> = {
  markdown: 'Markdown',
  code: '代码',
  raw: '纯文本',
};

/** Single-character avatar initial: first grapheme of the display name, uppercased. */
export function avatarInitial(name?: string | null): string {
  const value = name?.trim();
  if (!value) return '?';
  const [first] = Array.from(value);
  return first ? first.toLocaleUpperCase() : '?';
}
