import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { UsersService } from './users.service';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { SessionGuard, Roles } from '../../common/session.guard';
import { CurrentUser } from '../../common/current-user.decorator';
import type { AuthedUser } from '../../common/session';
import { ParseIdPipe, parsePageParam, parsePageSizeParam } from '../../common/params';
import { ApiError } from '../../common/errors';

const CreateSchema = z.object({
  username: z.string().min(1).max(12),
  password: z.string().min(8).max(20),
  display_name: z.string().max(20).optional(),
  role: z.enum(['user', 'admin', 'root']).optional(),
});

const UpdateSchema = z.object({
  username: z.string().min(1).max(12).optional(),
  display_name: z.string().max(20).optional(),
  password: z.string().min(8).max(20).optional(),
});

const ManageSchema = z.object({
  action: z.enum([
    'enable', 'disable', 'promote', 'demote',
    'allow_send_email_to_others', 'disallow_send_email_to_others',
    'allow_save_message', 'disallow_save_message',
  ]),
});

const RestoreSchema = z.object({
  username: z.string().min(1).max(12).optional(),
});

@Controller('api/users')
@UseGuards(SessionGuard)
@Roles('admin')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  async list(
    @Query('keyword') keyword?: string,
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string,
    @Query('include_deleted') includeDeleted?: string,
  ) {
    // Q-06: 'abc'/101 used to be silently clamped (or NaN → 500); reject them.
    return this.users.list(
      keyword,
      parsePageParam(page),
      parsePageSizeParam(pageSize, 'page_size', 10),
      includeDeleted === 'true',
    );
  }

  @Post()
  @HttpCode(200)
  async create(
    @CurrentUser() user: AuthedUser,
    @Body(new ZodValidationPipe(CreateSchema)) body: z.infer<typeof CreateSchema>,
  ) {
    return this.users.create(user.role, body);
  }

  @Get(':id/oauth')
  async oauthBindings(
    @CurrentUser() actor: AuthedUser,
    @Param('id', new ParseIdPipe('USER_NOT_FOUND', '用户不存在')) id: number,
  ) {
    return this.users.listOAuth(actor.role, id);
  }

  @Delete(':id/oauth/:provider')
  async unbindOAuth(
    @CurrentUser() actor: AuthedUser,
    @Param('id', new ParseIdPipe('USER_NOT_FOUND', '用户不存在')) id: number,
    @Param('provider') provider: string,
  ) {
    if (!provider || provider.length > 32) {
      throw new ApiError('VALIDATION_FAILED', '提供方标识无效');
    }
    return this.users.removeOAuth(actor.role, id, provider);
  }

  @Get(':id')
  async detail(@CurrentUser() actor: AuthedUser, @Param('id', new ParseIdPipe('USER_NOT_FOUND', '用户不存在')) id: number) {
    return this.users.get(actor.role, id);
  }

  @Patch(':id')
  async update(
    @CurrentUser() actor: AuthedUser,
    @Param('id', new ParseIdPipe('USER_NOT_FOUND', '用户不存在')) id: number,
    @Body(new ZodValidationPipe(UpdateSchema)) body: z.infer<typeof UpdateSchema>,
  ) {
    return this.users.update(actor.role, id, body);
  }

  @Delete(':id')
  async remove(@CurrentUser() actor: AuthedUser, @Param('id', new ParseIdPipe('USER_NOT_FOUND', '用户不存在')) id: number) {
    await this.users.remove(actor.role, id);
    return { message: '用户已删除' };
  }

  /** POST /api/users/:id/restore — undo a soft-deleted user (D-06). */
  @Post(':id/restore')
  @HttpCode(200)
  async restore(
    @CurrentUser() actor: AuthedUser,
    @Param('id', new ParseIdPipe('USER_NOT_FOUND', '用户不存在')) id: number,
    @Body(new ZodValidationPipe(z.preprocess((raw) => raw ?? {}, RestoreSchema)))
    body?: z.infer<typeof RestoreSchema>,
  ) {
    return this.users.restore(actor.role, id, body ?? {});
  }

  @Post(':id/manage')
  @HttpCode(200)
  async manage(
    @CurrentUser() actor: AuthedUser,
    @Param('id', new ParseIdPipe('USER_NOT_FOUND', '用户不存在')) id: number,
    @Body(new ZodValidationPipe(ManageSchema)) body: { action: string },
  ) {
    return this.users.manage(actor.role, actor.id, id, body.action);
  }
}
