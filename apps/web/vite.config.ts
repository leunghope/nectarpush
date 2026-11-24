/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Vite dev proxy. NOTE: the key MUST be '/webhook/' (with trailing slash).
// A bare '/webhook' key prefix-matches and would swallow the SPA route
// '/webhooks', forwarding document requests to the API and returning 404.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: true },
      '/push': { target: 'http://127.0.0.1:3000', changeOrigin: true },
      '/webhook/': { target: 'http://127.0.0.1:3000', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:3000', ws: true },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
