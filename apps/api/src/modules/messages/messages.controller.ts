import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { MessagesService } from './messages.service';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { ApiError } from '../../common/errors';
import { SessionGuard, requireSessionUser } from '../../common/session.guard';
import { CurrentUser } from '../../common/current-user.decorator';
import type { AuthedUser } from '../../common/session';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ParseIdPipe,
  parseDateParam,
  parsePageParam,
  parsePageSizeParam,
  safeId,
} from '../../common/params';

const SendSchema = z.object({
  channel: z.string().min(1).max(20),
  title: z.string().max(512).optional(),
  description: z.string().optional(),
  content: z.string().optional(),
  url: z.string().url().optional(),
  to: z.string().max(256).optional(),
  render_mode: z.enum(['markdown', 'code', 'raw']).optional(),
  async: z.boolean().optional(),
});

const UpdateSchema = z.object({
  title: z.string().max(512).optional(),
  description: z.string().optional(),
  content: z.string().optional(),
  url: z.string().url().optional(),
  render_mode: z.enum(['markdown', 'code', 'raw']).optional(),
});

@Controller('api/messages')
export class MessagesController {
  constructor(
    private readonly messages: MessagesService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @UseGuards(SessionGuard)
  async list(
    @CurrentUser() user: AuthedUser,
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string,
    @Query('keyword') keyword?: string,
    @Query('status') status?: string,
    @Query('channel') channel?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
  ) {
    // Q-06: validate before Prisma sees the value — 'abc'/0/101 used to throw 500.
    return this.messages.list(user.id, {
      page: parsePageParam(page),
      page_size: parsePageSizeParam(pageSize),
      channel,
      status,
      keyword,
      since: parseDateParam(since, 'since'),
      until: parseDateParam(until, 'until'),
    });
  }

  @Post()
  @HttpCode(200)
  @UseGuards(SessionGuard)
  async send(
    @CurrentUser() user: AuthedUser,
    @Body(new ZodValidationPipe(SendSchema)) body: z.infer<typeof SendSchema>,
  ) {
    const result = await this.messages.send(user, body);
    return {
      success: result.status !== 'failed',
      message: result.message,
      data: { uuid: result.uuid, status: result.status },
    };
  }

  /**
   * DELETE /api/messages — clear messages (阶段3 D-18):
   * - scope=own (default): caller's own messages, any logged-in user;
   * - scope=all: every user's messages, root only (403 otherwise).
   * The explicit scope param + frontend confirm dialog are the two-step
   * confirmation against accidental wipes.
   */
  @Delete()
  @UseGuards(SessionGuard)
  async removeAll(@CurrentUser() user: AuthedUser, @Query('scope') scope?: string) {
    const normalized = scope ?? 'own';
    if (normalized !== 'own' && normalized !== 'all') {
      throw new ApiError('VALIDATION_FAILED', 'scope 仅支持 own 或 all');
    }
    if (normalized === 'all') {
      if (user.role !== 'root') {
        throw new ApiError('FORBIDDEN', '仅超级管理员可清空全部用户的消息');
      }
      await this.messages.removeAll();
      return { message: '已清空全部用户的消息' };
    }
    await this.messages.removeAll(user.id);
    return { message: '已清空全部消息' };
  }

  /**
   * GET /api/messages/:uuid — merged route (D-04):
   * - numeric key → session-guarded message detail (owner only). The branch
   *   reuses the exact guard logic of SessionGuard (incl. D-02 enforcement)
   *   because the route itself must stay reachable anonymously;
   * - otherwise → public read-only view of a message body (no deliveries /
   *   ownerId / numeric id). Raw content is returned; the frontend sanitizes.
   */
  @Get(':uuid')
  async detailOrPublic(@Param('uuid') key: string, @Req() req: FastifyRequest) {
    if (/^[0-9a-f]{32}$/.test(key)) {
      return this.messages.publicByUuid(key);
    }
    if (/^\d+$/.test(key)) {
      const id = safeId(key);
      if (id === null) throw new ApiError('NOT_FOUND', '消息不存在');
      const user = await requireSessionUser(req, this.prisma);
      return this.messages.detail(user.id, id);
    }
    throw new ApiError('NOT_FOUND', '消息不存在');
  }

  /** PATCH /api/messages/:id — edit a pending/failed message (D-05). */
  @Patch(':id')
  @UseGuards(SessionGuard)
  async update(
    @CurrentUser() user: AuthedUser,
    @Param('id', new ParseIdPipe('NOT_FOUND', '消息不存在')) id: number,
    @Body(new ZodValidationPipe(UpdateSchema)) body: z.infer<typeof UpdateSchema>,
  ) {
    return this.messages.update(user.id, id, body);
  }

  @Delete(':id')
  @UseGuards(SessionGuard)
  async remove(@CurrentUser() user: AuthedUser, @Param('id', new ParseIdPipe('NOT_FOUND', '消息不存在')) id: number) {
    await this.messages.remove(user.id, id);
    return { message: '消息已删除' };
  }

  @Post(':id/resend')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  async resend(@CurrentUser() user: AuthedUser, @Param('id', new ParseIdPipe('NOT_FOUND', '消息不存在')) id: number) {
    const result = await this.messages.resend(user.id, id);
    return {
      success: result.status !== 'failed',
      message: result.message,
      data: { uuid: result.uuid, status: result.status },
    };
  }

  @Get(':uuid/status')
  async statusByUuid(@Param('uuid') uuid: string) {
    const detail = await this.messages.byUuid(uuid);
    return {
      uuid: detail.uuid,
      status: detail.status,
    };
  }
}
