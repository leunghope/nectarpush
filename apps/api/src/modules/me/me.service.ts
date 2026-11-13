import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ChannelsService } from '../channels/channels.service';
import { UsersService } from '../users/users.service';
import { OptionsService } from '../options/options.service';
import { AuthService } from '../auth/auth.service';
import { ApiError } from '../../common/errors';
import { encrypt, hashPassword, verifyPassword, randomToken, decrypt } from '../../common/crypto';
import { serverBase } from '../../common/http-base';

export interface MeUpdateInput {
  username?: string;
  display_name?: string;
  old_password?: string;
  password?: string;
  default_channel?: string | null;
  email?: string | null;
  email_code?: string;
}

@Injectable()
export class MeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly channels: ChannelsService,
    private readonly users: UsersService,
    private readonly options: OptionsService,
    private readonly auth: AuthService,
  ) {}

  async profile(user: AuthedLike) {
    const row = await this.prisma.user.findFirst({ where: { id: user.id, deletedAt: null } });
    if (!row) throw new ApiError('USER_NOT_FOUND', '用户不存在');
    return this.users.toView(row);
  }

  async update(user: AuthedLike, input: MeUpdateInput) {
    const row = await this.prisma.user.findFirst({ where: { id: user.id, deletedAt: null } });
    if (!row) throw new ApiError('USER_NOT_FOUND', '用户不存在');
    const data: Record<string, unknown> = {};
    if (input.username && input.username !== row.username) {
      const dup = await this.prisma.user.findFirst({ where: { username: input.username, deletedAt: null } });
      if (dup) throw new ApiError('DUPLICATE_NAME', '用户名已存在');
      data.username = input.username;
    }
    if (input.display_name !== undefined) data.displayName = input.display_name;
    if (input.default_channel !== undefined) data.defaultChannel = input.default_channel;

    // Email change (FR-007): normalize, enforce uniqueness, and require a
    // mailbox code whenever SMTP is configured. This is intentionally decoupled
    // from EmailVerificationEnabled, which only governs registration mail.
    const nextEmail = input.email === undefined ? undefined : normalizeEmail(input.email);
    const emailChanged = nextEmail !== undefined && nextEmail !== (row.email ?? null);
    if (emailChanged) {
      if (nextEmail) {
        const taken = await this.prisma.user.findFirst({
          where: { email: nextEmail, id: { not: user.id } },
        });
        if (taken) throw new ApiError('DUPLICATE_NAME', '该邮箱已被其他账号使用');
        if (this.options.smtpReady()) {
          if (!input.email_code) throw new ApiError('VALIDATION_FAILED', '请填写邮箱验证码');
          await this.auth.consumeEmailCode(nextEmail, input.email_code, 'change_email');
        }
      }
      data.email = nextEmail;
    }

    if (input.password) {
      // OAuth-only accounts have no password yet: allow setting one without an
      // old password, then require the old one for every later change.
      if (row.passwordHash) {
        if (!input.old_password || !verifyPassword(input.old_password, row.passwordHash)) {
          throw new ApiError('VALIDATION_FAILED', '旧密码不正确');
        }
      }
      data.passwordHash = hashPassword(input.password);
      data.mustChangePassword = false;
    }
    const updated = await this.prisma.user.update({ where: { id: user.id }, data });
    if (emailChanged) await this.channels.syncEmailChannel(user.id, nextEmail ?? null);
    return this.users.toView(updated);
  }

  /** GET /api/me/security — password/OAuth state for the personal settings page. */
  async security(user: AuthedLike) {
    const row = await this.prisma.user.findFirst({ where: { id: user.id, deletedAt: null } });
    if (!row) throw new ApiError('USER_NOT_FOUND', '用户不存在');
    const providers = this.auth.listProviders().map((p) => ({
      id: p.id,
      display_name: p.display_name || p.id,
    }));
    // D-03 多绑：返回全部绑定列表（按绑定先后排序）。
    const bindings = await this.prisma.oAuthBinding.findMany({
      where: { userId: user.id },
      orderBy: { id: 'asc' },
    });
    return {
      has_password: Boolean(row.passwordHash),
      email_verification_enabled: this.options.getBool('EmailVerificationEnabled'),
      email_change_requires_code: this.options.smtpReady(),
      oauth: {
        bindings: bindings.map((b) => ({
          provider: b.provider,
          display_name: providers.find((p) => p.id === b.provider)?.display_name ?? b.provider,
          oauth_id: b.oauthId,
        })),
        providers,
      },
    };
  }

  /** POST /api/me/email/verification — send a code for the pending email change. */
  async requestEmailChange(user: AuthedLike, email: string) {
    const row = await this.prisma.user.findFirst({ where: { id: user.id, deletedAt: null } });
    if (!row) throw new ApiError('USER_NOT_FOUND', '用户不存在');
    const nextEmail = normalizeEmail(email);
    if (!nextEmail) throw new ApiError('VALIDATION_FAILED', '请输入邮箱地址');
    if (nextEmail === row.email) {
      return { sent: false, required: false, message: '邮箱未变化，无需验证' };
    }
    const taken = await this.prisma.user.findFirst({
      where: { email: nextEmail, id: { not: user.id } },
    });
    if (taken) throw new ApiError('DUPLICATE_NAME', '该邮箱已被其他账号使用');
    if (!this.options.smtpReady()) {
      return {
        sent: false,
        required: false,
        message: 'SMTP 未配置，暂时无法发送验证码；邮箱可保存，但无法用于找回密码',
      };
    }
    await this.auth.sendEmailChangeCode(nextEmail);
    return { sent: true, required: true, message: '验证码已发送' };
  }

  /** GET /api/me/oauth/:provider/start — begin binding a third-party identity. */
  async startBind(user: AuthedLike, providerId: string) {
    const provider = this.auth.getProvider(providerId);
    const base = serverBase();
    const { url } = this.auth.buildAuthorizeUrl(
      provider,
      `${base}/api/auth/oauth/${encodeURIComponent(providerId)}/callback`,
      { mode: 'bind', userId: user.id },
    );
    return { url };
  }

  /** DELETE /api/me/oauth/:provider — unbind one provider, never lock a password-less user out. */
  async unbindOAuth(user: AuthedLike, providerId: string) {
    const row = await this.prisma.user.findFirst({ where: { id: user.id, deletedAt: null } });
    if (!row) throw new ApiError('USER_NOT_FOUND', '用户不存在');
    const binding = await this.prisma.oAuthBinding.findFirst({
      where: { userId: user.id, provider: providerId },
    });
    if (!binding) throw new ApiError('VALIDATION_FAILED', '当前未绑定该第三方账号');
    if (!row.passwordHash) {
      throw new ApiError('VALIDATION_FAILED', '请先设置登录密码后再解绑');
    }
    await this.prisma.oAuthBinding.delete({ where: { id: binding.id } });
    return { message: '已解绑第三方账号' };
  }

  /** DELETE /api/me — soft delete + anonymization (D-UX-05). */
  async deleteAccount(user: AuthedLike) {
    const row = await this.prisma.user.findFirst({ where: { id: user.id, deletedAt: null } });
    if (!row) throw new ApiError('USER_NOT_FOUND', '用户不存在');
    if (row.role === 'root') throw new ApiError('FORBIDDEN', 'root 用户不能注销，请先转移所有权');
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        username: `deleted_${row.id}`,
        email: null,
        passwordHash: null,
        accessToken: null,
        displayName: `已注销用户${row.id}`,
        status: 'disabled',
        deletedAt: new Date(),
      },
    });
    // D-03：软删不走 FK 级联，显式清空 OAuth 绑定，释放身份供他人绑定。
    await this.prisma.oAuthBinding.deleteMany({ where: { userId: user.id } });
    await this.prisma.channel.deleteMany({ where: { ownerId: user.id } });
    await this.prisma.webhook.deleteMany({ where: { ownerId: user.id } });
    return { deleted: user.id };
  }

  /** POST /api/me/token — issue or rotate the global push token. */
  async issueToken(user: AuthedLike) {
    const token = randomToken(16);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { accessToken: encrypt(token) },
    });
    return { token };
  }

  async pushSettings(user: AuthedLike) {
    const row = await this.prisma.user.findFirst({ where: { id: user.id, deletedAt: null } });
    if (!row) throw new ApiError('USER_NOT_FOUND', '用户不存在');
    return this.settingsView(row);
  }

  async updatePushSettings(user: AuthedLike, defaultChannel: string | null) {
    if (defaultChannel) {
      const ch = await this.prisma.channel.findFirst({ where: { ownerId: user.id, name: defaultChannel } });
      if (!ch) throw new ApiError('CHANNEL_NOT_FOUND', `无效的渠道名称：${defaultChannel}`);
    }
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { defaultChannel },
    });
    return this.settingsView(updated);
  }

  private settingsView(row: { username: string; defaultChannel: string | null; accessToken: string | null }) {
    let tokenMasked: string | null = null;
    if (row.accessToken) {
      try {
        const plain = decrypt(row.accessToken) ?? '';
        tokenMasked = plain.length > 8
          ? `${plain.slice(0, 4)}••••${plain.slice(-3)}`
          : '••••';
      } catch {
        tokenMasked = '••••';
      }
    }
    const server = this.options.get('ServerAddress') || `http://127.0.0.1:${process.env.PORT || '3000'}`;
    const pushEndpoint = `${server.replace(/\/+$/, '')}/push/${row.username}`;
    return {
      username: row.username,
      default_channel: row.defaultChannel,
      token_masked: tokenMasked,
      push_endpoint: pushEndpoint,
      examples: {
        curl: `curl -X POST '${pushEndpoint}' -H 'Content-Type: application/json' -d '{"title":"Hi","description":"来自 curl","token":"<你的令牌>"}'`,
      },
    };
  }

  /** Channels owned by the user (for push settings dropdown). */
  async myChannels(user: AuthedLike) {
    return this.channels.list(user.id);
  }
}

function normalizeEmail(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed || null;
}

interface AuthedLike {
  id: number;
}