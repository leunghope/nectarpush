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

  /**
   * Channel test send. Group channels fan out to their children — the adapter
   * itself never sends (the send pipeline owns fan-out), so testing a group
   * used to always fail with a developer-facing message.
   */
  async testChannel(
    channel: Channel,
    overrideTo?: string,
  ): Promise<{ success: boolean; message: string; latency_ms: number | null; raw: string | null }> {
    if (channel.type === 'group') return this.testGroupChannel(channel, overrideTo);

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

  /**
   * Group test send: fan out to the configured children and aggregate like a
   * real delivery, but report every child's own result so the user can see
   * exactly which member of the group is broken.
   */
  private async testGroupChannel(
    channel: Channel,
    overrideTo?: string,
  ): Promise<{ success: boolean; message: string; latency_ms: number | null; raw: string | null }> {
    const childIds = this.groupChildIds(channel);
    if (childIds.length === 0) {
      return { success: false, message: '群组未配置子通道', latency_ms: null, raw: null };
    }
    const children = await this.prisma.channel.findMany({
      where: { id: { in: childIds }, ownerId: channel.ownerId },
      orderBy: { id: 'asc' },
    });
    const owner = await this.prisma.user.findUnique({ where: { id: channel.ownerId } });
    const started = Date.now();

    const lines: string[] = [];
    let okCount = 0;
    for (const child of children) {
      if (!child.enabled) {
        lines.push(`${child.name}（${child.type}）：已禁用，已跳过`);
        continue;
      }
      const adapter = getAdapter(child.type);
      if (!adapter) {
        lines.push(`${child.name}（${child.type}）：不支持的通道类型`);
        continue;
      }
      const res = await adapter.send(
        this.channels.decryptConfig(child.config),
        {
          title: 'NectarPush 测试消息',
          description: '这是一条测试消息，如果你看到了说明通道配置正确',
          renderMode: 'markdown',
        },
        {
          userId: channel.ownerId,
          username: owner?.username ?? '',
          allowSendEmailToOthers: owner?.allowSendEmailToOthers ?? false,
          channelName: child.name,
          overrideTo,
        },
      );
      if (res.success) okCount += 1;
      lines.push(`${child.name}（${child.type}）：${res.success ? '成功' : `失败 - ${res.message ?? '未知错误'}`}`);
    }

    const missing = childIds.filter((id) => !children.some((c) => c.id === id));
    if (missing.length > 0) lines.push(`已失效的子通道 id：${missing.join(',')}`);

    return {
      success: okCount > 0 && okCount === children.filter((c) => c.enabled).length,
      message: lines.join('\n'),
      latency_ms: Date.now() - started,
      raw: null,
    };
  }

  /** Child channel ids of a group channel, de-duplicated, in config order. */
  private groupChildIds(channel: Channel): number[] {
    if (channel.type !== 'group') return [];
    const ids = (this.channels.decryptConfig(channel.config).other ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number)
      .filter((n) => Number.isFinite(n));
    return [...new Set(ids)];
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

  /**
   * Retry the failed delivery rows of an existing message in place: each row is
   * re-sent and updated (pending -> success/failed), no new message is created.
   * Rows whose channel was deleted are returned as failed and left untouched.
   */
  async retryDeliveries(
    messageId: number,
    params: SendParams,
    rows: Array<{ id: number; channelId: number | null; channelName: string }>,
  ): Promise<DeliveryOutcome[]> {
    const outcomes: DeliveryOutcome[] = [];
    for (const row of rows) {
      const started = Date.now();
      const channel =
        row.channelId === null
          ? null
          : await this.prisma.channel.findFirst({
              where: { id: row.channelId, ownerId: params.ownerId },
            });
      if (!channel) {
        outcomes.push({
          channelId: row.channelId,
          channelName: row.channelName,
          status: 'failed',
          latencyMs: 0,
          error: '原通道已删除，无法重试',
        });
        continue;
      }
      await this.prisma.messageDelivery.update({
        where: { id: row.id },
        data: { status: 'pending', error: null },
      });
      const r = await this.sendViaAdapter(params, channel, '');
      const latencyMs = Date.now() - started;
      const status: 'success' | 'failed' = r.ok ? 'success' : 'failed';
      const error = r.ok ? null : (r.err ?? '发送失败');
      const updated = await this.prisma.messageDelivery.update({
        where: { id: row.id },
        data: { status, latencyMs, error },
      });
      sseBroadcast(
        { event: 'delivery.updated', data: this.deliveryView(updated, messageId) },
        params.ownerId,
      );
      outcomes.push({ channelId: channel.id, channelName: channel.name, status, latencyMs, error });
    }
    return outcomes;
  }

  private async deliverAll(
    params: SendParams,
    targets: Channel[],
    messageId: number | null,
    uuid: string,
  ): Promise<DeliveryOutcome[]> {
    const outcomes: DeliveryOutcome[] = [];
    for (const ch of targets) {
      outcomes.push(...(await this.deliverOne(params, ch, messageId, uuid)));
    }
    return outcomes;
  }

  /** One target channel -> one or more delivery rows (a group fans out). */
  private async deliverOne(
    params: SendParams,
    channel: Channel,
    messageId: number | null,
    uuid: string,
  ): Promise<DeliveryOutcome[]> {
    if (channel.type === 'group') return this.deliverGroup(params, channel, messageId, uuid);
    return [await this.deliverChannel(params, channel, messageId, uuid)];
  }

  /**
   * Group fan-out: one delivery row per child channel so the detail page can
   * show every member's own status/latency/error. Missing children keep a
   * failed row (channel_id null) and the group itself no longer gets a
   * summary row.
   */
  private async deliverGroup(
    params: SendParams,
    group: Channel,
    messageId: number | null,
    uuid: string,
  ): Promise<DeliveryOutcome[]> {
    const childIds = this.groupChildIds(group);
    if (childIds.length === 0) {
      return [await this.failDelivery(params, messageId, group.id, group.name, '群组未配置子通道')];
    }
    const children = await this.prisma.channel.findMany({
      where: { id: { in: childIds }, ownerId: params.ownerId },
    });
    const byId = new Map(children.map((c) => [c.id, c]));
    const outcomes: DeliveryOutcome[] = [];
    for (const id of childIds) {
      const child = byId.get(id);
      if (!child) {
        outcomes.push(
          await this.failDelivery(params, messageId, null, `已删除通道 #${id}`, '子通道已删除，无法投递'),
        );
        continue;
      }
      outcomes.push(await this.deliverChannel(params, child, messageId, uuid));
    }
    return outcomes;
  }

  private async deliverChannel(
    params: SendParams,
    channel: Channel,
    messageId: number | null,
    uuid: string,
  ): Promise<DeliveryOutcome> {
    const started = Date.now();
    const deliveryRow = messageId
      ? await this.prisma.messageDelivery.create({
          data: { messageId, channelId: channel.id, channelName: channel.name, status: 'pending' },
        })
      : null;

    const r = await this.sendViaAdapter(params, channel, uuid);
    const latencyMs = Date.now() - started;
    const status: 'success' | 'failed' = r.ok ? 'success' : 'failed';
    const error = r.ok ? null : (r.err ?? '发送失败');

    await this.finishDelivery(params, deliveryRow?.id ?? null, messageId, status, latencyMs, error);
    return { channelId: channel.id, channelName: channel.name, status, latencyMs, error };
  }

  private async failDelivery(
    params: SendParams,
    messageId: number | null,
    channelId: number | null,
    channelName: string,
    error: string,
  ): Promise<DeliveryOutcome> {
    if (messageId) {
      const row = await this.prisma.messageDelivery.create({
        data: { messageId, channelId, channelName, status: 'failed', latencyMs: 0, error },
      });
      sseBroadcast(
        { event: 'delivery.updated', data: this.deliveryView(row, messageId) },
        params.ownerId,
      );
    }
    return { channelId, channelName, status: 'failed', latencyMs: 0, error };
  }

  private async finishDelivery(
    params: SendParams,
    rowId: number | null,
    messageId: number | null,
    status: 'success' | 'failed',
    latencyMs: number,
    error: string | null,
  ): Promise<void> {
    if (rowId === null) return;
    const updated = await this.prisma.messageDelivery.update({
      where: { id: rowId },
      data: { status, latencyMs, error },
    });
    sseBroadcast(
      { event: 'delivery.updated', data: this.deliveryView(updated, messageId) },
      params.ownerId,
    );
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
    const ok = outcomes.filter((o) => o.status === 'success').length;
    if (ok === outcomes.length) return 'success';
    if (ok > 0) return 'partial';
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
