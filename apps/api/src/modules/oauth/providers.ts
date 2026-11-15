/**
 * OAuth2 provider config pure helpers (Stage 9).
 *
 * These functions are shared by `AuthService` (runtime OAuth flow) and
 * `OptionsService` (settings read/write) so parsing/merge/redact semantics can
 * never drift between the two call sites. No Nest/Prisma dependencies here —
 * everything is a pure function and unit-testable in isolation.
 *
 * See docs/DESIGN_OAUTH2_FORM.md §4.1.
 */
import { ApiError } from '../../common/errors';

export interface OAuthProviderConfig {
  id: string;
  display_name?: string;
  /** 是否在登录/绑定入口展示；缺省视为启用。 */
  enabled?: boolean;
  /** 自定义提供方图标（data:image/...;base64,...）。 */
  icon?: string;
  authorize_url: string;
  token_url: string;
  userinfo_url: string;
  client_id: string;
  client_secret?: string;
  scope: string;
  map_username: string;
  map_email?: string;
  /** Issuer/discovery URL used to fill the endpoints (optional, informational). */
  discovery_url?: string;
}

/**
 * GitHub 固定预设：管理员只需填写 client_id/client_secret（以及可选显示名），
 * 其余端点由服务端补齐，见 docs/DESIGN_OAUTH2_FORM.md。
 */
export const GITHUB_PRESET: OAuthProviderConfig = {
  id: 'github',
  display_name: 'GitHub',
  enabled: true,
  authorize_url: 'https://github.com/login/oauth/authorize',
  token_url: 'https://github.com/login/oauth/access_token',
  userinfo_url: 'https://api.github.com/user',
  client_id: '',
  client_secret: '',
  scope: 'read:user user:email',
  map_username: 'login',
  map_email: 'email',
};

export const GITHUB_PROVIDER_ID = 'github';
export const MAX_ICON_LENGTH = 300_000;
export const MAX_PROVIDERS = 20;

const ICON_DATA_URL = /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,[a-z0-9+/=\s]+$/i;

function pick(value: string | undefined, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value : fallback;
}

/**
 * 归一化（保存与读取都走这里）：GitHub 补预设、自定义补默认 scope/映射、
 * 缺省 enabled=true、去掉多余空白。只做结构整理，不做网络请求。
 */
export function normalizeProviders(list: OAuthProviderConfig[]): OAuthProviderConfig[] {
  const githubCount = list.filter((p) => p && p.id === GITHUB_PROVIDER_ID).length;
  if (githubCount > 1) {
    throw new ApiError('VALIDATION_FAILED', '参数校验失败：GitHub 提供方只能添加一次');
  }
  return list.map((p) => {
    const isGithub = p.id === GITHUB_PROVIDER_ID;
    const base: OAuthProviderConfig = isGithub
      ? { ...GITHUB_PRESET, ...p }
      : {
          ...p,
          scope: pick(p.scope, 'openid profile email'),
          map_username: pick(p.map_username, 'preferred_username'),
          map_email: p.map_email ?? '',
        };
    const out: OAuthProviderConfig = {
      ...base,
      id: String(p.id).trim(),
      display_name: pick(p.display_name, isGithub ? 'GitHub' : String(p.id).trim()),
      enabled: p.enabled !== false,
      authorize_url: isGithub ? pick(p.authorize_url, GITHUB_PRESET.authorize_url) : (p.authorize_url ?? '').trim(),
      token_url: isGithub ? pick(p.token_url, GITHUB_PRESET.token_url) : (p.token_url ?? '').trim(),
      userinfo_url: isGithub ? pick(p.userinfo_url, GITHUB_PRESET.userinfo_url) : (p.userinfo_url ?? '').trim(),
      client_id: (p.client_id ?? '').trim(),
      scope: isGithub ? pick(p.scope, GITHUB_PRESET.scope) : pick(p.scope, 'openid profile email'),
      map_username: isGithub ? pick(p.map_username, GITHUB_PRESET.map_username) : pick(p.map_username, 'preferred_username'),
    };
    if (isGithub) out.map_email = pick(p.map_email, GITHUB_PRESET.map_email ?? 'email');
    else out.map_email = p.map_email ?? '';
    out.discovery_url = p.discovery_url === undefined ? '' : p.discovery_url.trim();
    out.icon = p.icon === undefined ? '' : p.icon;
    return out;
  });
}

