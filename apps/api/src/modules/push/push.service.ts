import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OptionsService } from '../options/options.service';
import { ChannelsService } from '../channels/channels.service';
import { DeliveryService } from './delivery.service';
import { ApiError } from '../../common/errors';
import { decrypt } from '../../common/crypto';
import { consumeRateLimit } from '../../common/rate-limit';
import type { PushMessage } from '../../channels/adapter.interface';

/** 与 email.adapter validateConfig 一致的邮箱格式判定（D-08 收件人识别）。 */
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export interface PushInput {
  title?: string;
  description?: string;
  short?: string;
  content?: string;
  desp?: string;
  url?: string;
  channel?: string;
  token?: string;
  to?: string;
  openid?: string;
  async?: string;
  render_mode?: string;
}

@Injectable()
export class PushService {
  /** D-08 审计：记录向他人邮箱发信的发送者/收件人/通道/时间与结果。 */
  private readonly audit = new Logger('EmailAudit');

  constructor(
    private readonly prisma: PrismaService,
    private readonly options: OptionsService,
    private readonly delivery: DeliveryService,
    private readonly channels: ChannelsService,
  ) {}

  /** External push: /push/:username. Token semantics per FEATURE_MATRIX F. */
  async push(username: string, input: PushInput): Promise<{ success: boolean; message: string; data: { uuid: string } }> {
    const user = await this.prisma.user.findFirst({ where: { username, deletedAt: null } });
    if (!user) throw new ApiError('USER_NOT_FOUND', '用户不存在');
    if (user.status === 'disabled') throw new ApiError('USER_DISABLED', '用户已被封禁');

    // async is a request-level capability check: it depends only on the
    // user's persistence permission, so it is validated before channel
    // resolution (a user without channels still gets the precise code).
    if (input.async === 'true' && !(user.allowSaveMessage && this.options.getBool('MessagePersistenceEnabled'))) {
      throw new ApiError('ASYNC_NOT_ALLOWED', '异步发送消息需要用户具备消息持久化的权限');
    }

    const description = input.description ?? input.short;
    const content = input.content ?? input.desp;
    const to = input.to ?? input.openid ?? '';

    const channelName = input.channel?.trim() || user.defaultChannel || 'email';

    // Resolve target channel (for channel-level token check).
    const channelRow = await this.prisma.channel.findFirst({
      where: { ownerId: user.id, name: channelName },
    });
    if (!channelRow && !to) {
      throw new ApiError('CHANNEL_NOT_FOUND', `无效的渠道名称：${channelName}`);
    }

    // Two-level token: required when either user token or channel token is set.
    const userToken = user.accessToken ? decrypt(user.accessToken) : null;
    const channelToken = channelRow?.accessToken ? decrypt(channelRow.accessToken) : null;
    const required = Boolean(userToken || channelToken);
    const provided = input.token?.trim() || '';
    if (required && !provided) {
      throw new ApiError('TOKEN_REQUIRED', '通道维度或用户维度设置了鉴权令牌，需要提供鉴权令牌');
    }
    if (required && provided !== userToken && provided !== channelToken) {
      throw new ApiError('INVALID_TOKEN', '无效的 token');
    }

    const renderMode = this.normalizeRenderMode(input.render_mode);
    const isAsync = input.async === 'true';

    // D-08 收件人模式：目标通道为 email 且 to 为邮箱地址时，to 作为收件人
    // （overrideTo），通道选择即 channel/默认通道；其余情况 to 仍是通道选择器。
    // 门控与限流在发送前执行，返回规范错误信封，不依赖适配器 success:false。
    let overrideTo: string | undefined;
    let effectiveTo = to || channelName;
    const trimmedTo = to.trim();
    if (trimmedTo && EMAIL_RE.test(trimmedTo) && channelRow?.type === 'email') {
      overrideTo = trimmedTo;
      effectiveTo = channelName;
      const bound = (this.channels.decryptConfig(channelRow.config).account_id ?? '').trim();
      const isOther = overrideTo !== bound;
      const now = () => new Date().toISOString();
      if (isOther && !user.allowSendEmailToOthers) {
        this.audit.warn(
          `deny sender=${user.username}#${user.id} recipient=${overrideTo} channel=${channelName} reason=permission time=${now()}`,
        );
        throw new ApiError('FORBIDDEN', '管理员未允许向他人邮箱发送邮件');
      }
      if (isOther) {
        // 更严限流：按发送者（而非 IP）计桶，防获授权账号滥发。
        const retryAfter = consumeRateLimit('emailToOthers', `user:${user.id}`);
        if (retryAfter !== null) {
          this.audit.warn(
            `deny sender=${user.username}#${user.id} recipient=${overrideTo} channel=${channelName} reason=rate_limited retry_after=${retryAfter}s time=${now()}`,
          );
          throw new ApiError('RATE_LIMITED', `向他人邮箱发信过于频繁，请 ${retryAfter} 秒后再试`);
        }
      }
      this.audit.log(
        `send sender=${user.username}#${user.id} recipient=${overrideTo} channel=${channelName} to_others=${isOther} time=${now()}`,
      );
    }

    const message: PushMessage = {
      ...(input.title ? { title: input.title } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(content !== undefined ? { content } : {}),
      ...(input.url ? { url: input.url } : {}),
      renderMode,
    };

    const outcome = await this.delivery.send({
      ownerId: user.id,
      username: user.username,
      allowSendEmailToOthers: user.allowSendEmailToOthers,
      allowSaveMessage: user.allowSaveMessage,
      message,
      to: effectiveTo,
      overrideTo,
      async: isAsync,
      persist: user.allowSaveMessage && this.options.getBool('MessagePersistenceEnabled'),
    });

    if (overrideTo) {
      this.audit.log(
        `result sender=${user.username}#${user.id} recipient=${overrideTo} channel=${channelName} status=${outcome.status} time=${new Date().toISOString()}`,
      );
    }

    return {
      success: outcome.status !== 'failed',
      message: outcome.message,
      data: { uuid: outcome.uuid },
    };
  }

  private normalizeRenderMode(mode?: string): 'markdown' | 'code' | 'raw' {
    if (mode === 'code' || mode === 'raw') return mode;
    return 'markdown';
  }
}
