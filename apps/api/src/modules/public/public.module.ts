import { Module } from '@nestjs/common';
import { PublicController } from './public.controller';
import { OptionsModule } from '../options/options.module';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [OptionsModule, PrismaModule],
  controllers: [PublicController],
})
export class PublicModule {}
