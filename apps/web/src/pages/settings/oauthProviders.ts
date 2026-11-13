// Stage 9 (design §5): pure helpers that turn the OAuth2 provider form model
// into the JSON string stored in the `OAuth2Providers` option, and back.
// Keeping this pure makes the serialization rules unit-testable without a DOM.

export interface ProviderDraft {
  id: string;
  display_name: string;
  authorize_url: string;
  token_url: string;
  userinfo_url: string;
  client_id: string;
  client_secret: string; // '' = keep the stored secret (backend merges by id)
  scope: string;
  map_username: string;
  map_email: string;
  discovery_url: string; // informational: the issuer/discovery URL that filled the endpoints
  has_secret: boolean; // server-provided hint only; never serialized back
}

export interface ProviderIssue {
  index: number;
  field: string;
  message: string;
}

/** GitHub OAuth2 preset endpoint values (design §5.2). */
export const GITHUB_PRESET = {
  id: 'github',
  display_name: 'GitHub',
  authorize_url: 'https://github.com/login/oauth/authorize',
  token_url: 'https://github.com/login/oauth/access_token',
  userinfo_url: 'https://api.github.com/user',
  scope: 'read:user user:email',
  map_username: 'login',
  map_email: 'email',
} as const;

export function emptyProviderDraft(): ProviderDraft {
  return {
    id: '',
    display_name: '',
    authorize_url: '',
    token_url: '',
    userinfo_url: '',
    client_id: '',
    client_secret: '',
    scope: '',
    map_username: '',
    map_email: '',
    discovery_url: '',
    has_secret: false,
  };
}

/** A blank draft pre-filled with the GitHub preset endpoints (credentials left blank). */
export function githubProviderDraft(): ProviderDraft {
  return { ...emptyProviderDraft(), ...GITHUB_PRESET };
}

/**
 * Parse the stored option value (a redacted JSON array from GET /api/options)
 * into editable drafts. Lenient: invalid JSON / non-array → []. The server never
 * returns `client_secret`, only `has_secret`; legacy plaintext values are still
 * understood so an old row is not lost on first read.
 */
export function parseProviderDrafts(json: string): ProviderDraft[] {
  let arr: unknown;
  try {
    arr = JSON.parse(json || '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .filter(
      (x): x is Record<string, unknown> =>
        Boolean(x) && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string' &&
        String((x as { id: string }).id).trim() !== '',
    )
    .map((x) => ({
      id: String(x.id ?? ''),
      display_name: String(x.display_name ?? ''),
      authorize_url: String(x.authorize_url ?? ''),
      token_url: String(x.token_url ?? ''),
      userinfo_url: String(x.userinfo_url ?? ''),
      client_id: String(x.client_id ?? ''),
      client_secret: String(x.client_secret ?? ''),
      scope: String(x.scope ?? ''),
      map_username: String(x.map_username ?? ''),
      map_email: String(x.map_email ?? ''),
      discovery_url: String(x.discovery_url ?? ''),
      has_secret: Boolean(x.has_secret) || Boolean(x.client_secret),
    }));
}

/**
 * Serialize drafts to the JSON string that goes back over PATCH /api/options.
 * Whitelist fields only (never `has_secret`); a blank `client_secret` omits the
 * key so the backend keeps the previously stored secret for that provider id.
 */
export function serializeProviderDrafts(drafts: ProviderDraft[]): string {
  const out = drafts.map((d) => {
    const o: Record<string, string> = {
      id: d.id.trim(),
      authorize_url: d.authorize_url.trim(),
      token_url: d.token_url.trim(),
      userinfo_url: d.userinfo_url.trim(),
      client_id: d.client_id.trim(),
      scope: d.scope.trim(),
      map_username: d.map_username.trim(),
    };
    if (d.display_name.trim()) o.display_name = d.display_name.trim();
    if (d.client_secret.trim() !== '') o.client_secret = d.client_secret;
    if (d.map_email.trim()) o.map_email = d.map_email.trim();
    // Always present: an empty string explicitly clears a stale discovery URL.
    o.discovery_url = d.discovery_url.trim();
    return o;
  });
  return JSON.stringify(out);
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Real-time client validation mirroring the backend rules (design §5.2/§4.4). */
export function validateProviderDrafts(drafts: ProviderDraft[]): ProviderIssue[] {
  const issues: ProviderIssue[] = [];
  const seen = new Set<string>();
  drafts.forEach((d, index) => {
    const id = d.id.trim();
    if (!id) issues.push({ index, field: 'id', message: '请填写 id' });
    else if (seen.has(id)) issues.push({ index, field: 'id', message: `id 重复：${id}` });
    else seen.add(id);
    for (const field of ['authorize_url', 'token_url', 'userinfo_url'] as const) {
      if (!isHttpUrl(d[field])) {
        issues.push({ index, field, message: '必须是合法的 http(s) 地址' });
      }
    }
    if (d.discovery_url.trim() && !isHttpUrl(d.discovery_url)) {
      issues.push({ index, field: 'discovery_url', message: '必须是合法的 http(s) 地址' });
    }
    if (!d.client_id.trim()) issues.push({ index, field: 'client_id', message: '请填写 client_id' });
    if (!d.map_username.trim()) issues.push({ index, field: 'map_username', message: '请填写 map_username' });
  });
  return issues;
}
