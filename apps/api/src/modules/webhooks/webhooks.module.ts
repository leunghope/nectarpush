import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { PushModule } from '../push/push.module';
import { OptionsModule } from '../options/options.module';

@Module({
  imports: [PushModule, OptionsModule],
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
