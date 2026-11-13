import { Body, Controller, Get, HttpCode, Patch, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { OptionsService } from './options.service';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { SessionGuard, Roles } from '../../common/session.guard';
import { discoverOidc } from '../oauth/discovery';

const OptionUpdateSchema = z.object({
  key: z.string().min(1).max(64),
  value: z.string(),
});

const DiscoverSchema = z.object({
  url: z.string().min(1).max(2048),
});

@Controller('api/options')
@UseGuards(SessionGuard)
@Roles('root')
export class OptionsController {
  constructor(private readonly options: OptionsService) {}

  @Get()
  async list() {
    return { items: this.options.all() };
  }

  /** POST /api/options/oauth2/discover — fill OAuth2 endpoints from an OIDC document. */
  @Post('oauth2/discover')
  @HttpCode(200)
  async discover(
    @Body(new ZodValidationPipe(DiscoverSchema)) body: z.infer<typeof DiscoverSchema>,
  ) {
    return discoverOidc(body.url);
  }

  @Patch()
  async update(
    @Body(new ZodValidationPipe(OptionUpdateSchema))
    body: { key: string; value: string },
  ) {
    this.options.assertDependencies(body.key, body.value);
    await this.options.set(body.key, body.value);
    return { message: '设置已保存' };
  }
}
