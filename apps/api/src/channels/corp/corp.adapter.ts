import {
  ChannelAdapter,
  ChannelConfig,
  PushMessage,
  SendResult,
  Capabilities,
  ConfigField,
} from '../adapter.interface';
import { caps, field, validateFields, httpPostJson, renderText, withLatency, missingConfigMessage } from '../adapter.base';

/** WeCom (企业微信) group robot — webhook URL, no token. */
export class CorpAdapter implements ChannelAdapter {
  readonly type = 'corp';
  readonly displayName = '企业微信群机器人';
  readonly status = 'core' as const;
  readonly capabilities: Capabilities = caps({
    description: true, content: true, url: true, to: true, markdown: true,
    to_mode: '@mention',
  });
  readonly configSchema: ConfigField[] = [
    field('url', 'Webhook 地址', 'string', {
      required: true,
      secret: false,
      placeholder: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…',
    }),
    field('mentioned', '@ 成员', 'string', {
      required: false,
      secret: false,
      help: '要 @ 的成员 userid，多个用 | 分隔，@all 表示全员；企微 markdown 不支持 @，填写后将自动改用 text 消息',
    }),
  ];

  validateConfig(cfg: ChannelConfig) { return validateFields(this.configSchema, cfg); }

  async send(cfg: ChannelConfig, msg: PushMessage): Promise<SendResult> {
    const missing = missingConfigMessage(this.configSchema, cfg);
    if (missing) return { success: false, message: missing };

    const text = renderText(msg);
    const mentioned = cfg.mentioned?.trim();
    const mentionedList = mentioned
      ? mentioned.split('|').map((s) => s.trim()).filter(Boolean)
      : [];
    // WeCom markdown cannot mention anyone: with a mention list we downgrade to
    // text + mentioned_list (a deliberate behavioural difference vs `ding`).
    const body = mentionedList.length
      ? { msgtype: 'text', text: { content: text, mentioned_list: mentionedList } }
      : { msgtype: 'markdown', markdown: { content: text } };

    return withLatency(async () => {
      try {
        const r = await httpPostJson(cfg.url, body);
        const errcode = (r.json as { errcode?: number })?.errcode;
        return errcode === 0
          ? { success: true, raw: r.body.slice(0, 500) }
          : { success: false, message: `企业微信群机器人返回错误：${r.body.slice(0, 200)}`, raw: r.body.slice(0, 500) };
      } catch (e) {
        return { success: false, message: `企业微信群机器人发送失败：${(e as Error).message}` };
      }
    });
  }
}
