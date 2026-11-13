import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OptionsService } from '../options/options.service';
import { DeliveryService, SendParams } from '../push/delivery.service';
import { ApiError } from '../../common/errors';
import type { PushMessage } from '../../channels/adapter.interface';

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly options: OptionsService,
    private readonly delivery: DeliveryService,
  ) {}

  async list(
    ownerId: number,
    filters: {
      page?: number; page_size?: number; channel?: string; status?: string;
      keyword?: string; since?: string; until?: string;
    },
  ) {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.page_size ?? 20));
    const since = filters.since ? new Date(filters.since) : null;
    const until = filters.until ? new Date(filters.until) : null;
    const where = {
      ownerId,
      ...(filters.channel ? { channelName: filters.channel } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(since && !Number.isNaN(since.getTime()) ? { createdAt: { gte: since } } : {}),
      ...(until && !Number.isNaN(until.getTime())
        ? { createdAt: { ...(since && !Number.isNaN(since.getTime()) ? { gte: since } : {}), lte: until } }
        : {}),
      ...(filters.keyword
        ? {
            OR: [
              { title: { contains: filters.keyword } },
              { description: { contains: filters.keyword } },
              { content: { contains: filters.keyword } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.message.count({ where }),
      this.prisma.message.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      items: rows.map((m) => this.summary(m)),
      page: {
        page,
        page_size: pageSize,
        total,
        total_pages: Math.ceil(total / pageSize),
      },
    };
  }

  async detail(ownerId: number, id: number) {
    const row = await this.prisma.message.findFirst({
      where: { id, ownerId },
      include: { deliveries: true },
    });
    if (!row) throw new ApiError('NOT_FOUND', '消息不存在');
    return this.detailView(row, row.deliveries);
  }

  async byUuid(uuid: string) {
    const row = await this.prisma.message.findUnique({
      where: { uuid },
      include: { deliveries: true },
    });
    if (!row) throw new ApiError('NOT_FOUND', '消息不存在');
    return this.detailView(row, row.deliveries);
  }

  /** Console send: POST /api/messages (channel is a name). */
  async send(
    user: { id: number; username: string; allowSendEmailToOthers: boolean; allowSaveMessage: boolean; defaultChannel: string | null },
    body: { channel: string; title?: string; description?: string; content?: string; url?: string; to?: string; render_mode?: string; async?: boolean },
  ) {
    const persist = user.allowSaveMessage && this.options.getBool('MessagePersistenceEnabled');
    const message: PushMessage = {
      ...(body.title ? { title: body.title } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.content !== undefined ? { content: body.content } : {}),
      ...(body.url ? { url: body.url } : {}),
      renderMode: this.normalizeRenderMode(body.render_mode),
    };
    const params: SendParams = {
      ownerId: user.id,
      username: user.username,
      allowSendEmailToOthers: user.allowSendEmailToOthers,
      allowSaveMessage: user.allowSaveMessage,
      message,
      to: body.to?.trim() || body.channel,
      async: Boolean(body.async),
      persist,
    };
    const outcome = await this.delivery.send(params);
    return { uuid: outcome.uuid, status: outcome.status, message: outcome.message };
  }

  async resend(ownerId: number, id: number) {
    const row = await this.prisma.message.findFirst({ where: { id, ownerId } });
    if (!row) throw new ApiError('NOT_FOUND', '消息不存在');
    const user = await this.prisma.user.findUnique({ where: { id: ownerId } });
    if (!user) throw new ApiError('USER_NOT_FOUND', '用户不存在');
    return this.send(
      {
        id: user.id,
        username: user.username,
        allowSendEmailToOthers: user.allowSendEmailToOthers,
        allowSaveMessage: user.allowSaveMessage,
        defaultChannel: user.defaultChannel,
      },
      {
        channel: row.channelName,
        ...(row.title ? { title: row.title } : {}),
        ...(row.description ? { description: row.description } : {}),
        ...(row.content ? { content: row.content } : {}),
        ...(row.url ? { url: row.url } : {}),
        ...(row.to && row.to !== row.channelName ? { to: row.to } : {}),
        render_mode: row.renderMode,
      },
    );
  }

  async remove(ownerId: number, id: number) {
    const row = await this.prisma.message.findFirst({ where: { id, ownerId } });
    if (!row) throw new ApiError('NOT_FOUND', '消息不存在');
    await this.prisma.message.delete({ where: { id } });
    return { deleted: id };
  }

  /**
   * DELETE /api/messages — hard delete, cascades to MessageDelivery (阶段3 D-18).
   * ownerId given → clear only that owner's messages (scope=own);
   * ownerId omitted → clear every user's messages (scope=all, root only,
   * enforced by the controller).
   */
  async removeAll(ownerId?: number) {
    const where = ownerId === undefined ? {} : { ownerId };
    const r = await this.prisma.message.deleteMany({ where });
    return { deleted: r.count };
  }

  /** GET /api/messages/:uuid (public branch) — shareable read-only view (D-04). */
  async publicByUuid(uuid: string) {
    const row = await this.prisma.message.findUnique({ where: { uuid } });
    if (!row) throw new ApiError('NOT_FOUND', '消息不存在');
    return {
      uuid: row.uuid,
      title: row.title,
      description: row.description,
      content: row.content,
      url: row.url,
      render_mode: row.renderMode,
      status: row.status,
      created_at: row.createdAt.toISOString(),
    };
  }

  /** PATCH /api/messages/:id — edit a pending/failed message (D-05). */
  async update(
    ownerId: number,
    id: number,
    data: {
      title?: string;
      description?: string;
      content?: string;
      url?: string;
      render_mode?: 'markdown' | 'code' | 'raw';
    },
  ) {
    const row = await this.prisma.message.findFirst({ where: { id, ownerId } });
    if (!row) throw new ApiError('NOT_FOUND', '消息不存在');
    if (row.status !== 'pending' && row.status !== 'failed') {
      throw new ApiError('VALIDATION_FAILED', '仅待投递或投递失败的消息可编辑，已投递的消息请使用重发');
    }
    const updated = await this.prisma.message.update({
      where: { id },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.content !== undefined ? { content: data.content } : {}),
        ...(data.url !== undefined ? { url: data.url } : {}),
        ...(data.render_mode !== undefined ? { renderMode: data.render_mode } : {}),
      },
    });
    const deliveries = await this.prisma.messageDelivery.findMany({ where: { messageId: id } });
    return this.detailView(updated, deliveries);
  }

  private normalizeRenderMode(mode?: string): 'markdown' | 'code' | 'raw' {
    if (mode === 'code' || mode === 'raw') return mode;
    return 'markdown';
  }

  private summary(m: {
    id: number; uuid: string; title: string | null; channelName: string;
    channelType: string; to: string | null; status: string; createdAt: Date;
  }) {
    return {
      id: m.id,
      uuid: m.uuid,
      title: m.title,
      channel_name: m.channelName,
      channel_type: m.channelType,
      to: m.to,
      status: m.status,
      created_at: m.createdAt.toISOString(),
    };
  }

  private detailView(
    m: {
      id: number; uuid: string; title: string | null; description: string | null;
      content: string | null; url: string | null; channelName: string; channelType: string;
      to: string | null; renderMode: string; status: string; createdAt: Date;
    },
    deliveries: Array<{
      id: number; channelId: number | null; channelName: string; status: string;
      latencyMs: number | null; error: string | null; createdAt: Date;
    }>,
  ) {
    return {
      id: m.id,
      uuid: m.uuid,
      title: m.title,
      description: m.description,
      content: m.content,
      url: m.url,
      channel_name: m.channelName,
      channel_type: m.channelType,
      to: m.to,
      render_mode: m.renderMode,
      status: m.status,
      created_at: m.createdAt.toISOString(),
      deliveries: deliveries.map((d) => ({
        id: d.id,
        channel_id: d.channelId,
        channel_name: d.channelName,
        status: d.status,
        latency_ms: d.latencyMs,
        error: d.error,
        created_at: d.createdAt.toISOString(),
      })),
    };
  }
}
