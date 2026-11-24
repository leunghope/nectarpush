import { Body, Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../../common/session.guard';
import { CurrentUser } from '../../common/current-user.decorator';
import { ApiError } from '../../common/errors';
import type { AuthedUser } from '../../common/session';
import { PrismaService } from '../../prisma/prisma.service';
import { DeliveryService } from './delivery.service';
import { ParseIdPipe } from '../../common/params';

/**
 * POST /api/channels/:id/test lives here (not in ChannelsController) to keep the
 * module graph acyclic: DeliveryService depends on ChannelsService, so the
 * channels module must not depend back on the push module. The route itself is
 * unchanged — see docs/openapi.yaml.
 */
@UseGuards(SessionGuard)
@Controller('api/channels')
export class ChannelTestController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly delivery: DeliveryService,
  ) {}

  @Post(':id/test')
  @HttpCode(200)
  async test(
    @Param('id', new ParseIdPipe('CHANNEL_NOT_FOUND', '渠道不存在')) id: number,
    @CurrentUser() user: AuthedUser,
    @Body() body: { to?: string },
  ) {
    const channel = await this.prisma.channel.findFirst({ where: { id, ownerId: user.id } });
    if (!channel) throw new ApiError('NOT_FOUND', '渠道不存在');
    if (!channel.enabled) throw new ApiError('CHANNEL_DISABLED', '通道已禁用，请先启用后再测试');
    const result = await this.delivery.testChannel(channel, body?.to);
    // Hand-built envelope: the result carries its own `success`, which the
    // global interceptor would otherwise pass through unchanged.
    return { success: true, message: '', data: result };
  }
}
