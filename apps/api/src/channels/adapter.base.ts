import { Capabilities, ConfigField, ChannelAdapter, PushMessage, SendResult } from './adapter.interface';

/** Base helpers shared by concrete adapters. */

export function caps(partial: Partial<Capabilities> & { to_mode: Capabilities['to_mode'] }): Capabilities {
  return {
    title: false,
    description: false,
    content: false,
    url: false,
    to: false,
    markdown: false,
    ...partial,
  };
}

export function field(
  key: string,
  label: string,
  type: ConfigField['type'],
  opts: Partial<ConfigField> = {},
): ConfigField {
  return {
    key,
    label,
    type,
    required: opts.required ?? false,
    secret: opts.secret ?? false,
    placeholder: opts.placeholder ?? null,
    help: opts.help ?? null,
    default: opts.default ?? null,
    options: opts.options ?? null,
    options_source: opts.options_source ?? null,
  };
}

export function validateFields(
  fields: ConfigField[],
  cfg: Record<string, string>,
): { valid: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  for (const f of fields) {
    if (f.required && !cfg[f.key]?.trim()) {
      errors[f.key] = `${f.label} 不能为空`;
    }
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

export async function httpPostJson(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
  timeoutMs = 10_000,
): Promise<{ status: number; body: string; json: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-json body */
    }
    return { status: res.status, body: text, json };
  } finally {
    clearTimeout(timer);
  }
}

export async function httpGetJson(
  url: string,
  timeoutMs = 10_000,
): Promise<{ status: number; json: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-json body */
    }
    return { status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

/** Collapse message text: title/description/content per render mode. */
export function renderText(msg: PushMessage): string {
  const mode = msg.renderMode ?? 'markdown';
  let body = msg.content ?? msg.description ?? '';
  if (mode === 'code' && body) {
    body = '```\n' + body + '\n```';
  }
  const parts = [msg.title, body, msg.url].filter(Boolean);
  return parts.join('\n');
}

/** A draft adapter skeleton: config form works, send throws explicit NotImplemented. */
export abstract class DraftAdapterBase implements ChannelAdapter {
  abstract readonly type: string;
  abstract readonly displayName: string;
  readonly status = 'draft' as const;
  abstract readonly capabilities: Capabilities;
  abstract readonly configSchema: ConfigField[];

  validateConfig(cfg: Record<string, string>): { valid: boolean; errors: Record<string, string> } {
    return validateFields(this.configSchema, cfg);
  }

  async send(): Promise<{ success: boolean; message?: string }> {
    return {
      success: false,
      message: `通道 ${this.displayName} 为骨架实现（draft），尚未真实联调`,
    };
  }
}

/** Measure adapter send latency and attach it to the result (test endpoint echo). */
export async function withLatency(fn: () => Promise<SendResult>): Promise<SendResult> {
  const start = Date.now();
  const result = await fn();
  return { ...result, latencyMs: Date.now() - start };
}
