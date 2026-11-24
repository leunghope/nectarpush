import { ChannelAdapter, ChannelConfig, PushMessage, SendResult, AdapterCtx, Capabilities, ConfigField } from '../adapter.interface';
import { caps, field, validateFields, withLatency } from '../adapter.base';

/** Bark (iOS push) — GET style via URL, sends through device key. */
export class BarkAdapter implements ChannelAdapter {
  readonly type = 'bark';
  readonly displayName = 'Bark';
  readonly status = 'core' as const;
  readonly capabilities: Capabilities = caps({
    title: true, description: true, content: true, url: true, markdown: true,
    to_mode: 'none',
  });
  readonly configSchema: ConfigField[] = [
    field('url', 'Bark 服务地址', 'string', { required: false, secret: false, default: 'https://api.day.app', help: '自建 Bark 服务填自己的地址，默认官方' }),
    field('secret', 'Push Key', 'password', { required: true, secret: true }),
  ];

  validateConfig(cfg: ChannelConfig) { return validateFields(this.configSchema, cfg); }

  async send(cfg: ChannelConfig, msg: PushMessage): Promise<SendResult> {
    if (!cfg.secret) return { success: false, message: '缺少 Push Key' };
    const base = (cfg.url || 'https://api.day.app').replace(/\/+$/, '');
    const body = [msg.content ?? msg.description, msg.url].filter(Boolean).join('\n');
    const payload = {
      title: msg.title || 'NectarPush',
      body: body || msg.title || 'NectarPush 消息',
      ...(msg.url ? { url: msg.url } : {}),
    };
    return withLatency(async () => {
      try {
        const res = await fetch(`${base}/push`, {
          method: 'POST',
          headers: { 'content-type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ ...payload, device_key: cfg.secret }),
          signal: AbortSignal.timeout(10_000),
        });
        const text = await res.text();
        const code = (() => { try { return (JSON.parse(text) as { code?: number }).code; } catch { return undefined; } })();
        return res.ok && (code === undefined || code === 200)
          ? { success: true, raw: text.slice(0, 500) }
          : { success: false, message: `Bark 返回 ${res.status}：${text.slice(0, 200)}`, raw: text.slice(0, 500) };
      } catch (e) {
        return { success: false, message: `Bark 发送失败：${(e as Error).message}` };
      }
    });
  }
}
