import { describe, expect, it } from 'vitest';
import {
  githubProviderDraft,
  emptyProviderDraft,
  parseProviderDrafts,
  serializeProviderDrafts,
  validateProviderDrafts,
  type ProviderDraft,
} from './oauthProviders';

/** A complete GitHub draft: only display name + credentials are user input. */
function draft(over: Partial<ProviderDraft> = {}): ProviderDraft {
  return { ...githubProviderDraft(), display_name: 'GitHub', client_id: 'cid', has_secret: true, ...over };
}

/** A complete custom OIDC draft: discovery URL instead of hand-written endpoints. */
function customDraft(over: Partial<ProviderDraft> = {}): ProviderDraft {
  return {
    ...emptyProviderDraft(),
    display_name: '公司 SSO',
    client_id: 'cid',
    has_secret: true,
    discovery_url: 'https://sso.example.com/.well-known/openid-configuration',
    ...over,
  };
}

describe('oauthProviders serialization', () => {
  it('GitHub preset fills the documented endpoints and leaves credentials blank', () => {
    const g = githubProviderDraft();
    expect(g.id).toBe('github');
    expect(g.enabled).toBe(true);
    expect(g.authorize_url).toBe('https://github.com/login/oauth/authorize');
    expect(g.token_url).toBe('https://github.com/login/oauth/access_token');
    expect(g.userinfo_url).toBe('https://api.github.com/user');
    expect(g.scope).toBe('read:user user:email');
    expect(g.map_username).toBe('login');
    expect(g.map_email).toBe('email');
    expect(g.client_id).toBe('');
    expect(g.client_secret).toBe('');
  });

  it('custom drafts default to the OIDC scope and preferred_username mapping', () => {
    const c = emptyProviderDraft();
    expect(c.id).toMatch(/^custom-/);
    expect(c.scope).toBe('openid profile email');
    expect(c.map_username).toBe('preferred_username');
    expect(c.discovery_url).toBe('');
  });

  it('blank client_secret omits the key (backend keeps the stored secret)', () => {
    const parsed = JSON.parse(serializeProviderDrafts([draft({ client_secret: '' })]));
    expect('client_secret' in parsed[0]).toBe(false);
  });

  it('non-blank client_secret and icon are serialized', () => {
    const parsed = JSON.parse(
      serializeProviderDrafts([draft({ client_secret: 'NEW' }), customDraft({ icon: 'data:image/png;base64,AAA' })]),
    );
    expect(parsed[0].client_secret).toBe('NEW');
    expect(parsed[1].icon).toBe('data:image/png;base64,AAA');
  });

  it('never serializes has_secret', () => {
    expect(serializeProviderDrafts([draft({ has_secret: true, client_secret: '' })])).not.toContain('has_secret');
  });

  it('whitelist: only known fields are emitted', () => {
    const parsed = JSON.parse(serializeProviderDrafts([draft()]))[0];
    expect(Object.keys(parsed).sort()).toEqual(
      [
        'authorize_url',
        'client_id',
        'discovery_url',
        'display_name',
        'enabled',
        'id',
        'map_email',
        'map_username',
        'scope',
        'token_url',
        'userinfo_url',
      ].sort(),
    );
  });

  it('empty provider list serializes to []', () => {
    expect(serializeProviderDrafts([])).toBe('[]');
  });
});

describe('oauthProviders parse (redaction-aware, legacy tolerant)', () => {
  it('reads a redacted value: has_secret true, no client_secret', () => {
    const drafts = parseProviderDrafts(
      '[{"id":"authentik","authorize_url":"https://a","token_url":"https://t","userinfo_url":"https://u","client_id":"c","has_secret":true,"scope":"openid","map_username":"sub"}]',
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0].has_secret).toBe(true);
    expect(drafts[0].client_secret).toBe('');
    expect(drafts[0].enabled).toBe(true);
  });

  it('keeps enabled=false and icon', () => {
    const [d] = parseProviderDrafts('[{"id":"authentik","enabled":false,"icon":"data:image/png;base64,AAA","client_id":"c"}]');
    expect(d.enabled).toBe(false);
    expect(d.icon).toBe('data:image/png;base64,AAA');
  });

  it('understands a legacy plaintext secret', () => {
    const [d] = parseProviderDrafts('[{"id":"github","client_id":"x","client_secret":"y"}]');
    expect(d.client_secret).toBe('y');
    expect(d.has_secret).toBe(true);
  });

  it('invalid JSON → []', () => {
    expect(parseProviderDrafts('{oops')).toEqual([]);
  });
});

describe('oauthProviders validation', () => {
  it('accepts a complete GitHub draft with only name and credentials', () => {
    expect(validateProviderDrafts([draft()])).toEqual([]);
  });

  it('accepts a complete custom draft with only discovery URL', () => {
    expect(validateProviderDrafts([customDraft()])).toEqual([]);
  });

  it('flags missing name, client id and secret', () => {
    const issues = validateProviderDrafts([draft({ display_name: '', client_id: '', has_secret: false })]);
    const fields = issues.map((i) => i.field);
    expect(fields).toContain('display_name');
    expect(fields).toContain('client_id');
    expect(fields).toContain('client_secret');
  });

  it('custom provider without discovery URL or legacy endpoints is flagged', () => {
    const issues = validateProviderDrafts([customDraft({ discovery_url: '' })]);
    expect(issues.some((i) => i.field === 'discovery_url')).toBe(true);
  });

  it('custom provider may keep existing hand-written endpoints (legacy)', () => {
    const issues = validateProviderDrafts([
      customDraft({
        discovery_url: '',
        authorize_url: 'https://a/authorize',
        token_url: 'https://a/token',
        userinfo_url: 'https://a/userinfo',
      }),
    ]);
    expect(issues).toEqual([]);
  });

  it('flags a non-http(s) discovery URL', () => {
    const issues = validateProviderDrafts([customDraft({ discovery_url: 'ftp://x' })]);
    expect(issues.some((i) => i.field === 'discovery_url')).toBe(true);
  });

  it('flags duplicate ids and a second GitHub provider', () => {
    const issues = validateProviderDrafts([draft(), draft()]);
    expect(issues.some((i) => i.message.includes('重复'))).toBe(true);
    expect(issues.some((i) => i.message.includes('GitHub 登录只能添加一次'))).toBe(true);
  });

  it('flags an unsupported icon payload', () => {
    const issues = validateProviderDrafts([customDraft({ icon: 'data:text/plain;base64,AAA' })]);
    expect(issues.some((i) => i.field === 'icon')).toBe(true);
  });
});
