import {
  ChannelAdapter,
  ChannelConfig,
  PushMessage,
  SendResult,
  AdapterCtx,
  Capabilities,
  ConfigField,
} from '../adapter.interface';
import { caps, field, validateFields, httpGetJson, httpPostJson, renderText, withLatency, missingConfigMessage } from '../adapter.base';
import { cacheKey, getCachedToken, putToken, invalidateToken } from '../token-cache';

const TOKEN_URL = 'https://qyapi.weixin.qq.com/cgi-bin/gettoken';
const SEND_URL = 'https://qyapi.weixin.qq.com/cgi-bin/message/send';

/** WeCom access-token error codes that mean "token gone": drop + refetch + retry. */
const INVALID_TOKEN_CODES = new Set([40001, 40014, 42001]);

/** WeCom application account (企业微信应用号) — token + message/send. */
export class CorpAppAdapter implements ChannelAdapter {
  readonly type = 'corp_app';
  readonly displayName = '企业微信应用号';
  readonly status = 'core' as const;
  readonly capabilities: Capabilities = caps({
    title: true, description: true, content: true, url: true, to: true,
    markdown: true, to_mode: '@mention',
  });
  readonly configSchema: ConfigField[] = [
    field('app_id', 'CorpID', 'string', { required: true, secret: false }),
    field('secret', 'CorpSecret', 'password', { required: true, secret: true }),
    field('account_id', 'AgentID', 'string', { required: true, secret: false }),
    field('to_user', '接收成员', 'string', {
      required: false,
      secret: false,
      default: '@all',
      help: '成员账号，多人用 | 分隔，@all 表示全员',
    }),
    field('msg_type', '消息类型', 'select', {
      required: false,
      secret: false,
      default: 'markdown',
      options: ['markdown', 'text', 'textcard'],
    }),
  ];

  validateConfig(cfg: ChannelConfig) { return validateFields(this.configSchema, cfg); }

  async send(cfg: ChannelConfig, msg: PushMessage, ctx: AdapterCtx): Promise<SendResult> {
    const missing = missingConfigMessage(this.configSchema, cfg);
    if (missing) return { success: false, message: missing };

    const toUser = ctx.overrideTo?.trim() || cfg.to_user?.trim() || '@all';
    const agentId = Number(cfg.account_id);
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
        const body = this.buildBody(cfg.msg_type || 'markdown', msg, toUser, agentId);
        const first = await httpPostJson(`${SEND_URL}?access_token=${token}`, body);
        let errcode = (first.json as { errcode?: number })?.errcode;
        if (errcode !== 0 && errcode !== undefined && INVALID_TOKEN_CODES.has(errcode)) {
          invalidateToken(key);
          const got = await this.fetchToken(cfg);
          if (!got.ok) return { success: false, message: got.message };
          token = got.token;
          putToken(key, token, got.expiresIn);
          const retry = await httpPostJson(`${SEND_URL}?access_token=${token}`, body);
          errcode = (retry.json as { errcode?: number })?.errcode;
          if (errcode === 0) return { success: true, raw: retry.body.slice(0, 500) };
          return {
            success: false,
            message: `企业微信应用号返回错误：${retry.body.slice(0, 200)}`,
            raw: retry.body.slice(0, 500),
          };
        }
        return errcode === 0
          ? { success: true, raw: first.body.slice(0, 500) }
          : { success: false, message: `企业微信应用号返回错误：${first.body.slice(0, 200)}`, raw: first.body.slice(0, 500) };
      } catch (e) {
        return { success: false, message: `企业微信应用号发送失败：${(e as Error).message}` };
      }
    });
  }

  private async fetchToken(
    cfg: ChannelConfig,
  ): Promise<{ ok: true; token: string; expiresIn: number } | { ok: false; expiresIn: 0; message: string }> {
    const r = await httpGetJson(
      `${TOKEN_URL}?corpid=${encodeURIComponent(cfg.app_id)}&corpsecret=${encodeURIComponent(cfg.secret)}`,
    );
    const json = r.json as { errcode?: number; expires_in?: number; access_token?: string };
    if (json?.errcode !== 0) {
      return { ok: false, expiresIn: 0, message: `企业微信应用号获取令牌失败：${r.json == null ? '无响应体' : JSON.stringify(r.json).slice(0, 200)}` };
    }
    return {
      ok: true,
      token: json.access_token as string,
      expiresIn: json.expires_in ?? 7200,
    };
  }

  private buildBody(
    msgType: string,
    msg: PushMessage,
    toUser: string,
    agentId: number,
  ): Record<string, unknown> {
    if (msgType === 'textcard') {
      return {
        touser: toUser,
        agentid: agentId,
        msgtype: 'textcard',
        textcard: {
          title: msg.title || 'NectarPush',
          description: [msg.description, msg.content, msg.url].filter(Boolean).join('\n'),
          url: msg.url || '',
        },
      };
    }
    if (msgType === 'text') {
      return { touser: toUser, agentid: agentId, msgtype: 'text', text: { content: renderText(msg) } };
    }
    return { touser: toUser, agentid: agentId, msgtype: 'markdown', markdown: { content: renderText(msg) } };
  }
}
