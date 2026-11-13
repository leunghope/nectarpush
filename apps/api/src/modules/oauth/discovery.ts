/**
 * OIDC discovery helper (Stage 9 extension).
 *
 * Admins paste an issuer / discovery URL and the form fills the three
 * endpoints, scope and claim mappings from the published
 * `.well-known/openid-configuration` document. No state is kept here — the
 * result is only a suggestion the admin can still edit by hand.
 */
import { ApiError } from '../../common/errors';

export interface DiscoveryResult {
  issuer: string | null;
  authorize_url: string;
  token_url: string;
  userinfo_url: string;
  scope: string;
  map_username: string;
  map_email: string;
  scopes_supported: string[];
  warnings: string[];
}

const WELL_KNOWN = '/.well-known/openid-configuration';
const MAX_DOC_BYTES = 512 * 1024;
const TIMEOUT_MS = 8_000;

/** Normalize the admin input into a discovery document URL. */
export function normalizeDiscoveryUrl(input: string): string {
  let raw = (input ?? '').trim();
  if (!raw) throw new ApiError('VALIDATION_FAILED', '请输入发现端点地址');
  const scheme = raw.match(/^([a-z][a-z0-9+.-]*):\/\//i);
  if (scheme) {
    if (!/^https?$/i.test(scheme[1])) {
      throw new ApiError('VALIDATION_FAILED', '发现端点仅支持 http/https');
    }
  } else {
    raw = `https://${raw}`;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ApiError('VALIDATION_FAILED', '发现端点地址格式不正确');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ApiError('VALIDATION_FAILED', '发现端点仅支持 http/https');
  }
  if (!url.pathname.includes(WELL_KNOWN)) {
    url.pathname = `${url.pathname.replace(/\/+$/, '')}${WELL_KNOWN}`;
    url.search = '';
    url.hash = '';
  }
  return url.toString();
}

function asHttpUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : '';
  } catch {
    return '';
  }
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function suggestScope(scopes: string[]): string {
  const wanted = ['openid', 'profile', 'email'].filter((s) => scopes.includes(s));
  if (wanted.length) return wanted.join(' ');
  return scopes.slice(0, 3).join(' ') || 'openid profile email';
}

export async function discoverOidc(
  input: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DiscoveryResult> {
  const url = normalizeDiscoveryUrl(input);
  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ApiError('OAUTH_DISCOVERY_FAILED', `无法访问发现端点：${url}`);
  }
  if (!res.ok) {
    throw new ApiError('OAUTH_DISCOVERY_FAILED', `发现端点返回 HTTP ${res.status}`);
  }
  const text = await res.text().catch(() => '');
  if (text.length > MAX_DOC_BYTES) {
    throw new ApiError('OAUTH_DISCOVERY_FAILED', '发现文档过大，已停止解析');
  }
  let doc: Record<string, unknown>;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object');
    doc = parsed as Record<string, unknown>;
  } catch {
    throw new ApiError('OAUTH_DISCOVERY_FAILED', '发现端点返回的不是合法的 JSON 对象');
  }

  const authorize = asHttpUrl(doc.authorization_endpoint);
  const token = asHttpUrl(doc.token_endpoint);
  if (!authorize) {
    throw new ApiError('OAUTH_DISCOVERY_FAILED', '发现文档缺少 authorization_endpoint');
  }
  if (!token) {
    throw new ApiError('OAUTH_DISCOVERY_FAILED', '发现文档缺少 token_endpoint');
  }
  const userinfo = asHttpUrl(doc.userinfo_endpoint);
  const scopesSupported = Array.isArray(doc.scopes_supported)
    ? doc.scopes_supported.filter((s): s is string => typeof s === 'string')
    : [];
  const warnings: string[] = [];
  if (!userinfo) warnings.push('发现文档未提供 userinfo_endpoint，请手动填写用户信息端点');

  return {
    issuer: asString(doc.issuer),
    authorize_url: authorize,
    token_url: token,
    userinfo_url: userinfo,
    scope: scopesSupported.length ? suggestScope(scopesSupported) : 'openid profile email',
    map_username: 'sub',
    map_email: 'email',
    scopes_supported: scopesSupported,
    warnings,
  };
}