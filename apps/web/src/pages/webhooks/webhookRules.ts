export interface ExtractRow {
  id: string;
  key: string;
  path: string;
}

let nextRowId = 0;

export function newExtractRow(key = '', path = ''): ExtractRow {
  nextRowId += 1;
  return { id: `extract-${nextRowId}`, key, path };
}

/** Fresh webhooks start with the three fields most messages need. */
export function defaultExtractRows(): ExtractRow[] {
  return [newExtractRow('title'), newExtractRow('content'), newExtractRow('url')];
}

export function rowsFromRule(rule: Record<string, string> | null | undefined): ExtractRow[] {
  return Object.entries(rule ?? {}).map(([key, path]) => newExtractRow(key, String(path ?? '')));
}

export type RuleBuildResult =
  | { ok: true; rule: Record<string, string>; warnings: string[] }
  | { ok: false; error: string };

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_PATH = 500;

/**
 * Convert editable rows into the persisted `extract_rule` object.
 *
 * - fully blank rows are ignored
 * - a key without a path is ignored with a warning (preserves the old
 *   "empty values are not saved" behaviour)
 * - a path without a key, an invalid key, a duplicate key or an over-long
 *   path blocks saving
 */
export function ruleFromRows(rows: ExtractRow[]): RuleBuildResult {
  const rule: Record<string, string> = {};
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < rows.length; index += 1) {
    const key = rows[index].key.trim();
    const path = rows[index].path.trim();
    if (!key && !path) continue;
    if (!path) {
      warnings.push(`变量「${key}」未填写 JSONPath，已忽略`);
      continue;
    }
    if (!key) return { ok: false, error: `第 ${index + 1} 行：变量名不能为空` };
    if (!KEY_RE.test(key)) {
      return {
        ok: false,
        error: `第 ${index + 1} 行：变量名「${key}」只能包含字母、数字和下划线，且不能以数字开头`,
      };
    }
    if (path.length > MAX_PATH) {
      return { ok: false, error: `第 ${index + 1} 行：JSONPath 不能超过 ${MAX_PATH} 个字符` };
    }
    if (seen.has(key)) return { ok: false, error: `变量名「${key}」重复` };
    seen.add(key);
    rule[key] = path;
  }

  return { ok: true, rule, warnings };
}

/**
 * Variables referenced by a construct template. `$key` is canonical;
 * `{{ key }}` is the legacy syntax the backend still accepts.
 */
export function referencedVars(construct: Record<string, string | undefined>): string[] {
  const found: string[] = [];
  const pattern = /\$(\w+)|\{\{\s*(\w+)\s*\}\}/g;
  for (const value of Object.values(construct)) {
    if (!value) continue;
    for (const match of value.matchAll(pattern)) {
      const key = match[1] ?? match[2];
      if (key && !found.includes(key)) found.push(key);
    }
  }
  return found;
}