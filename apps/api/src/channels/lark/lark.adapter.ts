import { createHmac } from 'node:crypto';
import { ChannelAdapter, ChannelConfig, PushMessage, SendResult, AdapterCtx, Capabilities, ConfigField } from '../adapter.interface';
import { caps, field, validateFields, httpPostJson, withLatency } from '../adapter.base';

export class LarkAdapter implements ChannelAdapter {
  readonly type = 'lark';
  readonly displayName = '飞书群机器人';
  readonly status = 'core' as const;
  readonly capabilities: Capabilities = caps({
    description: true, content: true, to: true, markdown: true, to_mode: 'none',
  });
  readonly configSchema: ConfigField[] = [
    field('url', 'Webhook 地址', 'string', { required: true, secret: false, placeholder: 'https://open.feishu.cn/open-apis/bot/v2/…' }),
    field('secret', '签名密钥', 'password', { required: false, secret: true }),
  ];

  validateConfig(cfg: ChannelConfig) { return validateFields(this.configSchema, cfg); }

  async send(cfg: ChannelConfig, msg: PushMessage): Promise<SendResult> {
    if (!cfg.url) return { success: false, message: '缺少 Webhook 地址' };
    const text = [msg.title, msg.content ?? msg.description].filter(Boolean).join('\n');
    if (!text) return { success: false, message: '消息内容为空' };
    const body: Record<string, unknown> = msg.content
      ? {
          msg_type: 'interactive',
          // Feishu custom-bot card payload: the card object is a top-level
          // `card` field. Wrapping it in `content` (the IM OpenAPI string form)
          // is rejected with 19002 "params error, unknown card value".
          card: {
            config: { wide_screen_mode: true },
            elements: [
              { tag: 'div', text: { tag: 'lark_md', content: text + (msg.url ? `\n[查看详情](${msg.url})` : '') } },
            ],
          },
        }
      : { msg_type: 'text', content: { text } };
    if (cfg.secret) {
      const ts = Math.floor(Date.now() / 1000).toString();
      const sign = createHmac('sha256', `${ts}\n${cfg.secret}`).update('').digest('base64');
      body.timestamp = ts;
      body.sign = sign;
    }
    return withLatency(async () => {
      try {
        const r = await httpPostJson(cfg.url, body);
        const code = (r.json as { code?: number; StatusCode?: number })?.code
          ?? (r.json as { StatusCode?: number })?.StatusCode;
        return code === 0 || code === undefined && r.status === 200
          ? { success: true, raw: r.body.slice(0, 500) }
          : { success: false, message: `飞书返回错误：${r.body.slice(0, 200)}`, raw: r.body.slice(0, 500) };
      } catch (e) {
        return { success: false, message: `飞书发送失败：${(e as Error).message}` };
      }
    });
  }
}
