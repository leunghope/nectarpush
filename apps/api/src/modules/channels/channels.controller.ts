import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { SessionGuard } from '../../common/session.guard';
import { CurrentUser } from '../../common/current-user.decorator';
import { ZodValidationPipe } from '../../common/zod.pipe';
import type { AuthedUser } from '../../common/session';
import { ChannelsService } from './channels.service';
import { ParseIdPipe } from '../../common/params';

const CreateSchema = z.object({
  type: z.string().min(1),
  name: z.string().min(1).max(20),
  description: z.string().max(100).optional(),
  enabled: z.boolean().optional(),
  config: z.record(z.string()).optional(),
  token: z.string().nullable().optional(),
});

const UpdateSchema = z.object({
  status_only: z.boolean().optional(),
  name: z.string().min(1).max(20).optional(),
  description: z.string().max(100).nullable().optional(),
  enabled: z.boolean().optional(),
  config: z.record(z.string()).optional(),
  token: z.string().nullable().optional(),
});

@UseGuards(SessionGuard)
@Controller('api/channels')
export class ChannelsController {
  constructor(private readonly channels: ChannelsService) {}

  @Get('types')
  types() {
    return this.channels.types();
  }

  @Get()
  async list(
    @CurrentUser() user: AuthedUser,
    @Query('keyword') keyword?: string,
    @Query('brief') brief?: string,
  ) {
    const items = await this.channels.list(user.id, keyword, brief === 'true');
    const page = {
      page: 1,
      page_size: Math.max(items.length, 1),
      total: items.length,
      total_pages: items.length > 0 ? 1 : 0,
    };
    return { items, page };
  }

  @Post()
  @HttpCode(200)
  create(
    @CurrentUser() user: AuthedUser,
    @Body(new ZodValidationPipe(CreateSchema)) body: z.infer<typeof CreateSchema>,
  ) {
    return this.channels.create(user.id, { ...body, config: body.config ?? {} });
  }

  @Get(':id')
  detail(@CurrentUser() user: AuthedUser, @Param('id', new ParseIdPipe('CHANNEL_NOT_FOUND', '渠道不存在')) id: number) {
    return this.channels.get(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthedUser,
    @Param('id', new ParseIdPipe('CHANNEL_NOT_FOUND', '渠道不存在')) id: number,
    @Query('status_only') statusOnly: string | undefined,
    @Body(new ZodValidationPipe(UpdateSchema)) body: z.infer<typeof UpdateSchema>,
  ) {
    return this.channels.update(user.id, id, {
      ...body,
      status_only: statusOnly === 'true' || body.status_only === true,
    });
  }

  /**
   * Q-07 / FR-042: rotate the channel-level push token. The plaintext is
   * returned once; the old value is invalid immediately afterwards.
   */
  @Post(':id/token')
  @HttpCode(200)
  async rotateToken(
    @CurrentUser() user: AuthedUser,
    @Param('id', new ParseIdPipe('CHANNEL_NOT_FOUND', '渠道不存在')) id: number,
    @Body() body: { token?: string | null },
  ) {
    return this.channels.rotateToken(user.id, id, body?.token);
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthedUser, @Param('id', new ParseIdPipe('CHANNEL_NOT_FOUND', '渠道不存在')) id: number) {
    await this.channels.remove(user.id, id);
    return { message: '通道已删除' };
  }
}
