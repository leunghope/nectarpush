import { ChannelAdapter, ChannelConfig, PushMessage, SendResult, AdapterCtx, Capabilities, ConfigField } from '../adapter.interface';
import { caps, field, validateFields, withLatency } from '../adapter.base';

const MAX_URL = 2048;

/** Webhook channel: templated JSON body to a user-provided HTTPS URL. */
export class WebhookAdapter implements ChannelAdapter {
  readonly type = 'webhook';
  readonly displayName = 'Webhook';
  readonly status = 'core' as const;
  readonly capabilities: Capabilities = caps({
    title: true, description: true, content: true, url: true, to: true,
    markdown: true, to_mode: 'none',
  });
  readonly configSchema: ConfigField[] = [
    field('url', '请求地址', 'string', { required: true, secret: false, placeholder: 'https://example.com/webhook', help: '必须为 HTTPS，且不能指向本服务' }),
    field('other', '请求模板', 'textarea', { required: false, secret: false, help: 'JSON 模板，支持变量 $title/$description/$content/$url/$to，默认 {"text":"$title $description"}' }),
  ];

  validateConfig(cfg: ChannelConfig) {
    const r = validateFields(this.configSchema, cfg);
    if (cfg.url) {
      let parsed: URL;
      try {
        parsed = new URL(cfg.url);
      } catch {
        r.errors.url = '请求地址格式不正确';
        r.valid = false;
        parsed = new URL('https://invalid.invalid');
      }
      if (parsed.protocol !== 'https:') {
        r.errors.url = '请求地址必须为 HTTPS';
        r.valid = false;
      }
      if (this.pointsToSelf(parsed)) {
        r.errors.url = '请求地址不能指向本服务';
        r.valid = false;
      }
    }
    if (cfg.other) {
      try {
        JSON.parse(cfg.other);
      } catch {
        r.errors.other = '请求模板必须为合法 JSON';
        r.valid = false;
      }
    }
    return r;
  }

  async send(cfg: ChannelConfig, msg: PushMessage, ctx: AdapterCtx): Promise<SendResult> {
    if (!cfg.url) return { success: false, message: '缺少请求地址' };
    const template = cfg.other?.trim() || '{"text": "$title $description"}';
    const body = this.fill(template, msg, ctx.overrideTo ?? '');
    return withLatency(async () => {
      try {
        const res = await fetch(cfg.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          signal: AbortSignal.timeout(10_000),
        });
        const text = await res.text().catch(() => '');
        return res.ok
          ? { success: true, raw: text.slice(0, 500) || `(${res.status})` }
          : { success: false, message: `Webhook 通道返回 ${res.status}`, raw: text.slice(0, 500) };
      } catch (e) {
        return { success: false, message: `Webhook 通道发送失败：${(e as Error).message}` };
      }
    });
  }

  private fill(template: string, msg: PushMessage, to: string): string {
    const esc = (s: string) => s.replace(/"/g, '\\"').replace(/\n/g, '\\n');
    return template
      .replaceAll('$title', esc(msg.title ?? ''))
      .replaceAll('$description', esc(msg.description ?? ''))
      .replaceAll('$content', esc(msg.content ?? ''))
      .replaceAll('$url', esc(msg.url ?? ''))
      .replaceAll('$to', esc(to));
  }

  private pointsToSelf(u: URL): boolean {
    const base = process.env.PUBLIC_BASE_URL;
    if (base) {
      try {
        const b = new URL(base);
        if (b.host === u.host) return true;
      } catch { /* invalid base */ }
    }
    const port = process.env.PORT || '3000';
    return u.port === String(port) && ['localhost', '127.0.0.1', '::1'].includes(u.hostname);
  }
}
