import { Module } from '@nestjs/common';
import { MeController } from './me.controller';
import { MeService } from './me.service';
import { UsersModule } from '../users/users.module';
import { ChannelsModule } from '../channels/channels.module';
import { OptionsModule } from '../options/options.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [UsersModule, ChannelsModule, OptionsModule, AuthModule],
  controllers: [MeController],
  providers: [MeService],
})
export class MeModule {}
