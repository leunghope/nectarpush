import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { OptionsModule } from './modules/options/options.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ChannelsModule } from './modules/channels/channels.module';
import { MessagesModule } from './modules/messages/messages.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { MeModule } from './modules/me/me.module';
import { PushModule } from './modules/push/push.module';
import { PublicModule } from './modules/public/public.module';
import { RealtimeModule } from './realtime/realtime.module';
import { UpdateModule } from './modules/update/update.module';
import { EnvelopeInterceptor } from './common/envelope.interceptor';
import { UnifiedExceptionFilter } from './common/exception.filter';

/**
 * The response envelope and the unified exception filter are registered here
 * (not only in main.ts) so that tests booting AppModule exercise exactly the
 * same pipeline as production.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    OptionsModule,
    AuthModule,
    UsersModule,
    ChannelsModule,
    MessagesModule,
    WebhooksModule,
    MeModule,
    PushModule,
    PublicModule,
    RealtimeModule,
    UpdateModule,
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    { provide: APP_FILTER, useClass: UnifiedExceptionFilter },
  ],
})
export class AppModule {}
