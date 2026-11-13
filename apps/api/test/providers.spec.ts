import { describe, expect, it } from 'vitest';
import {
  buildTokenRequestBody,
  mergeProviders,
  parseProvidersJson,
  parseTokenResponse,
  redactProviders,
  validateProviders,
  TOKEN_REQUEST_CONTENT_TYPE,
  type OAuthProviderConfig,
} from '../src/modules/oauth/providers';

const base = (over: Partial<OAuthProviderConfig> = {}): OAuthProviderConfig => ({
  id: 'authentik',
  display_name: 'Leunghope SSO',
  authorize_url: 'https://sso.example.com/application/o/authorize/',
  token_url: 'https://sso.example.com/application/o/token/',
  userinfo_url: 'https://sso.example.com/application/o/userinfo/',
  client_id: 'cid',
  client_secret: 'S3CR3T',
  scope: 'openid email profile',
  map_username: 'sub',
  map_email: 'email',
  ...over,
});

describe('mergeProviders (Q-O2: blank secret keeps old value)', () => {
  it('keeps existing secret when incoming secret is blank', () => {
    const existing = [base()];
    const incoming = [base({ client_secret: '' })];
    const out = mergeProviders(existing, incoming);
    expect(out[0].client_secret).toBe('S3CR3T');
  });

  it('keeps existing secret when incoming secret is only whitespace', () => {
    const out = mergeProviders([base()], [base({ client_secret: '   ' })]);
    expect(out[0].client_secret).toBe('S3CR3T');
  });

  it('new secret overrides the existing one', () => {
    const out = mergeProviders([base()], [base({ client_secret: 'NEWSECRET' })]);
    expect(out[0].client_secret).toBe('NEWSECRET');
  });

  it('a brand-new provider keeps its own secret', () => {
    const out = mergeProviders([], [base({ id: 'gitlab', client_secret: 'GL' })]);
    expect(out[0].client_secret).toBe('GL');
  });

  it('a new provider with no secret gets an empty secret', () => {
    const out = mergeProviders([], [base({ id: 'gitlab', client_secret: undefined })]);
    expect(out[0].client_secret).toBe('');
  });

  it('removing a provider drops it and its secret', () => {
    const existing = [base({ id: 'a' }), base({ id: 'b' })];
    const out = mergeProviders(existing, [base({ id: 'a', client_secret: '' })]);
    expect(out.map((p) => p.id)).toEqual(['a']);
  });
});

describe('redactProviders (O-2: no plaintext client_secret on read)', () => {
  it('removes client_secret and sets has_secret=true when present', () => {
    const out = redactProviders([base({ client_secret: 'S3CR3T' })]);
    expect('client_secret' in out[0]).toBe(false);
    expect(out[0].has_secret).toBe(true);
    expect(JSON.stringify(out)).not.toContain('S3CR3T');
  });

  it('sets has_secret=false when secret blank/missing', () => {
    expect(redactProviders([base({ client_secret: '' })])[0].has_secret).toBe(false);
    expect(redactProviders([base({ client_secret: undefined })])[0].has_secret).toBe(false);
    expect(redactProviders([base({ client_secret: '   ' })])[0].has_secret).toBe(false);
  });
});

describe('parseProvidersJson (lenient parse, legacy compatible)', () => {
  it('invalid JSON → []', () => {
    expect(parseProvidersJson('{not json')).toEqual([]);
  });
  it('non-array JSON → []', () => {
    expect(parseProvidersJson('{"a":1}')).toEqual([]);
    expect(parseProvidersJson('null')).toEqual([]);
    expect(parseProvidersJson('42')).toEqual([]);
  });
  it('drops entries without a string id', () => {
    const out = parseProvidersJson('[{"id":"ok"},{"name":"noid"},null,5,{"id":123}]');
    expect(out.map((p) => p.id)).toEqual(['ok']);
  });
  it('parses a legacy value with a plaintext secret', () => {
    const out = parseProvidersJson('[{"id":"github","client_id":"x","client_secret":"y"}]');
    expect(out[0]).toMatchObject({ id: 'github', client_id: 'x', client_secret: 'y' });
  });
  it('empty string → []', () => {
    expect(parseProvidersJson('')).toEqual([]);
  });
});

