import { Injectable } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { ChannelAdapter, ChannelConfig, PushMessage, SendResult, AdapterCtx, Capabilities, ConfigField } from '../adapter.interface';
import { caps, field, validateFields, withLatency } from '../adapter.base';
import { getSmtpOptions } from '../../common/smtp-state';

/** Email channel — bound address by default, optional override when permitted. */
@Injectable()
export class EmailAdapter implements ChannelAdapter {
  readonly type = 'email';
  readonly displayName = '邮件';
  readonly status = 'core' as const;
  readonly capabilities: Capabilities = caps({
    title: true, description: true, content: true, to: true, markdown: true,
    to_mode: 'recipient',
  });
  readonly configSchema: ConfigField[] = [
    field('account_id', '收件邮箱', 'string', { required: true, secret: false, placeholder: 'you@example.com' }),
  ];

  validateConfig(cfg: ChannelConfig) {
    const r = validateFields(this.configSchema, cfg);
    if (cfg.account_id && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cfg.account_id)) {
      r.errors.account_id = '邮箱格式不正确';
      r.valid = false;
    }
    return r;
  }

  async send(cfg: ChannelConfig, msg: PushMessage, ctx: AdapterCtx): Promise<SendResult> {
    const to = ctx.overrideTo?.trim() || cfg.account_id;
    if (!to) return { success: false, message: '未配置收件邮箱' };
    const isOther = to !== cfg.account_id;
    if (isOther && !ctx.allowSendEmailToOthers) {
      return { success: false, message: '管理员未允许向他人邮箱发送邮件' };
    }
    const smtp = getSmtpOptions();
    if (!smtp?.host) return { success: false, message: '邮件服务未配置' };
    const transport = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.port === 465,
      auth: { user: smtp.account, pass: smtp.token },
      connectionTimeout: 10_000,
    });
    const subject = msg.title || 'NectarPush 消息';
    let text = msg.content ?? msg.description ?? '';
    if (msg.renderMode === 'code' && text) text = '```\n' + text + '\n```';
    if (msg.url) text += (text ? '\n\n' : '') + msg.url;
    return withLatency(async () => {
      try {
        const info = await transport.sendMail({ from: smtp.account, to, subject, text });
        return { success: true, raw: typeof info.response === 'string' ? info.response.slice(0, 500) : undefined };
      } catch (e) {
        return { success: false, message: `邮件发送失败：${(e as Error).message}` };
      }
    });
  }
}
