import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OptionsService } from '../options/options.service';
import { ChannelsService } from '../channels/channels.service';
import { getAdapter } from '../../channels/registry';
import { sseBroadcast } from '../../realtime/sse-hub';
import { ApiError } from '../../common/errors';
import { randomToken } from '../../common/crypto';
import type { AdapterCtx, PushMessage } from '../../channels/adapter.interface';
import { Channel } from '@prisma/client';

export interface SendParams {
  ownerId: number;
  username: string;
  allowSendEmailToOthers: boolean;
  allowSaveMessage: boolean;
  message: PushMessage;
  /** channel name, '@all', or 'a|b' */
  to: string;
  /**
   * Recipient override for recipient-mode channels (D-08: email push to an
   * explicit mailbox). When set, it is passed to the adapter as ctx.overrideTo
   * and recorded as the message's `to` for display/audit.
   */
  overrideTo?: string;
  async: boolean;
  persist: boolean;
}

export interface SendOutcome {
  uuid: string;
  status: 'pending' | 'async_pending' | 'success' | 'partial' | 'failed';
  message: string;
}

interface DeliveryOutcome {
  channelId: number | null;
  channelName: string;
  status: 'success' | 'failed';
  partial: boolean;
  latencyMs: number;
  error: string | null;
}

@Injectable()
export class DeliveryService {
  private readonly logger = new Logger('Delivery');

  constructor(
    private readonly prisma: PrismaService,
    private readonly options: OptionsService,
    private readonly channels: ChannelsService,
  ) {}

  /** Full pipeline: resolve targets -> persist -> deliver -> aggregate -> SSE. */
  async send(params: SendParams): Promise<SendOutcome> {
    const targets = await this.resolveTargets(params.ownerId, params.to);
    const persist = this.canPersist(params);

    if (params.async && !persist) {
      throw new ApiError('ASYNC_NOT_ALLOWED', '异步发送消息需要用户具备消息持久化的权限');
    }

    const uuid = persist ? randomToken(16) : 'unsaved';
    const primary = targets[0];

    const messageRow = persist
      ? await this.prisma.message.create({
          data: {
            ownerId: params.ownerId,
            uuid,
            title: params.message.title ?? null,
            description: params.message.description ?? null,
            content: params.message.content ?? null,
            url: params.message.url ?? null,
            channelName: primary?.name ?? params.to,
            channelType: primary?.type ?? 'none',
            to: params.overrideTo ?? params.to,
            renderMode: params.message.renderMode ?? 'markdown',
            status: params.async ? 'async_pending' : 'pending',
            channelId: primary?.id ?? null,
          },
        })
      : null;
    if (messageRow) {
      sseBroadcast(
        {
          event: 'message.created',
          data: this.summaryOf(messageRow),
        },
        params.ownerId,
      );
    }

    if (params.async) {
      // Fire-and-forget for the HTTP response, but the persisted Message must
      // converge once delivery settles (AC-044): async_pending -> success/
      // partial/failed. Without the write-back the row stayed async_pending
      // forever even when every delivery succeeded (defect Q-03).
      void this.deliverAll(params, targets, messageRow?.id ?? null, uuid)
        .then((outcomes) => this.convergeAsync(messageRow?.id ?? null, outcomes))
        .catch((e) => {
          this.logger.error(`async deliver failed: ${(e as Error).message}`);
          return this.convergeAsync(messageRow?.id ?? null, null);
        });
      return { uuid, status: 'async_pending', message: '' };
    }

    const outcomes = await this.deliverAll(params, targets, messageRow?.id ?? null, uuid);
    const status = this.aggregate(outcomes);
    if (messageRow) {
      await this.prisma.message.update({ where: { id: messageRow.id }, data: { status } });
    }
    const failMsg = outcomes.find((o) => o.status === 'failed')?.error ?? '';
    return { uuid, status, message: status === 'failed' ? failMsg : '' };
  }

  /**
   * Persist the final status of an asynchronous send. `outcomes === null` means
   * the background pipeline threw, which must surface as `failed` rather than
   * leaving the row stuck in `async_pending`.
   */
  private async convergeAsync(
    messageId: number | null,
    outcomes: DeliveryOutcome[] | null,
  ): Promise<void> {
    if (messageId === null) return;
    const status = outcomes === null ? 'failed' : this.aggregate(outcomes);
    try {
      await this.prisma.message.update({ where: { id: messageId }, data: { status } });
    } catch (e) {
      this.logger.error(`async status write-back failed: ${(e as Error).message}`);
    }
  }

  /** Deliver to a single channel for the test endpoint (no persistence). */
  async testChannel(
    channel: Channel,
    overrideTo?: string,
  ): Promise<{ success: boolean; message: string; latency_ms: number | null; raw: string | null }> {
    const adapter = getAdapter(channel.type);
    if (!adapter) return { success: false, message: `不支持的通道类型：${channel.type}`, latency_ms: null, raw: null };
    const owner = await this.prisma.user.findUnique({ where: { id: channel.ownerId } });
    const cfg = this.channels.decryptConfig(channel.config);
    const result = await adapter.send(cfg, {
      title: 'NectarPush 测试消息',
      description: '这是一条测试消息，如果你看到了说明通道配置正确',
      renderMode: 'markdown',
    }, {
      userId: channel.ownerId,
      username: owner?.username ?? '',
      allowSendEmailToOthers: owner?.allowSendEmailToOthers ?? false,
      channelName: channel.name,
      overrideTo,
    });
    return {
      success: result.success,
      message: result.message ?? '',
      latency_ms: result.latencyMs ?? null,
      raw: result.raw ?? null,
    };
  }