/** Read-side view: `client_secret` is replaced by a `has_secret` boolean. */
export type RedactedOAuthProviderConfig = Omit<OAuthProviderConfig, 'client_secret'> & {
  has_secret: boolean;
};

/**
 * incoming 中 client_secret 为空/缺省时，按 id 继承 existing 的值。
 * A brand-new provider without a secret simply keeps an empty secret.
 * Providers removed from `incoming` are dropped (their secret goes with them).
 */
export function mergeProviders(
  existing: OAuthProviderConfig[],
  incoming: OAuthProviderConfig[],
): OAuthProviderConfig[] {
  const prev = new Map(existing.map((p) => [p.id, p]));
  return incoming.map((p) => {
    const old = prev.get(p.id);
    const secret =
      p.client_secret && p.client_secret.trim() !== '' ? p.client_secret : old?.client_secret ?? '';
    // `discovery_url: ''` explicitly clears it; an omitted key keeps the old one.
    const discovery = p.discovery_url === undefined ? old?.discovery_url : p.discovery_url;
    const merged: OAuthProviderConfig = { ...p, client_secret: secret };
    if (discovery) merged.discovery_url = discovery;
    else delete merged.discovery_url;
    return merged;
  });
}

/** 接口输出：去掉 client_secret，改为 has_secret 布尔。 */
export function redactProviders(list: OAuthProviderConfig[]): RedactedOAuthProviderConfig[] {
  return list.map(({ client_secret, ...rest }) => ({
    ...rest,
    has_secret: Boolean(client_secret && client_secret.trim()),
  }));
}

/**
 * 宽松解析：非 JSON / 非数组 / 非对象 / 无 id 的项丢弃（与旧 parseProviders 语义一致）。
 * 旧数据兼容：历史 JSON（无 has_secret、含明文 secret）都能被解析。
 */
export function parseProvidersJson(json: string): OAuthProviderConfig[] {
  try {
    const raw = JSON.parse(json || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (p): p is OAuthProviderConfig =>
        typeof p === 'object' && p !== null && typeof (p as OAuthProviderConfig).id === 'string',
    );
  } catch {
    return [];
  }
}

