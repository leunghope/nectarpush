import { describe, expect, it } from 'vitest';
import {
  githubProviderDraft,
  parseProviderDrafts,
  serializeProviderDrafts,
  validateProviderDrafts,
  emptyProviderDraft,
  type ProviderDraft,
} from './oauthProviders';

function draft(over: Partial<ProviderDraft> = {}): ProviderDraft {
  return { ...githubProviderDraft(), client_id: 'cid', ...over };
}

describe('oauthProviders serialization (design §5.2)', () => {
  it('GitHub preset fills the documented endpoints', () => {
    const g = githubProviderDraft();
    expect(g.id).toBe('github');
    expect(g.authorize_url).toBe('https://github.com/login/oauth/authorize');
    expect(g.token_url).toBe('https://github.com/login/oauth/access_token');
    expect(g.userinfo_url).toBe('https://api.github.com/user');
    expect(g.scope).toBe('read:user user:email');
    expect(g.map_username).toBe('login');
    expect(g.map_email).toBe('email');
    // credentials intentionally blank
    expect(g.client_id).toBe('');
    expect(g.client_secret).toBe('');
  });

  it('blank client_secret omits the key (backend keeps stored secret)', () => {
    const json = serializeProviderDrafts([draft({ client_secret: '' })]);
    const parsed = JSON.parse(json);
    expect('client_secret' in parsed[0]).toBe(false);
  });

  it('non-blank client_secret is serialized', () => {
    const json = serializeProviderDrafts([draft({ client_secret: 'NEW' })]);
    expect(JSON.parse(json)[0].client_secret).toBe('NEW');
  });

  it('never serializes has_secret', () => {
    const json = serializeProviderDrafts([draft({ has_secret: true, client_secret: '' })]);
    expect(json).not.toContain('has_secret');
  });

  it('whitelist: only known fields are emitted', () => {
    const parsed = JSON.parse(serializeProviderDrafts([draft()]))[0];
    expect(Object.keys(parsed).sort()).toEqual(
      ['authorize_url', 'client_id', 'discovery_url', 'display_name', 'id', 'map_email', 'map_username', 'scope', 'token_url', 'userinfo_url'].sort(),
    );
  });

  it('empty provider list serializes to []', () => {
    expect(serializeProviderDrafts([])).toBe('[]');
  });
});

describe('oauthProviders parse (redaction-aware)', () => {
  it('reads a redacted value: has_secret true, no client_secret', () => {
    const drafts = parseProviderDrafts(
      '[{"id":"authentik","authorize_url":"https://a","token_url":"https://t","userinfo_url":"https://u","client_id":"c","has_secret":true,"scope":"openid","map_username":"sub"}]',
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0].has_secret).toBe(true);
    expect(drafts[0].client_secret).toBe('');
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

describe('oauthProviders validation (design §5.2)', () => {
  it('accepts a complete draft', () => {
    expect(validateProviderDrafts([draft()])).toEqual([]);
  });

  it('flags empty id, bad url, missing client_id/map_username', () => {
    const issues = validateProviderDrafts([
      { ...emptyProviderDraft(), client_secret: '' },
    ]);
    const fields = issues.map((i) => i.field);
    expect(fields).toContain('id');
    expect(fields).toContain('authorize_url');
    expect(fields).toContain('token_url');
    expect(fields).toContain('userinfo_url');
    expect(fields).toContain('client_id');
    expect(fields).toContain('map_username');
  });

  it('flags duplicate ids', () => {
    const issues = validateProviderDrafts([draft(), draft()]);
    expect(issues.some((i) => i.message.includes('id 重复'))).toBe(true);
  });

  it('flags non-http(s) URL', () => {
    const issues = validateProviderDrafts([draft({ authorize_url: 'ftp://x' })]);
    expect(issues.some((i) => i.field === 'authorize_url')).toBe(true);
  });
});
