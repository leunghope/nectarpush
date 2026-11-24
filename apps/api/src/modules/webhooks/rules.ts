import type { PushMessage } from '../../channels/adapter.interface';

/**
 * Resolve a dotted JSON path against a parsed webhook payload.
 *
 * Supported forms:
 * - `$` or `''` — the whole payload
 * - `$.repository.full_name` / `repository.full_name`
 * - `$.items[0].name` / `items.0.name`
 *
 * Missing segments, `null` and `undefined` resolve to an empty string;
 * objects and arrays are serialised as JSON so they can be embedded in a
 * message template.
 */
export function readJsonPath(payload: unknown, path: string): string {
  let cur: unknown = payload;
  const raw = path.trim();
  if (raw === '' || raw === '$') return stringifyLeaf(cur);

  const normalised = raw
    .replace(/^\$/, '')
    .replace(/^\./, '')
    .replace(/\[(\d+)\]/g, '.$1');

  for (const seg of normalised.split('.').filter(Boolean)) {
    if (Array.isArray(cur)) {
      const index = Number(seg);
      if (!Number.isInteger(index) || index < 0 || index >= cur.length) return '';
      cur = cur[index];
      continue;
    }
    if (cur && typeof cur === 'object' && seg in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[seg];
      continue;
    }
    return '';
  }
  return stringifyLeaf(cur);
}

function stringifyLeaf(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return String(value);
}

export function extractVars(payload: unknown, extract: Record<string, string>): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [key, path] of Object.entries(extract)) {
    vars[key] = readJsonPath(payload, path);
  }
  return vars;
}

/**
 * Fill a construct template. `$key` is the canonical syntax; `{{ key }}` is
 * accepted for compatibility with older configs and the early design mock.
 */
export function constructMessage(construct: Record<string, string>, vars: Record<string, string>): PushMessage {
  const fill = (tpl: string | undefined): string | undefined =>
    tpl === undefined
      ? undefined
      : tpl.replace(/\$(\w+)|\{\{\s*(\w+)\s*\}\}/g, (_match, dollar: string | undefined, braces: string | undefined) => {
          const key = dollar ?? braces ?? '';
          return vars[key] ?? '';
        });
  return {
    title: fill(construct.title),
    description: fill(construct.description),
    content: fill(construct.content),
    url: fill(construct.url),
    renderMode: 'markdown',
  };
}