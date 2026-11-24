import { ChannelAdapter, ChannelConfig, PushMessage, SendResult, AdapterCtx, Capabilities, ConfigField } from '../adapter.interface';
import { caps, field, validateFields, httpPostJson, withLatency } from '../adapter.base';

export class DiscordAdapter implements ChannelAdapter {
  readonly type = 'discord';
  readonly displayName = 'Discord';
  readonly status = 'core' as const;
  readonly capabilities: Capabilities = caps({
    description: true, content: true, to: true, to_mode: 'none',
  });
  readonly configSchema: ConfigField[] = [
    field('url', 'Webhook URL', 'password', { required: true, secret: true, placeholder: 'https://discord.com/api/webhooks/…' }),
  ];

  validateConfig(cfg: ChannelConfig) { return validateFields(this.configSchema, cfg); }

  async send(cfg: ChannelConfig, msg: PushMessage): Promise<SendResult> {
    if (!cfg.url) return { success: false, message: '缺少 Webhook URL' };
    const text = [msg.title, msg.content ?? msg.description, msg.url]
      .filter(Boolean).join('\n');
    if (!text) return { success: false, message: '消息内容为空' };
    return withLatency(async () => {
      try {
        const r = await httpPostJson(cfg.url, { content: text.slice(0, 2000) });
        return r.status === 204 || r.status === 200
          ? { success: true, raw: r.body.slice(0, 500) || '(204 No Content)' }
          : { success: false, message: `Discord 返回 ${r.status}：${r.body.slice(0, 200)}`, raw: r.body.slice(0, 500) };
      } catch (e) {
        return { success: false, message: `Discord 发送失败：${(e as Error).message}` };
      }
    });
  }
}