function isHttpUrl(value: unknown): boolean {  if (typeof value !== 'string' || value.trim() === '') return false;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * 结构校验（§4.4）。仅在显式提交 `OAuth2Providers` 时调用。
 * 失败抛 422 VALIDATION_FAILED，**绝不清空已有配置**。
 *
 * 规则：必须是数组；每项 id 为非空字符串且唯一；三个 URL 为合法 http(s)；
 * client_id 非空；map_username 非空。
 */
export function validateProviders(list: OAuthProviderConfig[]): void {
  if (!Array.isArray(list)) {
    throw new ApiError('VALIDATION_FAILED', '参数校验失败：OAuth2 提供方配置无效：必须是数组');
  }
  if (list.length > MAX_PROVIDERS) {
    throw new ApiError('VALIDATION_FAILED', `参数校验失败：OAuth2 提供方最多 ${MAX_PROVIDERS} 个`);
  }
  const seen = new Set<string>();
  for (let i = 0; i < list.length; i++) {
    const p = list[i] as Partial<OAuthProviderConfig> | null;
    const where = `第 ${i + 1} 项`;
    if (typeof p !== 'object' || p === null) {
      throw new ApiError('VALIDATION_FAILED', `参数校验失败：OAuth2 提供方配置无效：${where} 不是对象`);
    }
    if (typeof p.id !== 'string' || p.id.trim() === '') {
      throw new ApiError('VALIDATION_FAILED', `参数校验失败：OAuth2 提供方配置无效：${where} 缺少 id`);
    }
    if (p.id.length > 32) {
      throw new ApiError('VALIDATION_FAILED', `参数校验失败：OAuth2 提供方配置无效：${p.id} 的 id 过长（最多 32 字符）`);
    }
    if (seen.has(p.id)) {
      throw new ApiError('VALIDATION_FAILED', `参数校验失败：OAuth2 提供方配置无效：id 重复（${p.id}）`);
    }
    seen.add(p.id);
    if (p.display_name !== undefined && (typeof p.display_name !== 'string' || p.display_name.length > 64)) {
      throw new ApiError('VALIDATION_FAILED', `参数校验失败：OAuth2 提供方配置无效：${p.id} 的显示名称无效`);
    }
    if (p.enabled !== undefined && typeof p.enabled !== 'boolean') {
      throw new ApiError('VALIDATION_FAILED', `参数校验失败：OAuth2 提供方配置无效：${p.id} 的 enabled 必须是布尔值`);
    }
    if (p.icon !== undefined && p.icon !== '') {
      if (typeof p.icon !== 'string' || p.icon.length > MAX_ICON_LENGTH || !ICON_DATA_URL.test(p.icon)) {
        throw new ApiError(
          'VALIDATION_FAILED',
          `参数校验失败：OAuth2 提供方配置无效：${p.id} 的图标必须是 300KB 以内的 PNG/JPEG/GIF/WebP/SVG 图片`,
        );
      }
    }
    if (typeof p.client_id !== 'string' || p.client_id.trim() === '') {
      throw new ApiError(
        'VALIDATION_FAILED',
        `参数校验失败：OAuth2 提供方配置无效：${p.id} 的 client_id 不能为空`,
      );
    }
    const isGithub = p.id === GITHUB_PROVIDER_ID;
    const hasDiscovery = typeof p.discovery_url === 'string' && p.discovery_url.trim() !== '';
    if (hasDiscovery && !isHttpUrl(p.discovery_url)) {
      throw new ApiError(
        'VALIDATION_FAILED',
        `参数校验失败：OAuth2 提供方配置无效：${p.id} 的 discovery_url 不是合法 URL`,
      );
    }
    // GitHub 的端点由预设补齐；自定义提供方在配置了发现端点时可稍后自动填充。
    if (!isGithub) {
      if (p.authorize_url && !isHttpUrl(p.authorize_url)) {
        throw new ApiError('VALIDATION_FAILED', `参数校验失败：OAuth2 提供方配置无效：${p.id} 的 authorize_url 不是合法 URL`);
      }
      if (p.token_url && !isHttpUrl(p.token_url)) {
        throw new ApiError('VALIDATION_FAILED', `参数校验失败：OAuth2 提供方配置无效：${p.id} 的 token_url 不是合法 URL`);
      }
      if (p.userinfo_url && !isHttpUrl(p.userinfo_url)) {
        throw new ApiError('VALIDATION_FAILED', `参数校验失败：OAuth2 提供方配置无效：${p.id} 的 userinfo_url 不是合法 URL`);
      }
      const urlsFilled = isHttpUrl(p.authorize_url) && isHttpUrl(p.token_url) && isHttpUrl(p.userinfo_url);
      if (!urlsFilled && !hasDiscovery) {
        throw new ApiError(
          'VALIDATION_FAILED',
          `参数校验失败：OAuth2 提供方配置无效：${p.id} 需要填写发现端点或三个端点地址`,
        );
      }
    }
    if (typeof p.map_username !== 'string' || p.map_username.trim() === '') {
      throw new ApiError(
        'VALIDATION_FAILED',
        `参数校验失败：OAuth2 提供方配置无效：${p.id} 的 map_username 不能为空`,
      );
    }
  }
}

/** The token endpoint request type for standard OIDC (design §4.3, option A). */
export const TOKEN_REQUEST_CONTENT_TYPE = 'application/x-www-form-urlencoded';

/** Build the form-encoded token request body (pure; unit-testable). */
export function buildTokenRequestBody(
  provider: OAuthProviderConfig,
  code: string,
  redirectUri?: string,
): string {
  const params: Record<string, string> = {
    client_id: provider.client_id,
    client_secret: provider.client_secret ?? '',
    code,
    grant_type: 'authorization_code',
  };
  // RFC 6749 §4.1.3: redirect_uri MUST be repeated in the token request when it
  // was present in the authorization request. Strict OIDC servers (authentik)
  // reject the exchange with invalid_grant otherwise, which surfaced as an
  // opaque "第三方授权失败" during Stage 10 real-credential verification.
  if (redirectUri) params.redirect_uri = redirectUri;
  return new URLSearchParams(params).toString();
}

export interface TokenResponse {
  access_token?: string;
  [key: string]: unknown;
}

/**
 * Parse a token endpoint response body robustly (design §4.3 响应兼容):
 * try JSON first, then fall back to application/x-www-form-urlencoded text
 * (GitHub returns a query-string body when JSON is not negotiated).
 */
export function parseTokenResponse(text: string): TokenResponse {
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as TokenResponse;
    }
  } catch {
    // not JSON — fall through to form parsing
  }
  try {
    const params = new URLSearchParams(text);
    const obj: Record<string, unknown> = {};
    for (const [k, v] of params) obj[k] = v;
    return obj as TokenResponse;
  } catch {
    return {};
  }
}
