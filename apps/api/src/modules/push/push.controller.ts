import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Body,
  HttpCode,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { PushService, PushInput } from './push.service';

/** Merge query params with stringified body fields (body wins). */
function mergedBody(
  query: Record<string, string>,
  body: Record<string, unknown> | undefined,
): Record<string, string> {
  const merged: Record<string, string> = { ...query };
  for (const [k, v] of Object.entries(body ?? {})) {
    if (typeof v === 'string') merged[k] = v;
    else if (v !== null && v !== undefined) merged[k] = String(v);
  }
  return merged;
}

/**
 * Read `Authorization: Bearer <token>`. The auth scheme is case-insensitive
 * (RFC 7235 §2.1), so `bearer`, `Bearer` and `BEARER` all work.
 */
function bearerOf(req: FastifyRequest): string | undefined {
  const header = req.headers?.authorization;
  if (typeof header !== 'string') return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || undefined;
}

/**
 * External push endpoints: GET|POST /push/:username (+ /api/v1 alias).
 *
 * Token sources (FR-042, docs/openapi.yaml):
 *   1. body `token` / query `?token=` (legacy, wins when both are present)
 *   2. `Authorization: Bearer <token>` (scheme is case-insensitive)
 */
@Controller()
export class PushController {
  constructor(private readonly push: PushService) {}

  @Get('push/:username')
  async pushGet(
    @Param('username') username: string,
    @Req() req: FastifyRequest,
    @Query() query: Record<string, string>,
  ) {
    return this.push.push(username, this.coerce(query, bearerOf(req)));
  }

  @Post('push/:username')
  @HttpCode(200)
  async pushPost(
    @Param('username') username: string,
    @Req() req: FastifyRequest,
    @Query() query: Record<string, string>,
    @Body() body: Record<string, unknown>,
  ) {
    return this.push.push(username, this.coerce(mergedBody(query, body), bearerOf(req)));
  }

  @Post('api/v1/push/:username')
  @HttpCode(200)
  async pushV1(
    @Param('username') username: string,
    @Req() req: FastifyRequest,
    @Query() query: Record<string, string>,
    @Body() body: Record<string, unknown>,
  ) {
    return this.push.push(username, this.coerce(mergedBody(query, body), bearerOf(req)));
  }

  private coerce(raw: Record<string, string>, bearer?: string): PushInput {
    return {
      title: raw.title,
      description: raw.description,
      short: raw.short,
      content: raw.content,
      desp: raw.desp,
      url: raw.url,
      channel: raw.channel,
      // Body/query token wins over the Authorization header (legacy clients).
      token: raw.token || bearer,
      to: raw.to,
      openid: raw.openid,
      async: raw.async,
      render_mode: raw.render_mode,
    };
  }
}
