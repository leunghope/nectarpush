import { ChannelAdapter, ChannelConfig, PushMessage, SendResult, AdapterCtx, Capabilities, ConfigField } from '../adapter.interface';
import { caps, field, validateFields, httpPostJson, withLatency } from '../adapter.base';

export class TelegramAdapter implements ChannelAdapter {
  readonly type = 'telegram';
  readonly displayName = 'Telegram';
  readonly status = 'core' as const;
  readonly capabilities: Capabilities = caps({
    description: true, content: true, to: true, to_mode: 'chat',
  });
  readonly configSchema: ConfigField[] = [
    field('secret', 'Bot Token', 'password', { required: true, secret: true, placeholder: '123456:AAH…' }),
    field('account_id', 'Chat ID', 'string', { required: true, secret: false }),
  ];

  validateConfig(cfg: ChannelConfig) { return validateFields(this.configSchema, cfg); }

  async send(cfg: ChannelConfig, msg: PushMessage, ctx: AdapterCtx): Promise<SendResult> {
    const chatId = ctx.overrideTo?.trim() || cfg.account_id;
    if (!cfg.secret || !chatId) return { success: false, message: '缺少 Bot Token 或 Chat ID' };
    const text = [msg.title, msg.content ?? msg.description, msg.url]
      .filter(Boolean).join('\n');
    if (!text) return { success: false, message: '消息内容为空' };
    return withLatency(async () => {
      try {
        const r = await httpPostJson(`https://api.telegram.org/bot${cfg.secret}/sendMessage`, {
          chat_id: chatId, text,
        });
        const ok = r.status === 200 && (r.json as { ok?: boolean })?.ok === true;
        return ok
          ? { success: true, raw: r.body.slice(0, 500) }
          : { success: false, message: `Telegram 返回错误：${r.body.slice(0, 200)}`, raw: r.body.slice(0, 500) };
      } catch (e) {
        return { success: false, message: `Telegram 发送失败：${(e as Error).message}` };
      }
    });
  }
}
