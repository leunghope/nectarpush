import {
  ChannelAdapter,
  ChannelConfig,
  PushMessage,
  SendResult,
  AdapterCtx,
  Capabilities,
  ConfigField,
} from '../adapter.interface';
import { caps, field, validateFields, httpPostJson, renderText, withLatency, missingConfigMessage } from '../adapter.base';

/** QQ OneBot protocol (v11) — POST <url>/send_msg with an optional access token. */
export class OneBotAdapter implements ChannelAdapter {
  readonly type = 'one_bot';
  readonly displayName = 'QQ（OneBot）';
  readonly status = 'core' as const;
  readonly capabilities: Capabilities = caps({
    content: true, to: true, to_mode: 'chat',
  });
  readonly configSchema: ConfigField[] = [
    field('url', 'OneBot 服务地址', 'string', {
      required: true,
      secret: false,
      placeholder: 'http://127.0.0.1:8080',
      help: 'OneBot 实现（如 NapCat / go-cqhttp）的 HTTP 服务地址，无需带 /send_msg 后缀',
    }),
    field('secret', 'Access Token', 'password', { required: false, secret: true }),
    field('account_id', 'QQ 号 / 群号', 'string', { required: true, secret: false }),
    field('target_type', '目标类型', 'select', {
      required: false,
      secret: false,
      default: 'private',
      options: ['private', 'group'],
      help: '私聊填 QQ 号，群聊填群号；message_type 会随此自动切换',
    }),
  ];

  validateConfig(cfg: ChannelConfig) { return validateFields(this.configSchema, cfg); }

  async send(cfg: ChannelConfig, msg: PushMessage, ctx: AdapterCtx): Promise<SendResult> {
    const missing = missingConfigMessage(this.configSchema, cfg);
    if (missing) return { success: false, message: missing };

    const accountId = ctx.overrideTo?.trim() || cfg.account_id?.trim();
    const isGroup = cfg.target_type === 'group';
    const base = cfg.url.replace(/\/+$/, '');
    const url = base.endsWith('/send_msg') ? base : `${base}/send_msg`;
    const headers: Record<string, string> = cfg.secret ? { authorization: `Bearer ${cfg.secret}` } : {};
    const body = isGroup
      ? { message_type: 'group', group_id: Number(accountId), message: renderText(msg), auto_escape: false }
      : { message_type: 'private', user_id: accountId, message: renderText(msg), auto_escape: false };

    return withLatency(async () => {
      try {
        const r = await httpPostJson(url, body, headers);
        const retcode = (r.json as { retcode?: number })?.retcode;
        const wording = (r.json as { message?: string; wording?: string })?.message
          ?? (r.json as { wording?: string })?.wording;
        if (r.status === 200 && retcode === 0) {
          return { success: true, raw: r.body.slice(0, 500) };
        }
        const detail = wording ?? r.body.slice(0, 200);
        return { success: false, message: `QQ（OneBot）返回错误：${detail}`, raw: r.body.slice(0, 500) };
      } catch (e) {
        return { success: false, message: `QQ（OneBot）发送失败：${(e as Error).message}` };
      }
    });
  }
}
