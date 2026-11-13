import { describe, expect, it, vi } from 'vitest';
import { discoverOidc, normalizeDiscoveryUrl } from '../src/modules/oauth/discovery';

const DOC = {
  issuer: 'https://sso.example.com/application/o/nectarpush/',
  authorization_endpoint: 'https://sso.example.com/application/o/authorize/',
  token_endpoint: 'https://sso.example.com/application/o/token/',
  userinfo_endpoint: 'https://sso.example.com/application/o/userinfo/',
  scopes_supported: ['openid', 'email', 'profile', 'offline_access'],
};

function stubFetch(body: unknown, status = 200) {
  return vi.fn(async () => new Response(
    typeof body === 'string' ? body : JSON.stringify(body),
    { status, headers: { 'content-type': 'application/json' } },
  )) as unknown as typeof fetch;
}

describe('normalizeDiscoveryUrl', () => {
  it('adds https:// and the well-known suffix for a bare issuer', () => {
    expect(normalizeDiscoveryUrl('sso.example.com/application/o/nectarpush'))
      .toBe('https://sso.example.com/application/o/nectarpush/.well-known/openid-configuration');
  });

  it('keeps an already-complete discovery URL and trims whitespace', () => {
    expect(normalizeDiscoveryUrl('  https://sso.example.com/.well-known/openid-configuration '))
      .toBe('https://sso.example.com/.well-known/openid-configuration');
  });

  it('drops the trailing slash before appending the suffix', () => {
    expect(normalizeDiscoveryUrl('https://sso.example.com/'))
      .toBe('https://sso.example.com/.well-known/openid-configuration');
  });

  it('rejects empty and non-http input', () => {
    expect(() => normalizeDiscoveryUrl('  ')).toThrow();
    expect(() => normalizeDiscoveryUrl('ftp://sso.example.com')).toThrow();
  });
});

describe('discoverOidc', () => {
  it('maps endpoints, scope and default claims from the document', async () => {
    const result = await discoverOidc('https://sso.example.com/application/o/nectarpush', stubFetch(DOC));
    expect(result).toMatchObject({
      issuer: DOC.issuer,
      authorize_url: DOC.authorization_endpoint,
      token_url: DOC.token_endpoint,
      userinfo_url: DOC.userinfo_endpoint,
      scope: 'openid profile email',
      map_username: 'sub',
      map_email: 'email',
      warnings: [],
    });
    expect(result.scopes_supported).toContain('offline_access');
  });

  it('warns when userinfo_endpoint is missing instead of failing', async () => {
    const { userinfo_endpoint: _drop, ...partial } = DOC;
    const result = await discoverOidc('sso.example.com', stubFetch(partial));
    expect(result.userinfo_url).toBe('');
    expect(result.warnings[0]).toMatch(/userinfo_endpoint/);
  });

  it('fails with OAUTH_DISCOVERY_FAILED on a non-2xx response', async () => {
    await expect(discoverOidc('sso.example.com', stubFetch({}, 404)))
      .rejects.toMatchObject({ code: 'OAUTH_DISCOVERY_FAILED' });
  });

  it('fails with OAUTH_DISCOVERY_FAILED on non-JSON output', async () => {
    await expect(discoverOidc('sso.example.com', stubFetch('<html>login</html>')))
      .rejects.toMatchObject({ code: 'OAUTH_DISCOVERY_FAILED' });
  });

  it('fails when authorization_endpoint or token_endpoint is missing', async () => {
    await expect(discoverOidc('sso.example.com', stubFetch({ token_endpoint: DOC.token_endpoint })))
      .rejects.toMatchObject({ code: 'OAUTH_DISCOVERY_FAILED' });
    await expect(discoverOidc('sso.example.com', stubFetch({ authorization_endpoint: DOC.authorization_endpoint })))
      .rejects.toMatchObject({ code: 'OAUTH_DISCOVERY_FAILED' });
  });

  it('turns a network error into OAUTH_DISCOVERY_FAILED', async () => {
    const broken = vi.fn(async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    await expect(discoverOidc('sso.example.com', broken))
      .rejects.toMatchObject({ code: 'OAUTH_DISCOVERY_FAILED' });
  });
});
