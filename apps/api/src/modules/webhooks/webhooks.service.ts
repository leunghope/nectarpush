import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OptionsService } from '../options/options.service';
import { DeliveryService } from '../push/delivery.service';
import { ApiError } from '../../common/errors';
import { randomToken } from '../../common/crypto';
import { constructMessage, extractVars } from './rules';

@Injectable()
export class WebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly options: OptionsService,
    private readonly delivery: DeliveryService,
  ) {}

  private toView(row: {
    id: number; ownerId: number; name: string; link: string; targetChannel: string;
    enabled: boolean; extractRule: string; constructRule: string; createdAt: Date;
  }) {
    let extract: Record<string, string> = {};
    let construct: Record<string, string> = {};
    try {
      extract = JSON.parse(row.extractRule) as Record<string, string>;
    } catch { /* keep empty */ }
    try {
      construct = JSON.parse(row.constructRule) as Record<string, string>;
    } catch { /* keep empty */ }
    const base =
      this.options.get('ServerAddress') ||
      process.env.PUBLIC_BASE_URL ||
      `http://127.0.0.1:${process.env.PORT || '3000'}`;
    return {
      id: row.id,
      name: row.name,
      link: row.link,
      target_channel: row.targetChannel,
      enabled: row.enabled,
      trigger_url: base ? `${base.replace(/\/+$/, '')}/webhook/${row.link}` : `/webhook/${row.link}`,
      extract_rule: extract,
      construct_rule: construct,
      created_at: row.createdAt.toISOString(),
    };
  }

  async list(ownerId: number, keyword?: string) {
    const rows = await this.prisma.webhook.findMany({
      where: { ownerId, ...(keyword ? { name: { contains: keyword } } : {}) },
      orderBy: { id: 'asc' },
    });
    const items = rows.map((r) => this.toView(r));
    return {
      items,
      page: { page: 1, page_size: Math.max(items.length, 1), total: items.length, total_pages: items.length > 0 ? 1 : 0 },
    };
  }

  async create(
    ownerId: number,
    input: { name: string; target_channel: string; enabled?: boolean; extract_rule: Record<string, string>; construct_rule: Record<string, string> },
  ) {
    await this.assertTargetChannel(ownerId, input.target_channel);
    const dup = await this.prisma.webhook.findFirst({ where: { ownerId, name: input.name } });
    if (dup) throw new ApiError('DUPLICATE_NAME', '名称已存在');
    const row = await this.prisma.webhook.create({
      data: {
        ownerId,
        name: input.name,
        link: randomToken(16),
        targetChannel: input.target_channel,
        enabled: input.enabled ?? true,
        extractRule: JSON.stringify(input.extract_rule),
        constructRule: JSON.stringify(input.construct_rule),
      },
    });
    return this.toView(row);
  }

  async get(ownerId: number, id: number) {
    const row = await this.prisma.webhook.findFirst({ where: { id, ownerId } });
    if (!row) throw new ApiError('WEBHOOK_NOT_FOUND', 'Webhook 不存在');
    return this.toView(row);
  }

  async update(
    ownerId: number,
    id: number,
    input: { status_only?: boolean; name?: string; target_channel?: string; enabled?: boolean; extract_rule?: Record<string, string>; construct_rule?: Record<string, string> },
  ) {
    const row = await this.prisma.webhook.findFirst({ where: { id, ownerId } });
    if (!row) throw new ApiError('WEBHOOK_NOT_FOUND', 'Webhook 不存在');
    if (input.status_only) {
      const updated = await this.prisma.webhook.update({
        where: { id },
        data: { enabled: input.enabled ?? row.enabled },
      });
      return this.toView(updated);
    }
    const data: Record<string, unknown> = {};
    if (input.name && input.name !== row.name) {
      const dup = await this.prisma.webhook.findFirst({ where: { ownerId, name: input.name } });
      if (dup) throw new ApiError('DUPLICATE_NAME', '名称已存在');
      data.name = input.name;
    }
    if (input.target_channel) {
      await this.assertTargetChannel(ownerId, input.target_channel);
      data.targetChannel = input.target_channel;
    }
    if (input.enabled !== undefined) data.enabled = input.enabled;
    if (input.extract_rule) data.extractRule = JSON.stringify(input.extract_rule);
    if (input.construct_rule) data.constructRule = JSON.stringify(input.construct_rule);
    const updated = await this.prisma.webhook.update({ where: { id }, data });
    return this.toView(updated);
  }

  async remove(ownerId: number, id: number) {
    const row = await this.prisma.webhook.findFirst({ where: { id, ownerId } });
    if (!row) throw new ApiError('WEBHOOK_NOT_FOUND', 'Webhook 不存在');
    await this.prisma.webhook.delete({ where: { id } });
    return { deleted: id };
  }

  /** Public trigger: POST /webhook/:link (no auth, uses unpredictable link). */
  async trigger(link: string, payload: unknown) {
    const row = await this.prisma.webhook.findUnique({ where: { link } });
    if (!row) throw new ApiError('WEBHOOK_NOT_FOUND', 'Webhook 不存在');
    if (!row.enabled) throw new ApiError('WEBHOOK_DISABLED', 'Webhook 已被禁用');
    await this.assertTargetChannel(row.ownerId, row.targetChannel);

    const extract: Record<string, string> = JSON.parse(row.extractRule || '{}');
    const construct: Record<string, string> = JSON.parse(row.constructRule || '{}');
    const vars = extractVars(payload, extract);
    const message = constructMessage(construct, vars);

    const owner = await this.prisma.user.findFirst({ where: { id: row.ownerId, deletedAt: null } });
    if (!owner) throw new ApiError('USER_NOT_FOUND', '用户不存在');

    const outcome = await this.delivery.send({
      ownerId: owner.id,
      username: owner.username,
      allowSendEmailToOthers: owner.allowSendEmailToOthers,
      allowSaveMessage: owner.allowSaveMessage,
      message,
      to: row.targetChannel,
      async: false,
      persist: owner.allowSaveMessage && this.options.getBool('MessagePersistenceEnabled'),
    });
    return {
      success: outcome.status !== 'failed',
      message: outcome.message,
      data: { uuid: outcome.uuid },
    };
  }

  private async assertTargetChannel(ownerId: number, name: string) {
    const ch = await this.prisma.channel.findFirst({ where: { ownerId, name } });
    if (!ch) throw new ApiError('CHANNEL_NOT_FOUND', `无效的渠道名称：${name}`);
  }
}
