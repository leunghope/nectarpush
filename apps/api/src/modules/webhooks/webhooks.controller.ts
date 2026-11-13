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
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { WebhooksService } from './webhooks.service';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { SessionGuard } from '../../common/session.guard';
import { CurrentUser } from '../../common/current-user.decorator';
import type { AuthedUser } from '../../common/session';
import { ParseIdPipe } from '../../common/params';

const ruleValue = z.string().max(500);

const UpsertSchema = z.object({
  name: z.string().min(1).max(20),
  target_channel: z.string().min(1).max(20),
  enabled: z.boolean().optional(),
  extract_rule: z.record(ruleValue),
  construct_rule: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    content: z.string().optional(),
    url: z.string().optional(),
  }),
});

const UpdateSchema = z.object({
  status_only: z.boolean().optional(),
  name: z.string().min(1).max(20).optional(),
  target_channel: z.string().min(1).max(20).optional(),
  enabled: z.boolean().optional(),
  extract_rule: z.record(ruleValue).optional(),
  construct_rule: z
    .object({
      title: z.string().optional(),
      description: z.string().optional(),
      content: z.string().optional(),
      url: z.string().optional(),
    })
    .optional(),
});

@Controller()
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get('api/webhooks')
  @UseGuards(SessionGuard)
  async list(@CurrentUser() user: AuthedUser, @Query('keyword') keyword?: string) {
    return this.webhooks.list(user.id, keyword);
  }

  @Post('api/webhooks')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  async create(
    @CurrentUser() user: AuthedUser,
    @Body(new ZodValidationPipe(UpsertSchema)) body: z.infer<typeof UpsertSchema>,
  ) {
    return this.webhooks.create(user.id, body);
  }

  @Get('api/webhooks/:id')
  @UseGuards(SessionGuard)
  async detail(@CurrentUser() user: AuthedUser, @Param('id', new ParseIdPipe('WEBHOOK_NOT_FOUND', 'Webhook 不存在')) id: number) {
    return this.webhooks.get(user.id, id);
  }

  @Patch('api/webhooks/:id')
  @UseGuards(SessionGuard)
  async update(
    @CurrentUser() user: AuthedUser,
    @Param('id', new ParseIdPipe('WEBHOOK_NOT_FOUND', 'Webhook 不存在')) id: number,
    @Body(new ZodValidationPipe(UpdateSchema)) body: z.infer<typeof UpdateSchema>,
    @Query('status_only') statusOnly?: string,
  ) {
    const merged = statusOnly === 'true' ? { ...body, status_only: true } : body;
    return this.webhooks.update(user.id, id, merged);
  }

  @Delete('api/webhooks/:id')
  @UseGuards(SessionGuard)
  async remove(@CurrentUser() user: AuthedUser, @Param('id', new ParseIdPipe('WEBHOOK_NOT_FOUND', 'Webhook 不存在')) id: number) {
    await this.webhooks.remove(user.id, id);
    return { message: 'Webhook 已删除' };
  }

  /** Public trigger — no auth (unpredictable 32-char link is the credential). */
  @Post('webhook/:name')
  @HttpCode(200)
  async trigger(@Param('name') name: string, @Body() body: unknown) {
    return this.webhooks.trigger(name, body);
  }
}
