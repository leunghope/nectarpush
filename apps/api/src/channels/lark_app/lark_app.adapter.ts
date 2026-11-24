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
import { cacheKey, getCachedToken, putToken, invalidateToken } from '../token-cache';

const TOKEN_URL = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal';
const SEND_URL = 'https://open.feishu.cn/open-apis/im/v1/messages';

/** Feishu tenant_access_token error code meaning "token invalid": drop + refetch + retry. */
const INVALID_TOKEN_CODE = 99991663;

/** Feishu self-built app (飞书自建应用) — tenant_access_token + IM messages. */
export class LarkAppAdapter implements ChannelAdapter {
  readonly type = 'lark_app';
  readonly displayName = '飞书自建应用';
  readonly status = 'core' as const;
  readonly capabilities: Capabilities = caps({
    description: true, content: true, to: true, markdown: true, to_mode: '@mention',
  });
  readonly configSchema: ConfigField[] = [
    field('app_id', 'App ID', 'string', { required: true, secret: false }),
    field('secret', 'App Secret', 'password', { required: true, secret: true }),
    field('receive_id_type', '接收 ID 类型', 'select', {
      required: false,
      secret: false,
      default: 'chat_id',
      options: ['chat_id', 'open_id', 'user_id', 'union_id', 'email'],
    }),
    field('receive_id', '接收 ID', 'string', { required: true, secret: false }),
    field('msg_type', '消息类型', 'select', {
      required: false,
      secret: false,
      default: 'text',
      options: ['text', 'interactive'],
    }),
  ];

  validateConfig(cfg: ChannelConfig) { return validateFields(this.configSchema, cfg); }

  async send(cfg: ChannelConfig, msg: PushMessage, ctx: AdapterCtx): Promise<SendResult> {
    const missing = missingConfigMessage(this.configSchema, cfg);
    if (missing) return { success: false, message: missing };

    const receiveId = ctx.overrideTo?.trim() || cfg.receive_id?.trim();
    const receiveIdType = cfg.receive_id_type || 'chat_id';
    const msgType = cfg.msg_type || 'text';
    const key = cacheKey(this.type, cfg.app_id, cfg.secret);

    return withLatency(async () => {
      try {
        let token = getCachedToken(key);
        if (!token) {
          const got = await this.fetchToken(cfg);
          if (!got.ok) return { success: false, message: got.message };
          token = got.token;
          putToken(key, token, got.expiresIn);
        }
        const body = this.buildBody(msgType, msg, receiveId);
        const auth = (t: string) => ({ authorization: `Bearer ${t}` });

        const first = await httpPostJson(`${SEND_URL}?receive_id_type=${encodeURIComponent(receiveIdType)}`, body, auth(token));
        let code = (first.json as { code?: number })?.code;
        if (code !== 0 && code === INVALID_TOKEN_CODE) {
          invalidateToken(key);
          const got = await this.fetchToken(cfg);
          if (!got.ok) return { success: false, message: got.message };
          token = got.token;
          putToken(key, token, got.expiresIn);
          const retry = await httpPostJson(`${SEND_URL}?receive_id_type=${encodeURIComponent(receiveIdType)}`, body, auth(token));
          code = (retry.json as { code?: number })?.code;
          if (code === 0) return { success: true, raw: retry.body.slice(0, 500) };
          return {
            success: false,
            message: `飞书自建应用返回错误：${retry.body.slice(0, 200)}`,
            raw: retry.body.slice(0, 500),
          };
        }
        return code === 0
          ? { success: true, raw: first.body.slice(0, 500) }
          : { success: false, message: `飞书自建应用返回错误：${first.body.slice(0, 200)}`, raw: first.body.slice(0, 500) };
      } catch (e) {
        return { success: false, message: `飞书自建应用发送失败：${(e as Error).message}` };
      }
    });
  }

  private async fetchToken(
    cfg: ChannelConfig,
  ): Promise<{ ok: true; token: string; expiresIn: number } | { ok: false; expiresIn: 0; message: string }> {
    const r = await httpPostJson(TOKEN_URL, { app_id: cfg.app_id, app_secret: cfg.secret });
    const json = r.json as { code?: number; tenant_access_token?: string; expire?: number };
    if (json?.code !== 0) {
      return { ok: false, expiresIn: 0, message: `飞书自建应用获取令牌失败：${r.body.slice(0, 200)}` };
    }
    return { ok: true, token: json.tenant_access_token as string, expiresIn: json.expire ?? 7200 };
  }

  private buildBody(msgType: string, msg: PushMessage, receiveId: string): Record<string, unknown> {
    if (msgType === 'interactive') {
      const card: Record<string, unknown> = {
        config: { wide_screen_mode: true, enable_forward: true },
        elements: [{ tag: 'div', text: { tag: 'lark_md', content: renderText(msg) } }],
      };
      if (msg.title) {
        card.header = { title: { tag: 'plain_text', content: msg.title } };
      }
      return {
        receive_id: receiveId,
        msg_type: 'interactive',
        content: JSON.stringify(card),
      };
    }
    return {
      receive_id: receiveId,
      msg_type: 'text',
      content: JSON.stringify({ text: renderText(msg) }),
    };
  }
}