describe('validateProviders (design §4.4 → 422 VALIDATION_FAILED)', () => {
  it('accepts a valid config', () => {
    expect(() => validateProviders([base()])).not.toThrow();
  });
  it('rejects missing id', () => {
    expect(() => validateProviders([base({ id: '' })])).toThrowError(/缺少 id/);
  });
  it('rejects duplicate ids', () => {
    expect(() => validateProviders([base(), base()])).toThrowError(/id 重复/);
  });
  it('rejects non-http(s) authorize_url', () => {
    expect(() => validateProviders([base({ authorize_url: 'ftp://x' })])).toThrowError(/authorize_url/);
  });
  it('rejects invalid token_url', () => {
    expect(() => validateProviders([base({ token_url: 'not a url' })])).toThrowError(/token_url/);
  });
  it('rejects empty client_id', () => {
    expect(() => validateProviders([base({ client_id: '' })])).toThrowError(/client_id/);
  });
  it('rejects empty map_username', () => {
    expect(() => validateProviders([base({ map_username: '' })])).toThrowError(/map_username/);
  });
  it('throws an ApiError with code VALIDATION_FAILED', () => {
    try {
      validateProviders([base({ id: '' })]);
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as { code?: string }).code).toBe('VALIDATION_FAILED');
    }
  });
});

describe('buildTokenRequestBody + parseTokenResponse (O-1: form encoding)', () => {
  it('content-type constant is form-urlencoded', () => {
    expect(TOKEN_REQUEST_CONTENT_TYPE).toBe('application/x-www-form-urlencoded');
  });
  it('body contains the four required fields and is urlencoded', () => {
    const body = buildTokenRequestBody(base({ client_secret: 'a b&c' }), 'CODE123');
    const params = new URLSearchParams(body);
    expect(params.get('client_id')).toBe('cid');
    expect(params.get('client_secret')).toBe('a b&c');
    expect(params.get('code')).toBe('CODE123');
    expect(params.get('grant_type')).toBe('authorization_code');
    expect(body).toContain('client_id=cid');
  });
  it('repeats redirect_uri when supplied (RFC 6749 §4.1.3)', () => {
    const body = buildTokenRequestBody(base({ client_secret: 's' }), 'C', 'http://127.0.0.1:3300/api/auth/oauth/authentik/callback');
    expect(new URLSearchParams(body).get('redirect_uri')).toBe('http://127.0.0.1:3300/api/auth/oauth/authentik/callback');
  });
  it('omits redirect_uri when not supplied (GitHub-style providers)', () => {
    const body = buildTokenRequestBody(base({ client_secret: 's' }), 'C');
    expect(new URLSearchParams(body).has('redirect_uri')).toBe(false);
  });
  it('parses a JSON token response', () => {
    expect(parseTokenResponse('{"access_token":"tok","token_type":"bearer"}').access_token).toBe('tok');
  });
  it('parses a form-urlencoded token response (GitHub fallback)', () => {
    expect(parseTokenResponse('access_token=tok2&token_type=bearer&scope=read').access_token).toBe('tok2');
  });
  it('returns {} for empty/garbage bodies', () => {
    expect(parseTokenResponse('')).toEqual({});
    expect(parseTokenResponse('<html>oops</html>').access_token).toBeUndefined();
  });
});

describe('discovery_url (Stage 9 extension)', () => {
  it('keeps discovery_url when an update omits it, and clears it on explicit empty', () => {
    const old = base({ discovery_url: 'https://sso.example.com' });
    const omitted = mergeProviders([old], [base({ client_id: 'cid2' })])[0];
    expect(omitted.discovery_url).toBe('https://sso.example.com');
    const cleared = mergeProviders([old], [base({ discovery_url: '' })])[0];
    expect(cleared.discovery_url).toBeUndefined();
    const changed = mergeProviders([old], [base({ discovery_url: 'https://other.example.com' })])[0];
    expect(changed.discovery_url).toBe('https://other.example.com');
  });

  it('rejects a non-http discovery_url but accepts a valid one', () => {
    expect(() => validateProviders([base({ discovery_url: 'ftp://x' })])).toThrow();
    expect(() => validateProviders([base({ discovery_url: 'https://sso.example.com' })])).not.toThrow();
    expect(() => validateProviders([base({ discovery_url: '' })])).not.toThrow();
  });
});
