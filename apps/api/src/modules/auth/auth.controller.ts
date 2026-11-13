import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { AuthService } from './auth.service';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { SESSION_COOKIE, SESSION_TTL_MS } from '../../common/session';
import { sessionCookieSecure } from '../../common/cookies';
import { ApiError } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import { signSession } from '../../common/crypto';
import { serverBase } from '../../common/http-base';

const RegisterSchema = z.object({
  username: z.string().min(1).max(12),
  password: z.string().min(8).max(20),
  display_name: z.string().max(20).optional(),
  email: z.string().email().optional(),
  verification_code: z.string().optional(),
  turnstile_token: z.string().optional(),
});

const LoginSchema = z.object({
  username: z.string().min(1).max(12),
  password: z.string().min(1).max(20),
});

const VerificationSchema = z.object({
  email: z.string().email(),
  turnstile_token: z.string().optional(),
});

const ResetRequestSchema = z.object({
  email: z.string().email(),
  turnstile_token: z.string().optional(),
});

const ResetConfirmSchema = z.object({
  email: z.string().email(),
  token: z.string().min(8).max(64),
  // D-06: 用户自设新密码，强度对齐注册（min8max20）；一致性由 service 校验
  new_password: z.string().min(8).max(20),
  new_password_confirm: z.string().min(8).max(20),
});

@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('register')
  @HttpCode(200)
  async register(
    @Body(new ZodValidationPipe(RegisterSchema)) body: z.infer<typeof RegisterSchema>,
  ) {
    await this.auth.register(body);
    return { message: '注册成功' };
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(LoginSchema)) body: z.infer<typeof LoginSchema>,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const result = await this.auth.login(body);
    const user = await this.prisma.user.findFirst({
      where: { username: body.username, deletedAt: null },
    });
    if (user) {
      res.setCookie(SESSION_COOKIE, signSession(user.id, SESSION_TTL_MS), {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: sessionCookieSecure(), // Q-08: on for HTTPS deployments
        maxAge: SESSION_TTL_MS / 1000,
      });
    }
    return result;
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Res({ passthrough: true }) res: FastifyReply) {
    res.clearCookie(SESSION_COOKIE, { path: '/', secure: sessionCookieSecure() });
    return { message: '已登出' };
  }

  @Post('verification')
  @HttpCode(200)
  async sendVerificationCode(
    @Body(new ZodValidationPipe(VerificationSchema)) body: z.infer<typeof VerificationSchema>,
  ) {
    await this.auth.sendVerificationCode(body);
    return { message: '验证码已发送' };
  }

  @Post('reset-request')
  @HttpCode(200)
  async requestPasswordReset(
    @Body(new ZodValidationPipe(ResetRequestSchema)) body: z.infer<typeof ResetRequestSchema>,
  ) {
    await this.auth.requestPasswordReset(body);
    return { message: '若邮箱已注册，重置邮件已发送' };
  }

  @Post('reset-confirm')
  @HttpCode(200)
  async confirmPasswordReset(
    @Body(new ZodValidationPipe(ResetConfirmSchema)) body: z.infer<typeof ResetConfirmSchema>,
  ) {
    return this.auth.confirmPasswordReset(body);
  }

  @Get('oauth/providers')
  oauthProviders() {
    return {
      items: this.auth.listProviders().map((p) => ({
        id: p.id,
        display_name: p.display_name || p.id,
      })),
    };
  }

  @Get('oauth/:provider/start')
  async oauthStart(
    @Param('provider') provider: string,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const cfg = this.auth.getProvider(provider);
    const base = serverBase();
    const { url } = this.auth.buildAuthorizeUrl(
      cfg,
      `${base}/api/auth/oauth/${encodeURIComponent(provider)}/callback`,
    );
    this.redirect(res, url);
  }

  @Get('oauth/:provider/callback')
  async oauthCallback(
    @Res({ passthrough: true }) res: FastifyReply,
    @Param('provider') provider: string,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ) {
    const base = serverBase();
    const redirectUri = `${base}/api/auth/oauth/${encodeURIComponent(provider)}/callback`;
    const payload = state ? this.auth.consumeState(state) : null;
    const mode = payload?.mode ?? 'login';
    const redirectWith = (path: string, key: string, value: string) =>
      this.redirect(res, `${base}${path}?${key}=${encodeURIComponent(value)}`);
    const fail = (reason: string) =>
      redirectWith(mode === 'bind' ? '/me' : '/login', 'oauth_error', reason);

    if (!payload) return fail('state_mismatch');
    if (error || !code) return fail(oauthErrorSlug(error || 'missing_code'));
    try {
      const cfg = this.auth.getProvider(provider);
      if (payload.mode === 'bind') {
        if (!payload.userId) return fail('state_mismatch');
        await this.auth.oauthBind(payload.userId, cfg, code, redirectUri);
        return redirectWith('/me', 'oauth_bound', provider);
      }
      const { user } = await this.auth.oauthLogin(cfg, code, redirectUri);
      if (user.status === 'disabled') {
        return fail('user_disabled');
      }
      res.setCookie(SESSION_COOKIE, signSession(user.id, SESSION_TTL_MS), {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: sessionCookieSecure(), // Q-08: on for HTTPS deployments
        maxAge: SESSION_TTL_MS / 1000,
      });
      this.redirect(res, `${base}/?oauth=ok`);
      return;
    } catch (e) {
      return fail(oauthErrorSlug(e instanceof ApiError ? e.code : 'oauth_failed'));
    }
  }

  // Q-12: with @Res({ passthrough: true }) Nest serializes the handler return
  // value with the default 200 status, which overwrote Fastify's 302 while
  // keeping the Location header. Set status + header explicitly and return
  // nothing so the passthrough send preserves the redirect.
  private redirect(res: FastifyReply, location: string): void {
    res.code(302).header('location', location);
  }

}

/** Map internal/third-party failure values to a stable query slug for the UI. */
function oauthErrorSlug(value: string): string {
  switch (value) {
    case 'access_denied':
    case 'missing_code':
    case 'state_mismatch':
    case 'unauthorized':
    case 'user_disabled':
    case 'user_not_found':
    case 'already_bound':
    case 'provider_not_configured':
    case 'register_disabled':
    case 'oauth_failed':
      return value;
    case 'OAUTH_ALREADY_BOUND':
      return 'already_bound';
    case 'USER_DISABLED':
      return 'user_disabled';
    case 'USER_NOT_FOUND':
      return 'user_not_found';
    case 'OAUTH_PROVIDER_NOT_CONFIGURED':
      return 'provider_not_configured';
    case 'FORBIDDEN':
      return 'register_disabled';
    case 'UNAUTHORIZED':
      return 'unauthorized';
    default:
      return 'oauth_failed';
  }
}