  private async resolveTargets(ownerId: number, to: string): Promise<Channel[]> {
    const all = await this.prisma.channel.findMany({ where: { ownerId }, orderBy: { id: 'asc' } });
    if (to === '@all') {
      const enabled = all.filter((c) => c.enabled);
      if (enabled.length === 0) throw new ApiError('CHANNEL_NOT_FOUND', '没有启用的渠道');
      return enabled;
    }
    const names = to.split('|').map((s) => s.trim()).filter(Boolean);
    const picked: Channel[] = [];
    for (const name of names) {
      const ch = all.find((c) => c.name === name);
      if (!ch) throw new ApiError('CHANNEL_NOT_FOUND', `无效的渠道名称：${name}`);
      if (!ch.enabled) throw new ApiError('CHANNEL_DISABLED', `渠道 ${name} 已被禁用`);
      picked.push(ch);
    }
    return picked;
  }

  private async deliverAll(
    params: SendParams,
    targets: Channel[],
    messageId: number | null,
    uuid: string,
  ): Promise<DeliveryOutcome[]> {
    const outcomes: DeliveryOutcome[] = [];
    for (const ch of targets) {
      const outcome = await this.deliverOne(params, ch, messageId, uuid);
      outcomes.push(outcome);
    }
    return outcomes;
  }

  private async deliverOne(
    params: SendParams,
    channel: Channel,
    messageId: number | null,
    uuid: string,
  ): Promise<DeliveryOutcome> {
    const started = Date.now();
    let partialFlag = false;
    const deliveryRow = messageId
      ? await this.prisma.messageDelivery.create({
          data: { messageId, channelId: channel.id, channelName: channel.name, status: 'pending' },
        })
      : null;

    let status: 'success' | 'failed' = 'failed';
    let error: string | null = null;

    const childIds = channel.type === 'group'
      ? (this.channels.decryptConfig(channel.config).other ?? '')
          .split(',').map((s) => s.trim()).filter(Boolean).map(Number)
      : [];

    if (childIds.length > 0) {
      // group fan-out: single delivery row aggregating child channels
      const children = await this.prisma.channel.findMany({
        where: { id: { in: childIds }, ownerId: params.ownerId },
      });
      const results: Array<{ ok: boolean; err?: string }> = [];
      for (const child of children) {
        const r = await this.sendViaAdapter(params, child, uuid);
        results.push(r);
      }
      const okCount = results.filter((r) => r.ok).length;
      const partial = okCount > 0 && okCount < children.length;
      status = okCount > 0 ? 'success' : 'failed';
      if (partial) {
        error = `群组部分子通道失败：${results.filter((r) => !r.ok).map((r) => r.err).join('；')}`.slice(0, 500) || null;
      }
      partialFlag = partial;
    } else {
      const r = await this.sendViaAdapter(params, channel, uuid);
      status = r.ok ? 'success' : 'failed';
      error = r.ok ? null : (r.err ?? '发送失败');
    }

    const latencyMs = Date.now() - started;
    if (deliveryRow) {
      const updated = await this.prisma.messageDelivery.update({
        where: { id: deliveryRow.id },
        data: { status, latencyMs, error },
      });
      sseBroadcast(
        { event: 'delivery.updated', data: this.deliveryView(updated, messageId) },
        params.ownerId,
      );
    }
    return { channelId: channel.id, channelName: channel.name, status, partial: partialFlag, latencyMs, error };
  }

  private async sendViaAdapter(
    params: SendParams,
    channel: Channel,
    _uuid: string,
  ): Promise<{ ok: boolean; err?: string }> {
    const adapter = getAdapter(channel.type);
    if (!adapter) return { ok: false, err: `不支持的通道类型：${channel.type}` };
    if (!channel.enabled) return { ok: false, err: `渠道 ${channel.name} 已被禁用` };
    const cfg = this.channels.decryptConfig(channel.config);
    const ctx: AdapterCtx = {
      userId: params.ownerId,
      username: params.username,
      allowSendEmailToOthers: params.allowSendEmailToOthers,
      channelName: channel.name,
      overrideTo: params.overrideTo,
    };
    try {
      const r = await adapter.send(cfg, params.message, ctx);
      return { ok: r.success, err: r.message };
    } catch (e) {
      this.logger.warn(`adapter ${channel.type} threw: ${(e as Error).message}`);
      return { ok: false, err: (e as Error).message };
    }
  }

  private canPersist(params: SendParams): boolean {
    if (!params.allowSaveMessage) return false;
    return this.options.getBool('MessagePersistenceEnabled');
  }

  private aggregate(outcomes: DeliveryOutcome[]): 'success' | 'partial' | 'failed' {
    if (outcomes.length === 0) return 'failed';
    const ok = outcomes.filter((o) => o.status === 'success' && !o.partial).length;
    const partial = outcomes.some((o) => o.partial);
    if (ok === outcomes.length && !partial) return 'success';
    if (ok > 0 || partial) return 'partial';
    return 'failed';
  }

  private summaryOf(row: { id: number; uuid: string; title: string | null; channelName: string; channelType: string; to: string | null; status: string; createdAt: Date }) {
    return {
      id: row.id,
      uuid: row.uuid,
      title: row.title,
      channel_name: row.channelName,
      channel_type: row.channelType,
      to: row.to,
      status: row.status,
      created_at: row.createdAt.toISOString(),
    };
  }

  private deliveryView(row: { id: number; channelId: number | null; channelName: string; status: string; latencyMs: number | null; error: string | null; createdAt: Date }, messageId: number | null) {
    return {
      id: row.id,
      message_id: messageId,
      channel_id: row.channelId,
      channel_name: row.channelName,
      status: row.status,
      latency_ms: row.latencyMs,
      error: row.error,
      created_at: row.createdAt.toISOString(),
    };
  }
}
