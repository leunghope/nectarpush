import { createHmac } from 'node:crypto';
import { ChannelAdapter, ChannelConfig, PushMessage, SendResult, AdapterCtx, Capabilities, ConfigField } from '../adapter.interface';
import { caps, field, validateFields, httpPostJson, withLatency } from '../adapter.base';

export class DingAdapter implements ChannelAdapter {
  readonly type = 'ding';
  readonly displayName = '钉钉群机器人';
  readonly status = 'core' as const;
  readonly capabilities: Capabilities = caps({
    title: true, description: true, content: true, url: true, to: true,
    markdown: true, to_mode: '@mention',
  });
  readonly configSchema: ConfigField[] = [
    field('url', 'Webhook 地址', 'string', { required: true, secret: false, placeholder: 'https://oapi.dingtalk.com/robot/send?access_token=…' }),
    field('secret', '加签密钥', 'password', { required: false, secret: true, help: '安全设置选择“加签”时填 SEC 开头的密钥' }),
  ];

  validateConfig(cfg: ChannelConfig) { return validateFields(this.configSchema, cfg); }

  async send(cfg: ChannelConfig, msg: PushMessage, ctx: AdapterCtx): Promise<SendResult> {
    if (!cfg.url) return { success: false, message: '缺少 Webhook 地址' };
    const text = msg.content ?? msg.description ?? msg.title ?? '';
    if (!text) return { success: false, message: '消息内容为空' };
    const at = ctx.overrideTo?.trim() || '';
    const mentionAll = at === '@all';
    const mentionPhones = at && !mentionAll ? at.split(/[|,，]/).filter(Boolean) : [];
    const isMarkdown = Boolean(msg.content);
    const body = isMarkdown
      ? {
          msgtype: 'markdown',
          markdown: { title: msg.title || text.slice(0, 20), text: text + (msg.url ? `\n\n[查看详情](${msg.url})` : '') },
          at: { isAtAll: mentionAll, atMobiles: mentionPhones },
        }
      : {
          msgtype: 'text',
          text: { content: [msg.title, text].filter(Boolean).join('\n') },
          at: { isAtAll: mentionAll, atMobiles: mentionPhones },
        };
    const url = cfg.secret ? this.signedUrl(cfg.url, cfg.secret) : cfg.url;
    return withLatency(async () => {
      try {
        const r = await httpPostJson(url, body);
        const errcode = (r.json as { errcode?: number })?.errcode;
        return errcode === 0
          ? { success: true, raw: r.body.slice(0, 500) }
          : { success: false, message: `钉钉返回错误：${r.body.slice(0, 200)}`, raw: r.body.slice(0, 500) };
      } catch (e) {
        return { success: false, message: `钉钉发送失败：${(e as Error).message}` };
      }
    });
  }

  private signedUrl(url: string, secret: string): string {
    const ts = Date.now();
    const sign = createHmac('sha256', secret).update(`${ts}\n${secret}`).digest('base64');
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}timestamp=${ts}&sign=${encodeURIComponent(sign)}`;
  }
}
