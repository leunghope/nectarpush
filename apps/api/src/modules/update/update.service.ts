import { Injectable } from '@nestjs/common';
import { ApiError } from '../../common/errors';
import { currentVersion } from '../../common/app-version';

export interface UpdateCheckResult {
  current_version: string;
  latest_version: string;
  update_available: boolean;
  release_url: string | null;
  release_name: string | null;
  published_at: string | null;
  checked_at: string;
}

const REPO = 'leunghope/nectarpush';
const RELEASES_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const TAGS_URL = `https://api.github.com/repos/${REPO}/tags`;
const CACHE_TTL_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 8_000;

function upstreamUrl(): string {
  return process.env.UPDATE_CHECK_URL?.trim() || RELEASES_URL;
}

function tagsUrl(): string {
  const custom = process.env.UPDATE_CHECK_URL?.trim();
  // 自定义地址只按用户给的那个查询，不猜测其 tags 端点。
  return custom ? custom : TAGS_URL;
}

/** 去掉 v 前缀与预发布后缀，转成数字段（仅用于大小比较）。 */
export function versionParts(raw: string): number[] {
  const base = (raw || '').trim().replace(/^v/i, '').split(/[-+]/)[0];
  const parts = base.split('.').map((p) => Number.parseInt(p, 10));
  while (parts.length && Number.isNaN(parts[parts.length - 1])) parts.pop();
  return parts.every((n) => Number.isFinite(n)) ? parts : [];
}

export function isNewerVersion(latest: string, current: string): boolean {
  const a = versionParts(latest);
  const b = versionParts(current);
  if (!a.length || !b.length) return false;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

@Injectable()
export class UpdateService {
  private cache: { at: number; data: UpdateCheckResult } | null = null;

  async check(force = false): Promise<UpdateCheckResult> {
    if (!force && this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) {
      return this.cache.data;
    }
    const data = await this.fetchLatest();
    this.cache = { at: Date.now(), data };
    return data;
  }

  private async fetchLatest(): Promise<UpdateCheckResult> {
    const current = currentVersion();
    const checked_at = new Date().toISOString();
    let latest: {
      tag: string;
      name: string | null;
      url: string | null;
      published_at: string | null;
    } | null = null;

    const primary = await this.getJson(upstreamUrl());
    latest = this.parseRelease(primary.data, primary.url);
    if (!latest && primary.notFound && !process.env.UPDATE_CHECK_URL) {
      const fallback = await this.getJson(tagsUrl());
      latest = this.parseTag(fallback.data);
    }

    if (!latest) {
      throw new ApiError('UPDATE_CHECK_FAILED', '无法获取最新版本信息，请稍后重试');
    }
    const latest_version = latest.tag.trim().replace(/^v/i, '');
    return {
      current_version: current,
      latest_version,
      update_available: isNewerVersion(latest_version, current),
      release_url: latest.url,
      release_name: latest.name || latest.tag,
      published_at: latest.published_at,
      checked_at,
    };
  }

  private async getJson(url: string): Promise<{ data: unknown; url: string; notFound: boolean }> {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': `NectarPush/${currentVersion()}`,
          ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new ApiError('UPDATE_CHECK_FAILED', '无法连接更新服务器，请检查网络后重试');
    }
    if (!res.ok) {
      if (res.status === 404) return { data: null, url, notFound: true };
      throw new ApiError(
        'UPDATE_CHECK_FAILED',
        `更新服务器返回 ${res.status}，请稍后重试（可通过 UPDATE_CHECK_URL 覆盖地址）`,
      );
    }
    const data = (await res.json().catch(() => null)) as unknown;
    return { data, url, notFound: false };
  }

  private parseRelease(
    data: unknown,
    fallbackUrl: string,
  ): { tag: string; name: string | null; url: string | null; published_at: string | null } | null {
    if (!data) return null;
    // GitHub releases/latest 是对象；自定义地址也可能直接返回 { tag_name }。
    if (Array.isArray(data)) return this.parseTag(data);
    if (typeof data !== 'object') return null;
    const obj = data as Record<string, unknown>;
    const tag = typeof obj.tag_name === 'string' ? obj.tag_name : typeof obj.version === 'string' ? obj.version : '';
    if (!tag) return null;
    return {
      tag,
      name: typeof obj.name === 'string' ? obj.name : null,
      url: typeof obj.html_url === 'string' ? obj.html_url : typeof obj.url === 'string' ? obj.url : fallbackUrl,
      published_at: typeof obj.published_at === 'string' ? obj.published_at : null,
    };
  }

  private parseTag(
    data: unknown,
  ): { tag: string; name: string | null; url: string | null; published_at: string | null } | null {
    const first = Array.isArray(data) ? data[0] : data;
    if (!first || typeof first !== 'object') return null;
    const obj = first as Record<string, unknown>;
    const tag =
      typeof obj.name === 'string'
        ? obj.name
        : typeof obj.tag_name === 'string'
          ? obj.tag_name
          : typeof obj.version === 'string'
            ? obj.version
            : '';
    if (!tag) return null;
    return {
      tag,
      name: null,
      url: `https://github.com/${REPO}/releases/tag/${encodeURIComponent(tag)}`,
      published_at: null,
    };
  }
}
