import { expect, test } from '@playwright/test';
import { BASE } from './helpers';

/**
 * J11j — 登录失败限流（PRD NFR 限流：临界端点 20 次/20 分钟）。
 *
 * Q-09 修复后语义：默认 TRUST_PROXY=false，X-Forwarded-For 被忽略（同一桶，
 * 伪造无法绕过）——该默认行为由 apps/api/test/proxy.int.spec.ts 用真实
 * main.js 集成验证。本 E2E 进程以 TRUST_PROXY=true 模拟"可信反向代理"部署，
 * 因此这里验证代理语义：同一 XFF 计数到阈值，换 XFF 得到新桶（由代理负责
 * 覆盖该头，不是终端用户可伪造的）。
 */
test.use({ extraHTTPHeaders: { 'x-forwarded-for': '10.77.12.1' } });

test('J11j 登录失败限流阈值与代理语义（TRUST_PROXY=true）', async ({ playwright }) => {
  const ctx = await playwright.request.newContext({
    baseURL: BASE,
    extraHTTPHeaders: { 'x-forwarded-for': '10.77.12.1' },
  });
  const statuses: number[] = [];
  let limitedAt = 0;
  for (let i = 1; i <= 25; i += 1) {
    const res = await ctx.post('/api/auth/login', {
      data: { username: 'qa-nobody', password: 'wrong-password' },
    });
    statuses.push(res.status());
    if (res.status() === 429) {
      limitedAt = i;
      const body = await res.json();
      expect(body.code).toBe('RATE_LIMITED');
      expect(res.headers()['retry-after']).toBeTruthy();
      break;
    }
  }
  expect(limitedAt, `statuses=${statuses.join(',')}`).toBeGreaterThan(0);
  expect(limitedAt).toBeLessThanOrEqual(21);
  expect(statuses.slice(0, limitedAt - 1).every((s) => s === 401)).toBeTruthy();

  const spoofed = await ctx.post('/api/auth/login', {
    headers: { 'x-forwarded-for': '10.77.12.2' },
    data: { username: 'qa-nobody', password: 'wrong-password' },
  });
  expect(spoofed.status(), '可信代理下新 XFF 属于新桶（默认部署由集成测试覆盖）').toBe(401);
  await ctx.dispose();
});
