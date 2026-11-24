import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import {
  NestFastifyApplication,
  FastifyAdapter,
} from '@nestjs/platform-fastify';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { AppModule } from './app.module';
import { EnvelopeInterceptor } from './common/envelope.interceptor';
import { UnifiedExceptionFilter } from './common/exception.filter';
import { PrismaService } from './prisma/prisma.service';
import { attachWsServer } from './realtime/ws-server';
import { sseHeartbeat } from './realtime/sse-hub';
import { consumeRateLimit, rateLimitClassOf, shouldRateLimit } from './common/rate-limit';

const WEB_DIST = join(__dirname, '..', '..', 'web', 'dist');
const API_PREFIXES = ['/api/', '/push/', '/webhook/', '/ws/'];

/**
 * Nest installs a root "not found" handler during app.init(). Fastify throws if a
 * root not-found handler is already set, so the SPA fallback cannot be installed via
 * setNotFoundHandler. Instead we override the adapter so Nest's own 404 registration
 * installs a catch-all GET route: unknown API paths get the unified JSON 404, while
 * any other path falls back to index.html (client-side routing / deep-link refresh).
 */
class SpaFastifyAdapter extends FastifyAdapter {
  setNotFoundHandler(handler: any): any {
    if (!existsSync(WEB_DIST)) {
      return super.setNotFoundHandler(handler);
    }
    const instance = this.getInstance<any>();
    instance.get('/*', (req: any, reply: any) => {
      const url: string = req.raw?.url || req.url || '/';
      if (API_PREFIXES.some((p) => url === p.slice(0, -1) || url.startsWith(p))) {
        return reply.code(404).send({
          success: false,
          message: '资源不存在',
          code: 'NOT_FOUND',
        });
      }
      return reply.sendFile('index.html');
    });
  }
}


async function bootstrap(): Promise<void> {
  // Q-09: never trust X-Forwarded-For unless the operator says the app sits
  // behind a proxy that overwrites it. Trusting it by default let any caller
  // rotate the rate-limit bucket with a spoofed header.
  const trustProxy = process.env.TRUST_PROXY === 'true';
  const adapter = new SpaFastifyAdapter({
    trustProxy,
    bodyLimit: 1024 * 1024,
  });
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    adapter,
    { logger: ['log', 'warn', 'error'] },
  );

  await app.register(fastifyCookie, {});
  // Stage 12 / A7: CORS is an explicit allowlist when CORS_ORIGINS is set.
  // With it unset we keep the historical "reflect any origin" behaviour so the
  // Vite dev server works out of the box — but that is unsafe in production:
  // combined with credentials, any site could call the API with the user's
  // cookie. Production deployments must set CORS_ORIGINS=https://<domain>.
  const corsOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  await app.register(fastifyCors, {
    origin: corsOrigins.length > 0 ? corsOrigins : true,
    credentials: true,
  });
  if (corsOrigins.length === 0) {
    // eslint-disable-next-line no-console
    console.warn(
      '[NectarPush] CORS_ORIGINS is not set: any origin may call the API with credentials. Set it in production.',
    );
  }

  // The envelope interceptor + unified exception filter are registered in
  // AppModule (APP_INTERCEPTOR / APP_FILTER) so tests share the same pipeline.
  app.enableShutdownHooks();

  // ---- Rate limiting (preHandler, per-IP, class by route) ----
  const instance = app.getHttpAdapter().getInstance();
  instance.addHook('preHandler', async (req: any, reply: any) => {
    // req.ip is the socket address, or the client address derived by Fastify
    // from X-Forwarded-For only when trustProxy is enabled (TRUST_PROXY=true).
    const ip = req.ip || 'unknown';
    const url = req.url || '/';
    if (!shouldRateLimit(url)) return;
    const cls = rateLimitClassOf(url);
    const retryAfter = consumeRateLimit(cls, ip);
    if (retryAfter !== null) {
      reply.header('retry-after', String(retryAfter));
      return reply.code(429).send({
        success: false,
        message: '请求过于频繁，请稍后再试',
        code: 'RATE_LIMITED',
      });
    }
  });

  // ---- Static SPA (built frontend) ----
  // Serve real files from dist at the root. Unknown non-API paths are handled by
  // the catch-all route installed via SpaFastifyAdapter.setNotFoundHandler above.
  if (existsSync(WEB_DIST)) {
    await app.register(fastifyStatic, {
      root: WEB_DIST,
      prefix: '/',
      wildcard: false,
    });
  }

  const port = Number(process.env.PORT || 3000);
  await app.listen(port, '0.0.0.0');
  if (trustProxy) {
    // eslint-disable-next-line no-console
    console.log('[NectarPush] TRUST_PROXY=true: X-Forwarded-For is trusted; only enable behind a proxy that overwrites it.');
  }

  // ---- Realtime: WS endpoint + SSE heartbeat ----
  const prisma = app.get(PrismaService);
  attachWsServer(app.getHttpServer(), prisma);
  const sseTimer = setInterval(sseHeartbeat, 25_000);
  process.on('SIGTERM', () => clearInterval(sseTimer));
  process.on('SIGINT', () => clearInterval(sseTimer));

  // eslint-disable-next-line no-console
  console.log(`[NectarPush] API listening on http://127.0.0.1:${port}`);
}

void bootstrap();
