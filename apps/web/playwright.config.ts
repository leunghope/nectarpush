import { defineConfig, devices } from '@playwright/test';
import { ROOT_STATE } from './e2e/helpers';

/**
 * E2E runs against a production build served by the real API on a throwaway
 * SQLite database (see ./e2e/global-setup.ts). That way the same run also
 * proves the backend's static hosting + SPA fallback behaviour.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  globalSetup: './e2e/global-setup.ts',
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'zh-CN',
  },
  projects: [
    {
      // Runs first and writes the root storageState consumed by every spec.
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'chromium',
      testIgnore: /auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: ROOT_STATE },
      dependencies: ['setup'],
    },
  ],
});