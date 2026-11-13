import { describe, expect, it } from 'vitest';
import {
  defaultExtractRows,
  newExtractRow,
  referencedVars,
  rowsFromRule,
  ruleFromRows,
} from './webhookRules';

describe('rowsFromRule', () => {
  it('maps persisted rules to editable rows', () => {
    const rows = rowsFromRule({ repo: 'repository.full_name', stars: '$.repository.stargazers_count' });
    expect(rows.map((r) => [r.key, r.path])).toEqual([
      ['repo', 'repository.full_name'],
      ['stars', '$.repository.stargazers_count'],
    ]);
  });

  it('handles missing rules', () => {
    expect(rowsFromRule(undefined)).toEqual([]);
    expect(rowsFromRule({})).toEqual([]);
  });

  it('starts fresh webhooks with title/content/url rows', () => {
    expect(defaultExtractRows().map((r) => r.key)).toEqual(['title', 'content', 'url']);
  });
});

describe('ruleFromRows', () => {
  it('builds a rule object, trimming values', () => {
    const result = ruleFromRows([
      newExtractRow(' repo ', ' repository.full_name '),
      newExtractRow('stars', '$.repository.stargazers_count'),
    ]);
    expect(result).toEqual({
      ok: true,
      rule: { repo: 'repository.full_name', stars: '$.repository.stargazers_count' },
      warnings: [],
    });
  });

  it('ignores fully blank rows', () => {
    const result = ruleFromRows([newExtractRow('', ''), newExtractRow('title', 'title')]);
    expect(result).toEqual({ ok: true, rule: { title: 'title' }, warnings: [] });
  });

  it('ignores a key without a path and reports a warning', () => {
    const result = ruleFromRows([newExtractRow('title', ''), newExtractRow('content', 'content')]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rule).toEqual({ content: 'content' });
    expect(result.warnings[0]).toContain('title');
  });

  it('rejects a path without a key', () => {
    const result = ruleFromRows([newExtractRow('', 'title')]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('第 1 行');
  });

  it('rejects invalid variable names', () => {
    for (const key of ['1title', 'a-b', 'a b', '$title']) {
      const result = ruleFromRows([newExtractRow(key, 'title')]);
      expect(result.ok).toBe(false);
    }
  });

  it('rejects duplicate variable names', () => {
    const result = ruleFromRows([newExtractRow('title', 'a'), newExtractRow('title', 'b')]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('重复');
  });

  it('rejects over-long paths', () => {
    const result = ruleFromRows([newExtractRow('title', 'a'.repeat(501))]);
    expect(result.ok).toBe(false);
  });

  it('accepts the whole-payload path', () => {
    const result = ruleFromRows([newExtractRow('payload', '$')]);
    expect(result).toEqual({ ok: true, rule: { payload: '$' }, warnings: [] });
  });
});

describe('referencedVars', () => {
  it('finds $key and {{ key }} references once, in order', () => {
    expect(
      referencedVars({
        title: '⭐ 新 Star：$repo',
        content: '$repo 来自 $owner，{{ stars }} 星',
        description: undefined,
      }),
    ).toEqual(['repo', 'owner', 'stars']);
  });

  it('returns nothing for literal templates', () => {
    expect(referencedVars({ title: '没有变量', content: '价格 $ 5' })).toEqual([]);
  });
});