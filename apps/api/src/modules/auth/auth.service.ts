import nodemailer from 'nodemailer';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OptionsService } from '../options/options.service';
import { ApiError } from '../../common/errors';
import { hashPassword, randomToken, verifyPassword } from '../../common/crypto';
import { getSmtpOptions } from '../../common/smtp-state';
import { isUniqueViolation } from '../../common/prisma-errors';
import { UsersService } from '../users/users.service';
import { ChannelsService } from '../channels/channels.service';
import {
  type OAuthProviderConfig,
  GITHUB_PROVIDER_ID,
  normalizeProviders,
  parseProvidersJson,
  parseTokenResponse,
  buildTokenRequestBody,
  TOKEN_REQUEST_CONTENT_TYPE,
} from '../oauth/providers';

// OAuthProviderConfig / parseProviders live in ../oauth/providers and are
// re-exported here so existing imports keep working (no behaviour change).
export type { OAuthProviderConfig } from '../oauth/providers';

export interface OAuthStatePayload {
  expiresAt: number;
  mode: 'login' | 'bind';
  userId?: number;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth');
  private readonly oauthStates = new Map<string, OAuthStatePayload>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly options: OptionsService,
    private readonly users: UsersService,
    private readonly channels: ChannelsService,
  ) {}

  async register(input: {
    username: string;
    password: string;
    display_name?: string;
    email?: string;
    verification_code?: string;
    turnstile_token?: string;
  }) {
    if (!this.options.getBool('RegisterEnabled')) {
      throw new ApiError('FORBIDDEN', '管理员已关闭注册');
    }
    await this.checkTurnstile(input.turnstile_token);
    const dup = await this.prisma.user.findFirst({ where: { username: input.username, deletedAt: null } });
    if (dup) throw new ApiError('DUPLICATE_NAME', '用户名已存在');
    let email: string | undefined = input.email;
    if (this.options.getBool('EmailVerificationEnabled')) {
      if (!email) throw new ApiError('VALIDATION_FAILED', '开启邮箱验证后必须填写邮箱');
      if (!input.verification_code) throw new ApiError('VALIDATION_FAILED', '请填写邮箱验证码');
      await this.consumeEmailCode(email, input.verification_code, 'register');
    } else if (email) {
      const emailTaken = await this.prisma.user.findFirst({ where: { email, deletedAt: null } });
      if (emailTaken) throw new ApiError('DUPLICATE_NAME', '邮箱已被绑定');
    }
    let user;
    try {
      user = await this.prisma.user.create({
        data: {
          username: input.username,
          displayName: input.display_name ?? input.username,
          passwordHash: hashPassword(input.password),
          ...(email ? { email } : {}),
        },
      });
    } catch (e) {
      // Q-06 (contract run 4): soft-deleted rows still occupy unique indexes.
      if (isUniqueViolation(e)) throw new ApiError('DUPLICATE_NAME', '用户名或邮箱已被占用（含已删除账号）');
      throw e;
    }
    if (email) {
      await this.channels.ensureEmailChannel(user.id, email);
    }
    return this.users.toView(user);
  }

  async login(input: { username: string; password: string }) {
    if (!this.options.getBool('PasswordLoginEnabled')) {
      throw new ApiError('FORBIDDEN', '管理员已关闭密码登录');
    }
    const user = await this.prisma.user.findFirst({ where: { username: input.username, deletedAt: null } });
    if (!user?.passwordHash || !verifyPassword(input.password, user.passwordHash)) {
      throw new ApiError('UNAUTHORIZED', '用户名或密码错误');
    }
    if (user.status === 'disabled') throw new ApiError('USER_DISABLED', '用户已被封禁');
    return {
      user: this.users.toView(user),
      must_change_password: user.mustChangePassword,
    };
  }

  async sendVerificationCode(input: { email: string; turnstile_token?: string }) {
    await this.checkTurnstile(input.turnstile_token);
    if (!this.options.getBool('EmailVerificationEnabled')) {
      throw new ApiError('FORBIDDEN', '管理员未开启邮箱验证');
    }
    await this.sendEmailCode(input.email, 'register');
    return { sent: true };
  }

  /** Verify a mailbox for a sensitive change (currently: changing the account email). */
  async sendEmailChangeCode(email: string) {
    await this.sendEmailCode(email, 'change_email');
  }

  private async sendEmailCode(email: string, purpose: 'register' | 'change_email') {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await this.prisma.emailCode.create({
      data: {
        email,
        code,
        purpose,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });
    const subject = purpose === 'change_email' ? '蜂鸟推送邮箱变更验证码' : '蜂鸟推送验证码';
    await this.sendEmail(email, subject, `你的验证码是 ${code}，10 分钟内有效。`);
    return { sent: true };
  }

  async requestPasswordReset(input: { email: string; turnstile_token?: string }) {
    await this.checkTurnstile(input.turnstile_token);
    const user = await this.prisma.user.findFirst({ where: { email: input.email, deletedAt: null } });
    // Always report success to avoid account enumeration.
    if (user) {
      const token = randomToken(8);
      await this.prisma.emailCode.create({
        data: {
          email: input.email,
          code: '',
          purpose: 'reset',
          token,
          expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        },
      });
      const base = this.options.get('ServerAddress');
      const link = `${base ? base.replace(/\/+$/, '') : ''}/reset-password?token=${token}&email=${encodeURIComponent(input.email)}`;
      try {
        await this.sendEmail(
          input.email,
          '蜂鸟推送密码重置',
          `请点击链接重置密码（30 分钟内有效）：\n${link}\n如非本人操作请忽略本邮件。`,
        );
      } catch (e) {
        // Q-04 / AC-004: a missing or broken SMTP service must not turn into a
        // distinguishable response for registered accounts. Log and keep the
        // same generic success envelope as the unregistered branch.
        this.logger.warn(`password reset email dispatch failed: ${(e as Error).message}`);
      }
    }
    return { sent: true };
  }

  async confirmPasswordReset(input: {
    email: string;
    token: string;
    new_password: string;
    new_password_confirm: string;
  }) {
    // D-06: 两次输入一致性（前端也校验，此处为后端兜底）
    if (input.new_password !== input.new_password_confirm) {
      throw new ApiError('VALIDATION_FAILED', '两次输入的新密码不一致');
    }
    const row = await this.prisma.emailCode.findFirst({
      where: { email: input.email, purpose: 'reset', token: input.token, used: false },
      orderBy: { id: 'desc' },
    });
    if (!row || row.expiresAt < new Date()) {
      throw new ApiError('VALIDATION_FAILED', '重置链接无效或已过期');
    }
    await this.prisma.emailCode.update({ where: { id: row.id }, data: { used: true } });
    const user = await this.prisma.user.findFirst({ where: { email: input.email, deletedAt: null } });
    if (!user) throw new ApiError('USER_NOT_FOUND', '用户不存在');
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: hashPassword(input.new_password),
        mustChangePassword: false, // D-06: 用户刚自设密码，无需再强制改密
        sessionsRevokedAt: new Date(), // old sessions die (contract: 旧会话失效)
      },
    });
    // D-06: 只回成功，不返回任何明文密码
    return { message: '密码已重置' };
  }

  // ---------- OAuth2 (generic authorization-code flow) ----------

  /** 全部已配置提供方（含已停用；管理端查看绑定关系时用）。 */
  listAllProviders(): OAuthProviderConfig[] {
    try {
      return normalizeProviders(parseProvidersJson(this.options.get('OAuth2Providers')));
    } catch {
      return [];
    }
  }

  /** 可在登录/绑定入口展示的提供方：启用且 client_id 已填写。 */
  listProviders(): OAuthProviderConfig[] {
    return this.listAllProviders().filter((p) => p.enabled !== false && p.client_id);
  }

  getProvider(id: string): OAuthProviderConfig {
    const p = this.listAllProviders().find((x) => x.id === id);
    if (!p || !p.client_id) {
      throw new ApiError('OAUTH_PROVIDER_NOT_CONFIGURED', `OAuth Provider ${id} 未配置`);
    }
    if (p.enabled === false) {
      throw new ApiError('OAUTH_PROVIDER_NOT_CONFIGURED', `OAuth Provider ${id} 已停用`);
    }
    if (p.id !== GITHUB_PROVIDER_ID && !(p.authorize_url && p.token_url && p.userinfo_url)) {
      throw new ApiError('OAUTH_PROVIDER_NOT_CONFIGURED', `OAuth Provider ${id} 端点未配置完整`);
    }
    return p;
  }

  buildAuthorizeUrl(
    provider: OAuthProviderConfig,
    redirectUri: string,
    opts: { mode?: 'login' | 'bind'; userId?: number } = {},
  ): { url: string; state: string } {
    const state = randomToken(12);
    this.oauthStates.set(state, {
      expiresAt: Date.now() + 10 * 60 * 1000,
      mode: opts.mode ?? 'login',
      userId: opts.userId,
    });
    const u = new URL(provider.authorize_url);
    u.searchParams.set('client_id', provider.client_id);
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('state', state);
    if (provider.scope) u.searchParams.set('scope', provider.scope);
    return { url: u.toString(), state };
  }

  consumeState(state: string): OAuthStatePayload | null {
    const payload = this.oauthStates.get(state);
    this.oauthStates.delete(state);
    if (!payload || payload.expiresAt <= Date.now()) return null;
    return payload;
  }

  /** Exchange the authorization code and read the mapped identity fields. */
  private async fetchIdentity(
    provider: OAuthProviderConfig,
    code: string,
    redirectUri?: string,
  ): Promise<{ oauthId: string; email: string | null }> {
    // O-1 (design §4.3): standard OIDC (e.g. authentik) requires the token
    // request body to be application/x-www-form-urlencoded, not JSON.
    const tokenRes = await fetch(provider.token_url, {
      method: 'POST',
      headers: { 'content-type': TOKEN_REQUEST_CONTENT_TYPE, accept: 'application/json' },
      body: buildTokenRequestBody(provider, code, redirectUri),
      signal: AbortSignal.timeout(10_000),
    });
    // Response compatibility: try JSON first, fall back to form-urlencoded
    // (GitHub returns a query-string body when JSON is not negotiated).
    const tokenText = await tokenRes.text().catch(() => '');
    const tokenJson = parseTokenResponse(tokenText);
    if (!tokenJson.access_token) {
      throw new ApiError('UNAUTHORIZED', 'OAuth 授权失败：未获取到 access_token');
    }
    const infoRes = await fetch(provider.userinfo_url, {
      headers: { authorization: `Bearer ${tokenJson.access_token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    const info = (await infoRes.json().catch(() => ({}))) as Record<string, unknown>;
    const oauthId = String(info[provider.map_username] ?? '');
    if (!oauthId) {
      throw new ApiError('UNAUTHORIZED', `OAuth 用户信息缺少字段 ${provider.map_username}`);
    }
    const email = provider.map_email && info[provider.map_email]
      ? String(info[provider.map_email])
      : null;
    return { oauthId, email };
  }

  async oauthLogin(
    provider: OAuthProviderConfig,
    code: string,
    redirectUri?: string,
  ): Promise<{ user: ReturnType<UsersService['toView']> }> {
    const { oauthId, email } = await this.fetchIdentity(provider, code, redirectUri);

    // D-03：身份命中绑定表即登录（多绑下同一用户可有多条绑定）。
    const binding = await this.prisma.oAuthBinding.findFirst({
      where: { provider: provider.id, oauthId },
      include: { user: true },
    });
    let user = binding && !binding.user.deletedAt ? binding.user : null;
    if (!user) {
      // Third-party sign-in must not bypass the registration switch. Existing
      // accounts can still log in while registration is closed.
      if (!this.options.getBool('RegisterEnabled')) {
        throw new ApiError('FORBIDDEN', '管理员已关闭注册');
      }
      // 防御：绑定指向已软删用户（正常注销路径会清绑定）→ 清理孤儿绑定后重新建号。
      if (binding) await this.prisma.oAuthBinding.delete({ where: { id: binding.id } });

      // B-03：映射邮箱已被其他账号占用时给出友好提示，而非裸 P2002/500。
      if (email && (await this.prisma.user.findFirst({ where: { email } }))) {
        throw new ApiError(
          'DUPLICATE_NAME',
          '该邮箱已被其他账号使用，请先用该邮箱登录后在个人设置中绑定此第三方账号',
        );
      }
      const base = `${provider.id}_${oauthId}`.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 12);
      let username = base;
      let n = 0;
      while (await this.prisma.user.findFirst({ where: { username, deletedAt: null } })) {
        username = `${base.slice(0, 10)}${n++}`;
      }
      try {
        // 建号与建绑定同事务：绑定撞唯一约束时回滚，避免留下孤儿用户。
        user = await this.prisma.$transaction(async (tx) => {
          const created = await tx.user.create({
            data: { username, displayName: username, ...(email ? { email } : {}) },
          });
          await tx.oAuthBinding.create({
            data: { userId: created.id, provider: provider.id, oauthId },
          });
          return created;
        });
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
        if (email && (await this.prisma.user.findFirst({ where: { email } }))) {
          throw new ApiError(
            'DUPLICATE_NAME',
            '该邮箱已被其他账号使用，请先用该邮箱登录后在个人设置中绑定此第三方账号',
          );
        }
        throw new ApiError('OAUTH_ALREADY_BOUND', '该第三方账号已被绑定，请直接登录');
      }
      if (email) await this.channels.ensureEmailChannel(user.id, email);
    }
    if (user.status === 'disabled') throw new ApiError('USER_DISABLED', '用户已被封禁');
    return { user: this.users.toView(user) };
  }

  /** Bind a third-party identity to the signed-in account (does not touch email or channels). */
  async oauthBind(
    userId: number,
    provider: OAuthProviderConfig,
    code: string,
    redirectUri?: string,
  ) {
    const { oauthId } = await this.fetchIdentity(provider, code, redirectUri);
    const target = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!target) throw new ApiError('USER_NOT_FOUND', '用户不存在');

    // D-03：同一 (provider, oauthId) 全局唯一。已绑本人→幂等；已绑他人→拒绝。
    const existing = await this.prisma.oAuthBinding.findFirst({
      where: { provider: provider.id, oauthId },
      include: { user: true },
    });
    if (existing) {
      if (existing.userId === userId) return this.users.toView(target);
      if (!existing.user.deletedAt) {
        throw new ApiError('OAUTH_ALREADY_BOUND', '该第三方账号已绑定其他用户');
      }
      // 孤儿绑定（属主已软删）→ 清理后允许重新绑定。
      await this.prisma.oAuthBinding.delete({ where: { id: existing.id } });
    }
    try {
      await this.prisma.oAuthBinding.create({
        data: { userId, provider: provider.id, oauthId },
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ApiError('OAUTH_ALREADY_BOUND', '该第三方账号已绑定其他用户');
      }
      throw e;
    }
    return this.users.toView(target);
  }

  async consumeEmailCode(email: string, code: string, purpose: string) {
    const row = await this.prisma.emailCode.findFirst({
      where: { email, purpose, used: false },
      orderBy: { id: 'desc' },
    });
    if (!row || row.code !== code || row.expiresAt < new Date()) {
      throw new ApiError('VALIDATION_FAILED', '验证码无效或已过期');
    }
    await this.prisma.emailCode.update({ where: { id: row.id }, data: { used: true } });
  }

  private async checkTurnstile(token?: string) {
    if (!this.options.getBool('TurnstileCheckEnabled')) return;
    if (!token) throw new ApiError('VALIDATION_FAILED', '请完成人机验证');
    try {
      const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          secret: this.options.get('TurnstileSecretKey'),
          response: token,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const json = (await res.json()) as { success?: boolean };
      if (!json.success) throw new Error('verify failed');
    } catch (e) {
      this.logger.warn(`turnstile verify failed: ${(e as Error).message}`);
      throw new ApiError('VALIDATION_FAILED', '人机验证失败，请重试');
    }
  }

  private async sendEmail(to: string, subject: string, text: string) {
    const smtp = getSmtpOptions();
    if (!smtp?.host) throw new ApiError('SMTP_NOT_CONFIGURED', '邮件服务未配置');
    const transport = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.port === 465,
      auth: { user: smtp.account, pass: smtp.token },
      connectionTimeout: 10_000,
    });
    try {
      await transport.sendMail({ from: smtp.account, to, subject, text });
    } catch (e) {
      this.logger.error(`send email failed: ${(e as Error).message}`);
      throw new ApiError('SMTP_NOT_CONFIGURED', `邮件发送失败：${(e as Error).message}`);
    }
  }
}
