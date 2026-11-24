import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { decrypt, encrypt, randomToken } from '../../common/crypto';
import { getAdapter, listAdapters, RESERVED_CHANNEL_NAMES } from '../../channels/registry';
import { CHANNEL_GUIDES } from '../../channels/guides';
import { ApiError } from '../../common/errors';
import type { ChannelConfig } from '../../channels/adapter.interface';

export interface ChannelView {
  id: number;
  name: string;
  type: string;
  description: string | null;
  enabled: boolean;
  config: Record<string, string>;
  created_at: string;
}

@Injectable()
export class ChannelsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Parse stored config JSON and decrypt secret values. */
  decryptConfig(raw: string): ChannelConfig {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
    const out: ChannelConfig = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v !== 'string') continue;
      if (v.startsWith('enc:')) {
        const plain = decrypt(v.slice(4));
        if (plain !== null) out[k] = plain;
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  /** Encrypt secret fields per adapter schema; keep plain values otherwise. */
  encryptConfig(type: string, cfg: ChannelConfig, previous?: ChannelConfig): string {
    const adapter = getAdapter(type);
    const secretKeys = new Set(
      (adapter?.configSchema ?? []).filter((f) => f.secret).map((f) => f.key),
    );
    const merged: Record<string, string> = { ...(previous ?? {}) };
    for (const [k, v] of Object.entries(cfg)) {
      if (v === '' && secretKeys.has(k) && merged[k]) continue; // blank = keep
      if (v === '') {
        delete merged[k];
        continue;
      }
      merged[k] = v;
    }
    const stored: Record<string, string> = {};
    for (const [k, v] of Object.entries(merged)) {
      stored[k] = secretKeys.has(k) ? 'enc:' + encrypt(v) : v;
    }
    return JSON.stringify(stored);
  }

  /** Public view: secret values masked as ******. */
  maskConfig(type: string, cfg: ChannelConfig): Record<string, string> {
    const adapter = getAdapter(type);
    const secretKeys = new Set(
      (adapter?.configSchema ?? []).filter((f) => f.secret).map((f) => f.key),
    );
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(cfg)) {
      out[k] = secretKeys.has(k) ? '******' : v;
    }
    return out;
  }

  toView(row: { id: number; name: string; type: string; description: string | null; enabled: boolean; config: string; createdAt: Date }): ChannelView {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      description: row.description,
      enabled: row.enabled,
      config: this.maskConfig(row.type, this.decryptConfig(row.config)),
      created_at: row.createdAt.toISOString(),
    };
  }

  types() {
    const items = listAdapters().map((a) => ({
      type: a.type,
      display_name: a.displayName,
      status: a.status,
      hidden: a.hidden === true,
      capabilities: a.capabilities,
      ...(CHANNEL_GUIDES[a.type] ? { guide: CHANNEL_GUIDES[a.type] } : {}),
      config_schema: {
        fields: a.configSchema.map((f) => ({
          key: f.key,
          label: f.label,
          type: f.type,
          required: f.required,
          secret: f.secret,
          ...(f.placeholder !== null ? { placeholder: f.placeholder } : {}),
          ...(f.help !== null ? { help: f.help } : {}),
          ...(f.default !== null ? { default: f.default } : {}),
          ...(f.options ? { options: f.options } : {}),
          ...(f.options_source ? { options_source: f.options_source } : {}),
        })),
      },
    }));
    return { items, total: items.length };
  }

  async list(ownerId: number, keyword?: string, brief = false) {
    const rows = await this.prisma.channel.findMany({
      where: {
        ownerId,
        ...(keyword ? { name: { contains: keyword } } : {}),
      },
      orderBy: { id: 'asc' },
    });
    if (brief) {
      return rows.map((r) => ({ id: r.id, name: r.name, type: r.type, enabled: r.enabled }));
    }
    return rows.map((r) => this.toView(r));
  }

  async get(ownerId: number, id: number) {
    const row = await this.prisma.channel.findFirst({ where: { id, ownerId } });
    if (!row) throw new ApiError('CHANNEL_NOT_FOUND', '渠道不存在');
    return this.toView(row);
  }

  async create(
    ownerId: number,
    input: { type: string; name: string; description?: string; enabled?: boolean; config: ChannelConfig; token?: string | null },
  ) {
    const adapter = getAdapter(input.type);
    if (!adapter) throw new ApiError('VALIDATION_FAILED', `不支持的通道类型：${input.type}`);
    if (RESERVED_CHANNEL_NAMES.has(input.name) && input.type !== 'email') {
      throw new ApiError('CHANNEL_NAME_RESERVED', '通道名 email 为保留名');
    }
    const dup = await this.prisma.channel.findFirst({ where: { ownerId, name: input.name } });
    if (dup) throw new ApiError('DUPLICATE_NAME', '名称已存在');
    const v = adapter.validateConfig(input.config);
    if (!v.valid) {
      throw new ApiError('VALIDATION_FAILED', Object.values(v.errors).join('；'), v.errors);
    }
    await this.validateGroupChildren(ownerId, input.type, input.config);
    const row = await this.prisma.channel.create({
      data: {
        ownerId,
        name: input.name,
        type: input.type,
        description: input.description ?? null,
        enabled: input.enabled ?? true,
        config: this.encryptConfig(input.type, input.config),
        accessToken: input.token ? encrypt(input.token) : null,
      },
    });
    // Q-07 / FR-042: the channel-level token is shown exactly once, at create
    // time. List/detail responses never include it.
    return { ...this.toView(row), access_token: input.token ?? null };
  }

  /**
   * Q-07: rotate (or set) the channel-level push token. Returns the plaintext
   * once; the previous value stops working immediately because only the new
   * ciphertext is stored.
   */
  async rotateToken(ownerId: number, id: number, token?: string | null) {
    const row = await this.prisma.channel.findFirst({ where: { id, ownerId } });
    if (!row) throw new ApiError('CHANNEL_NOT_FOUND', '渠道不存在');
    const plain = token && token.trim() ? token.trim() : this.newChannelToken();
    await this.prisma.channel.update({ where: { id }, data: { accessToken: encrypt(plain) } });
    return { access_token: plain };
  }

  async update(
    ownerId: number,
    id: number,
    input: { status_only?: boolean; name?: string; description?: string | null; enabled?: boolean; config?: ChannelConfig; token?: string | null },
  ) {
    const row = await this.prisma.channel.findFirst({ where: { id, ownerId } });
    if (!row) throw new ApiError('CHANNEL_NOT_FOUND', '渠道不存在');
    if (input.status_only) {
      const updated = await this.prisma.channel.update({
        where: { id },
        data: { enabled: input.enabled ?? row.enabled },
      });
      return this.toView(updated);
    }
    const data: Record<string, unknown> = {};
    if (input.name && input.name !== row.name) {
      if (RESERVED_CHANNEL_NAMES.has(input.name) && row.type !== 'email') {
        throw new ApiError('CHANNEL_NAME_RESERVED', '通道名 email 为保留名');
      }
      const dup = await this.prisma.channel.findFirst({ where: { ownerId, name: input.name } });
      if (dup) throw new ApiError('DUPLICATE_NAME', '名称已存在');
      data.name = input.name;
    }
    if (input.description !== undefined) data.description = input.description ?? null;
    if (input.enabled !== undefined) data.enabled = input.enabled;
    if (input.config) {
      const merged = this.mergeConfig(row, input.config);
      const adapter = getAdapter(row.type);
      const v = adapter?.validateConfig(merged);
      if (v && !v.valid) {
        throw new ApiError('VALIDATION_FAILED', Object.values(v.errors).join('；'), v.errors);
      }
      await this.validateGroupChildren(ownerId, row.type, merged, id);
      data.config = this.encryptConfig(row.type, input.config, this.decryptConfig(row.config));
    }
    if (input.token !== undefined) {
      data.accessToken = input.token ? encrypt(input.token) : null;
    }
    const updated = await this.prisma.channel.update({ where: { id }, data });
    return this.toView(updated);
  }

  /**
   * Group children must be the owner's own, non-group channels: no
   * self-reference (A -> A) and no nesting (A -> B -> A cycles). The ids live
   * in the persisted config, so this needs database access and therefore runs
   * here rather than in the (synchronous, stateless) adapter.
   */
  private async validateGroupChildren(
    ownerId: number,
    type: string,
    cfg: ChannelConfig,
    selfId?: number,
  ): Promise<void> {
    if (type !== 'group') return;
    const ids = [
      ...new Set(
        (cfg.other ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .map(Number),
      ),
    ];
    // Empty / non-numeric lists are already rejected by adapter.validateConfig.
    if (ids.length === 0) return;

    const rows = await this.prisma.channel.findMany({ where: { id: { in: ids }, ownerId } });
    const found = new Set(rows.map((r) => r.id));
    const missing = ids.filter((id) => !found.has(id));
    if (missing.length > 0) {
      const msg = `子通道不存在或不属于当前用户：${missing.join(',')}`;
      throw new ApiError('VALIDATION_FAILED', msg, { other: msg });
    }
    if (selfId !== undefined && ids.includes(selfId)) {
      const msg = '子通道不能包含群组自身';
      throw new ApiError('VALIDATION_FAILED', msg, { other: msg });
    }
    const nested = rows.filter((r) => r.type === 'group').map((r) => r.name);
    if (nested.length > 0) {
      const msg = `子通道不能是群组通道：${nested.join('、')}`;
      throw new ApiError('VALIDATION_FAILED', msg, { other: msg });
    }
  }

  private mergeConfig(row: { type: string; config: string }, incoming: ChannelConfig): ChannelConfig {
    const prev = this.decryptConfig(row.config);
    const adapter = getAdapter(row.type);
    const secretKeys = new Set((adapter?.configSchema ?? []).filter((f) => f.secret).map((f) => f.key));
    const merged: ChannelConfig = { ...prev };
    for (const [k, v] of Object.entries(incoming)) {
      if (v === '' && secretKeys.has(k)) continue; // blank secret = unchanged
      merged[k] = v;
    }
    return merged;
  }

  async remove(ownerId: number, id: number) {
    const row = await this.prisma.channel.findFirst({ where: { id, ownerId } });
    if (!row) throw new ApiError('CHANNEL_NOT_FOUND', '渠道不存在');
    await this.prisma.channel.delete({ where: { id } });
    return { deleted: id };
  }

  async verifyToken(ownerId: number, channelName: string, token: string): Promise<boolean> {
    const row = await this.prisma.channel.findFirst({ where: { ownerId, name: channelName } });
    if (!row?.accessToken) return false;
    const plain = decrypt(row.accessToken);
    return plain === token;
  }

  /** Auto-create or update the bound email channel when the account email changes. */
  async ensureEmailChannel(ownerId: number, email: string): Promise<void> {
    await this.syncEmailChannel(ownerId, email);
  }

  /**
   * Keep the `email` channel in sync with the account address: update its
   * `account_id` instead of silently keeping a stale value, and disable it
   * when the address is cleared (the account then has no mailbox to deliver to).
   */
  async syncEmailChannel(ownerId: number, email: string | null): Promise<void> {
    const existing = await this.prisma.channel.findFirst({
      where: { ownerId, type: 'email' },
    });
    if (!existing) {
      if (!email) return;
      await this.prisma.channel.create({
        data: {
          ownerId,
          name: 'email',
          type: 'email',
          enabled: true,
          config: JSON.stringify({ account_id: email }),
        },
      });
      return;
    }
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(existing.config) as Record<string, unknown>;
    } catch {
      config = {};
    }
    await this.prisma.channel.update({
      where: { id: existing.id },
      data: {
        config: JSON.stringify({ ...config, account_id: email ?? '' }),
        enabled: Boolean(email),
      },
    });
  }

  newChannelToken(): string {
    return randomToken(16); // 32 hex chars
  }
}
