import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  // NestJS relies on emitDecoratorMetadata, which esbuild does not emit.
  // unplugin-swc keeps constructor-param injection working under vitest.
  plugins: [swc.vite()],
  test: {
    include: ['test/**/*.spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
  },
});
