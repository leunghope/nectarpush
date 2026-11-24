import { Module } from '@nestjs/common';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { PushModule } from '../push/push.module';
import { OptionsModule } from '../options/options.module';

@Module({
  imports: [PushModule, OptionsModule],
  controllers: [MessagesController],
  providers: [MessagesService],
})
export class MessagesModule {}
