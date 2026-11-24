/**
 * OAuth2 提供方草稿模型。
 *
 * 设置页只暴露最少的必填项：GitHub 三条（显示名称 / Client ID / Client Secret），
 * 自定义提供方四条（+ 发现端点）加一个图标。端点、scope、字段映射由后端在保存时
 * 从发现端点补全，因此前端不需要再展示这些技术字段；已有的手工端点会原样写回。
 */

export const GITHUB_PROVIDER_ID = 'github';
export const MAX_PROVIDER_COUNT = 20;
/** 与后端 MAX_ICON_LENGTH 一致：data URL 的字符数上限。 */
export const MAX_ICON_LENGTH = 300_000;
const MAX_ICON_FILE_BYTES = 220 * 1024;

export interface ProviderDraft {
  id: string;
  display_name: string;
  enabled: boolean;
  icon: string;
  client_id: string;
  client_secret: string;
  has_secret: boolean;
  discovery_url: string;
  authorize_url: string;
  token_url: string;
  userinfo_url: string;
  scope: string;
  map_username: string;
  map_email: string;
}

export type ProviderKind = 'github' | 'custom';

export interface ProviderIssue {
  index: number;
  field: string;
  message: string;
}

export const GITHUB_PRESET = {
  id: GITHUB_PROVIDER_ID,
  display_name: 'GitHub',
  authorize_url: 'https://github.com/login/oauth/authorize',
  token_url: 'https://github.com/login/oauth/access_token',
  userinfo_url: 'https://api.github.com/user',
  scope: 'read:user user:email',
  map_username: 'login',
  map_email: 'email',
} as const;

function randomId(): string {
  return `custom-${Math.random().toString(36).slice(2, 10)}`;
}

export function emptyProviderDraft(): ProviderDraft {
  return {
    id: randomId(),
    display_name: '',
    enabled: true,
    icon: '',
    client_id: '',
    client_secret: '',
    has_secret: false,
    discovery_url: '',
    authorize_url: '',
    token_url: '',
    userinfo_url: '',
    scope: 'openid profile email',
    map_username: 'preferred_username',
    map_email: '',
  };
}

export function githubProviderDraft(): ProviderDraft {
  return {
    ...emptyProviderDraft(),
    ...GITHUB_PRESET,
    enabled: true,
    icon: '',
    client_id: '',
    client_secret: '',
    has_secret: false,
    discovery_url: '',
  };
}

/** 宽松解析：容忍旧 JSON（缺 enabled/icon，或带明文 client_secret）。 */
export function parseProviderDrafts(json: string | undefined): ProviderDraft[] {
  if (!json) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: ProviderDraft[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const x = item as Record<string, unknown>;
    if (typeof x.id !== 'string' || !x.id.trim()) continue;
    const base = x.id === GITHUB_PROVIDER_ID ? githubProviderDraft() : emptyProviderDraft();
    out.push({
      ...base,
      id: x.id.trim(),
      display_name: typeof x.display_name === 'string' ? x.display_name : base.display_name,
      enabled: x.enabled === undefined ? true : x.enabled !== false,
      icon: typeof x.icon === 'string' ? x.icon : '',
      client_id: typeof x.client_id === 'string' ? x.client_id : '',
      client_secret: typeof x.client_secret === 'string' ? x.client_secret : '',
      has_secret: x.has_secret === true || Boolean(x.client_secret),
      discovery_url: typeof x.discovery_url === 'string' ? x.discovery_url : '',
      authorize_url: typeof x.authorize_url === 'string' ? x.authorize_url : base.authorize_url,
      token_url: typeof x.token_url === 'string' ? x.token_url : base.token_url,
      userinfo_url: typeof x.userinfo_url === 'string' ? x.userinfo_url : base.userinfo_url,
      scope: typeof x.scope === 'string' ? x.scope : base.scope,
      map_username: typeof x.map_username === 'string' ? x.map_username : base.map_username,
      map_email: typeof x.map_email === 'string' ? x.map_email : base.map_email,
    });
  }
  return out;
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** 序列化回 OAuth2Providers 字符串；空 secret 不带，交给后端按 id 继承旧值。 */
export function serializeProviderDrafts(drafts: ProviderDraft[]): string {
  return JSON.stringify(
    drafts.map((p) => {
      const out: Record<string, unknown> = {
        id: p.id,
        display_name: p.display_name,
        enabled: p.enabled,
        client_id: p.client_id,
        discovery_url: p.discovery_url,
        authorize_url: p.authorize_url,
        token_url: p.token_url,
        userinfo_url: p.userinfo_url,
        scope: p.scope,
        map_username: p.map_username,
        map_email: p.map_email,
      };
      if (p.icon) out.icon = p.icon;
      if (p.client_secret) out.client_secret = p.client_secret;
      return out;
    }),
  );
}

/** 只校验前端可知的必填项；端点完整性/发现流程由后端兜底。 */
export function validateProviderDrafts(drafts: ProviderDraft[]): ProviderIssue[] {
  const issues: ProviderIssue[] = [];
  if (drafts.length > MAX_PROVIDER_COUNT) {
    issues.push({ index: 0, field: 'providers', message: `最多只能配置 ${MAX_PROVIDER_COUNT} 个提供方` });
  }
  const seen = new Set<string>();
  drafts.forEach((p, index) => {
    if (seen.has(p.id)) {
      issues.push({ index, field: 'id', message: `提供方标识 ${p.id} 重复` });
    }
    seen.add(p.id);

    const isGithub = p.id === GITHUB_PROVIDER_ID;
    if (isGithub && drafts.filter((d) => d.id === GITHUB_PROVIDER_ID).length > 1) {
      issues.push({ index, field: 'id', message: 'GitHub 登录只能添加一次' });
    }
    if (!p.display_name.trim()) {
      issues.push({ index, field: 'display_name', message: '请填写显示名称' });
    }
    if (!p.client_id.trim()) {
      issues.push({ index, field: 'client_id', message: '请填写 Client ID' });
    }
    if (!p.has_secret && !p.client_secret.trim()) {
      issues.push({ index, field: 'client_secret', message: '请填写 Client Secret' });
    }
    if (!isGithub) {
      const legacyEndpoints = isHttpUrl(p.authorize_url) && isHttpUrl(p.token_url) && isHttpUrl(p.userinfo_url);
      if (!p.discovery_url.trim() && !legacyEndpoints) {
        issues.push({ index, field: 'discovery_url', message: '请填写发现端点（OIDC）' });
      } else if (p.discovery_url.trim() && !isHttpUrl(p.discovery_url.trim())) {
        issues.push({ index, field: 'discovery_url', message: '发现端点必须是 http(s) URL' });
      }
    }
    if (p.icon && (p.icon.length > MAX_ICON_LENGTH || !/^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(p.icon))) {
      issues.push({ index, field: 'icon', message: '图标格式不受支持或文件过大' });
    }
  });
  return issues;
}

/** 读取用户选择的图片为 data URL，供上传预览与保存。 */
export function readIconFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_ICON_FILE_BYTES) {
      reject(new Error('图标不能超过 220 KB'));
      return;
    }
    if (!/^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(file.type)) {
      reject(new Error('图标只支持 PNG / JPEG / GIF / WebP / SVG'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取图标失败'));
    reader.readAsDataURL(file);
  });
}
