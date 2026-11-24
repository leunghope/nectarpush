import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { hashPassword } from '../common/crypto';

/** First-boot bootstrap: root user + default options + bound email channels. */
@Injectable()
export class SeedService implements OnModuleInit {
  private readonly logger = new Logger('Seed');

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.seedRoot();
  }

  private async seedRoot(): Promise<void> {
    const existing = await this.prisma.user.findFirst({ where: { role: 'root' } });
    if (existing) return;
    await this.prisma.user.create({
      data: {
        username: 'root',
        displayName: 'root',
        passwordHash: hashPassword('123456'),
        role: 'root',
        mustChangePassword: true,
        allowSendEmailToOthers: true,
        allowSaveMessage: true,
      },
    });
    this.logger.log('首次启动：已创建 root 账号（默认密码 123456，首登强制改密）');
  }
}
