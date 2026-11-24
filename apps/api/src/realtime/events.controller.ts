import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SessionGuard } from '../common/session.guard';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthedUser } from '../common/session';
import { sseSubscribe } from './sse-hub';

@Controller('api/events')
export class EventsController {
  /** SSE stream for the web console (message.created / delivery.updated). */
  @Get()
  @UseGuards(SessionGuard)
  async events(
    @CurrentUser() user: AuthedUser,
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
  ) {
    req.raw.setTimeout(0);
    res.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const unsubscribe = sseSubscribe({
      userId: user.id,
      write: (chunk: string) => res.raw.write(chunk),
    });
    const close = () => unsubscribe();
    res.raw.on('close', close);
  }
}
