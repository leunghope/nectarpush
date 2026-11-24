import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UpdateService } from './update.service';
import { SessionGuard, Roles } from '../../common/session.guard';

@Controller('api/update')
@UseGuards(SessionGuard)
@Roles('root')
export class UpdateController {
  constructor(private readonly update: UpdateService) {}

  /** GET /api/update/check — 手动检查新版本（服务端代理 GitHub，缓存 10 分钟）。 */
  @Get('check')
  async check(@Query('force') force?: string) {
    return this.update.check(force === 'true' || force === '1');
  }
}
