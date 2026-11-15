import { describe, expect, it } from 'vitest';
import { constructMessage, extractVars, readJsonPath } from '../src/modules/webhooks/rules';

const payload = {
  action: 'opened',
  repository: {
    full_name: 'example-user/nectarpush',
    stargazers_count: 42,
    owner: { login: 'example-user' },
    topics: ['push', 'webhook'],
    private: false,
  },
  items: [{ name: 'first' }, { name: 'second' }],
  nil: null,
  empty: '',
};

describe('readJsonPath', () => {
  it('reads nested dotted paths with and without the $ prefix', () => {
    expect(readJsonPath(payload, 'repository.full_name')).toBe('example-user/nectarpush');
    expect(readJsonPath(payload, '$.repository.full_name')).toBe('example-user/nectarpush');
  });

  it('returns the whole payload for $', () => {
    expect(JSON.parse(readJsonPath(payload, '$'))).toEqual(payload);
  });

  it('supports array indexes in both styles', () => {
    expect(readJsonPath(payload, '$.items[1].name')).toBe('second');
    expect(readJsonPath(payload, 'items.0.name')).toBe('first');
  });

  it('serialises boolean and nested object leaves', () => {
    expect(readJsonPath(payload, 'repository.private')).toBe('false');
    expect(JSON.parse(readJsonPath(payload, 'repository.owner'))).toEqual({ login: 'example-user' });
  });

  it('returns empty for missing segments, null and out-of-range indexes', () => {
    expect(readJsonPath(payload, 'repository.missing')).toBe('');
    expect(readJsonPath(payload, 'nil')).toBe('');
    expect(readJsonPath(payload, 'items.5.name')).toBe('');
    expect(readJsonPath(payload, 'repository.full_name.nope')).toBe('');
  });

  it('keeps an empty string leaf as empty', () => {
    expect(readJsonPath(payload, 'empty')).toBe('');
  });

  it('tolerates weird input without throwing', () => {
    expect(readJsonPath(undefined, 'a.b')).toBe('');
    expect(readJsonPath('text', 'a')).toBe('');
    expect(readJsonPath(payload, '   ')).toBe(JSON.stringify(payload));
  });
});

describe('extractVars', () => {
  it('maps every configured key to its resolved value', () => {
    const vars = extractVars(payload, {
      repo: 'repository.full_name',
      stars: '$.repository.stargazers_count',
      owner: 'repository.owner.login',
    });
    expect(vars).toEqual({ repo: 'example-user/nectarpush', stars: '42', owner: 'example-user' });
  });
});

describe('constructMessage', () => {
  it('fills $key templates', () => {
    const message = constructMessage(
      { title: '⭐ 新 Star：$repo', content: '来自 $owner，共 $stars 星' },
      { repo: 'nectarpush', owner: 'example-user', stars: '42' },
    );
    expect(message.title).toBe('⭐ 新 Star：nectarpush');
    expect(message.content).toBe('来自 example-user，共 42 星');
    expect(message.renderMode).toBe('markdown');
  });

  it('also accepts legacy {{ key }} templates', () => {
    const message = constructMessage({ title: '{{ title }}', content: 'x {{content}} y' }, { title: 'T', content: 'C' });
    expect(message.title).toBe('T');
    expect(message.content).toBe('x C y');
  });

  it('replaces unknown variables with an empty string', () => {
    const message = constructMessage({ title: '$missing', content: '{{ nope }}' }, {});
    expect(message.title).toBe('');
    expect(message.content).toBe('');
  });

  it('leaves omitted fields undefined', () => {
    const message = constructMessage({ title: 'only' }, {});
    expect(message.description).toBeUndefined();
    expect(message.url).toBeUndefined();
  });
});