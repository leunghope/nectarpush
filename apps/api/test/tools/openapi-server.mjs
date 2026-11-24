/**
 * Contract-fuzzing harness: boots the compiled Nest app over real HTTP without
 * main.ts' rate limiter / static hosting. Used by Stage 7 QA to run schemathesis
 * against a throwaway SQLite database (see docs/QA_REPORT.md §契约).
 *
 * Usage: DATABASE_URL=file:/tmp/... PORT=3201 SESSION_SECRET=... node apps/api/test/tools/openapi-server.mjs
 */
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';

const port = Number(process.env.PORT || 3201);
const { AppModule } = await import('../../dist/app.module.js');
const app = await NestFactory.create(AppModule, new FastifyAdapter({ logger: false }), { logger: false });
await app.register(cookie, {});
await app.listen(port, '127.0.0.1');
console.log(`contract server listening on http://127.0.0.1:${port}`);
