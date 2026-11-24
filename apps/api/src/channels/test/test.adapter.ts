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

const TOKEN_URL = 'https://api.weixin.qq.com/cgi-bin/token';
const SEND_URL = 'https://api.weixin.qq.com/cgi-bin/message/template/send';

/** WeChat access-token error codes that mean "token gone": drop + refetch + retry. */
const INVALID_TOKEN_CODES = new Set([40001, 40014, 42001]);

/** WeChat test account (微信测试号) — template message, token + template_id. */
export class TestWechatAdapter implements ChannelAdapter {
  readonly type = 'test';
  readonly displayName = '微信测试号';
  readonly status = 'core' as const;
  readonly capabilities: Capabilities = caps({
    title: true, description: true, content: true, url: true, to: true,
    markdown: true, to_mode: 'recipient',
  });
  readonly configSchema: ConfigField[] = [
    field('app_id', 'AppID', 'string', { required: true, secret: false }),
    field('secret', 'AppSecret', 'password', { required: true, secret: true }),
    field('account_id', '接收者 OpenID', 'string', { required: true, secret: false }),
    field('template_id', '模板 ID', 'string', {
      required: true,
      secret: false,
      help: '微信后台「模板消息」里复制的模板 ID',
    }),
  ];

  validateConfig(cfg: ChannelConfig) { return validateFields(this.configSchema, cfg); }

  async send(cfg: ChannelConfig, msg: PushMessage, ctx: AdapterCtx): Promise<SendResult> {
    const missing = missingConfigMessage(this.configSchema, cfg);
    if (missing) return { success: false, message: missing };

    const toUser = ctx.overrideTo?.trim() || cfg.account_id?.trim();
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
        const body: Record<string, unknown> = {
          touser: toUser,
          template_id: cfg.template_id,
          data: {
            title: { value: msg.title || '' },
            description: { value: msg.description || '' },
            content: { value: msg.content || '' },
            text: { value: renderText(msg) },
          },
        };
        if (msg.url) body.url = msg.url;

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
            message: `微信测试号返回错误：${retry.body.slice(0, 200)}`,
            raw: retry.body.slice(0, 500),
          };
        }
        return errcode === 0
          ? { success: true, raw: first.body.slice(0, 500) }
          : { success: false, message: `微信测试号返回错误：${first.body.slice(0, 200)}`, raw: first.body.slice(0, 500) };
      } catch (e) {
        return { success: false, message: `微信测试号发送失败：${(e as Error).message}` };
      }
    });
  }

  private async fetchToken(
    cfg: ChannelConfig,
  ): Promise<{ ok: true; token: string; expiresIn: number } | { ok: false; expiresIn: 0; message: string }> {
    const url = `${TOKEN_URL}?grant_type=client_credential&appid=${encodeURIComponent(cfg.app_id)}&secret=${encodeURIComponent(cfg.secret)}`;
    const r = await httpGetJson(url);
    const json = r.json as { errcode?: number; expires_in?: number; access_token?: string };
    if (json?.errcode !== 0) {
      return { ok: false, expiresIn: 0, message: `微信测试号获取令牌失败：${JSON.stringify(r.json).slice(0, 200)}` };
    }
    return { ok: true, token: json.access_token as string, expiresIn: json.expires_in ?? 7200 };
  }
}
