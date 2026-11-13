import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OptionsService } from '../options/options.service';

const STARTED_AT = Date.now();

@Controller('api')
export class PublicController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly options: OptionsService,
  ) {}

  @Get('public/about')
  async about() {
    return { content: this.options.get('About') || '' };
  }

  @Get('public/announcement')
  async announcement() {
    return { content: this.options.get('Notice') || '' };
  }

  /** GET /api/public/footer — public footer content (D-07). */
  @Get('public/footer')
  async footer() {
    return { content: this.options.get('Footer') || '' };
  }

  /**
   * GET /api/public/turnstile-sitekey — public Turnstile bootstrap (D-07).
   * Only the check flag and the SiteKey are exposed; the SecretKey never
   * leaves the server through any public endpoint.
   */
  @Get('public/turnstile-sitekey')
  async turnstileSiteKey() {
    return {
      enabled: this.options.getBool('TurnstileCheckEnabled'),
      site_key: this.options.get('TurnstileSiteKey') || '',
    };
  }

  @Get('health')
  async health() {
    let database: 'ok' | 'degraded' = 'degraded';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = 'ok';
    } catch {
      database = 'degraded';
    }
    return {
      status: 'ok' as const,
      uptime_seconds: Math.floor((Date.now() - STARTED_AT) / 1000),
      database,
    };
  }

  @Get('version')
  version() {
    return {
      version: process.env.npm_package_version || '0.1.0',
      commit: process.env.GIT_COMMIT || null,
    };
  }
}
