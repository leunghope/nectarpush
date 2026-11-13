import { Module } from '@nestjs/common';
import { PushController } from './push.controller';
import { PushService } from './push.service';
import { DeliveryService } from './delivery.service';
import { ChannelTestController } from './channel-test.controller';
import { ChannelsModule } from '../channels/channels.module';
import { OptionsModule } from '../options/options.module';

@Module({
  imports: [ChannelsModule, OptionsModule],
  controllers: [PushController, ChannelTestController],
  providers: [PushService, DeliveryService],
  exports: [DeliveryService],
})
export class PushModule {}
