import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UsersModule } from '../users/users.module';
import { ChannelsModule } from '../channels/channels.module';
import { OptionsModule } from '../options/options.module';

@Module({
  imports: [UsersModule, ChannelsModule, OptionsModule],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
