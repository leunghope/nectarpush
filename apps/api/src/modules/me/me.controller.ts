import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { z } from 'zod';
import { MeService } from './me.service';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { SessionGuard } from '../../common/session.guard';
import { CurrentUser } from '../../common/current-user.decorator';
import { AuthedUser, SESSION_COOKIE } from '../../common/session';

const MeUpdateSchema = z.object({
  username: z.string().min(1).max(12).optional(),
  display_name: z.string().max(20).optional(),
  old_password: z.string().optional(),
  password: z.string().min(8).max(20).optional(),
  default_channel: z.string().max(20).nullable().optional(),
  // Empty string / null clears the address; otherwise a mailbox code is
  // required whenever SMTP is configured (checked in the service).
  email: z.union([z.string().trim().email().max(254), z.literal(''), z.null()]).optional(),
  email_code: z.string().length(6).optional(),
});

const EmailChangeSchema = z.object({
  email: z.string().trim().email().max(254),
});

const PushSettingsSchema = z.object({
  default_channel: z.string().max(20).nullable().optional(),
});

@Controller('api/me')
@UseGuards(SessionGuard)
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get()
  async profile(@CurrentUser() user: AuthedUser) {
    return this.me.profile(user);
  }

  @Patch()
  async update(
    @CurrentUser() user: AuthedUser,
    @Body(new ZodValidationPipe(MeUpdateSchema)) body: z.infer<typeof MeUpdateSchema>,
  ) {
    return this.me.update(user, body);
  }

  @Delete()
  async deleteAccount(
    @CurrentUser() user: AuthedUser,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    await this.me.deleteAccount(user);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { message: '账号已注销' };
  }

  @Get('security')
  async security(@CurrentUser() user: AuthedUser) {
    return this.me.security(user);
  }

  @Post('email/verification')
  @HttpCode(200)
  async requestEmailChange(
    @CurrentUser() user: AuthedUser,
    @Body(new ZodValidationPipe(EmailChangeSchema)) body: z.infer<typeof EmailChangeSchema>,
  ) {
    return this.me.requestEmailChange(user, body.email);
  }

  @Get('oauth/:provider/start')
  async startBind(
    @CurrentUser() user: AuthedUser,
    @Param('provider') provider: string,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const { url } = await this.me.startBind(user, provider);
    res.code(302).header('location', url);
  }

  @Delete('oauth/:provider')
  async unbindOAuth(
    @CurrentUser() user: AuthedUser,
    @Param('provider') provider: string,
  ) {
    return this.me.unbindOAuth(user, provider);
  }

  @Post('token')
  @HttpCode(200)
  async issueToken(@CurrentUser() user: AuthedUser) {
    return this.me.issueToken(user);
  }

  @Get('push')
  async pushSettings(@CurrentUser() user: AuthedUser) {
    return this.me.pushSettings(user);
  }

  @Patch('push')
  async updatePushSettings(
    @CurrentUser() user: AuthedUser,
    @Body(new ZodValidationPipe(PushSettingsSchema)) body: z.infer<typeof PushSettingsSchema>,
  ) {
    return this.me.updatePushSettings(user, body.default_channel ?? null);
  }
}
