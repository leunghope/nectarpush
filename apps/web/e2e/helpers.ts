import { expect, request as pwRequest, type APIRequestContext, type Page } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

/** Password the setup project sets for root; later journeys reuse the session. */
export const ROOT_PASS = 'rootE2ePass123';

export const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3100';

/** Root storage state produced by auth.setup.ts and reused by every spec. */
export const ROOT_STATE = path.join(os.tmpdir(), 'nectarpush-e2e-root.json');

export type User = {
  id: number;
  username: string;
  role: 'user' | 'admin' | 'root';
  status: 'active' | 'disabled';
  must_change_password: boolean;
  email: string | null;
};

/** Signs in through the real login form and waits for the workbench. */
export async function login(page: Page, username = 'root', password = ROOT_PASS): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/用户名/).fill(username);
  await page.getByLabel(/密码/).fill(password);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByRole('heading', { name: '工作台' })).toBeVisible({ timeout: 20_000 });
}

/** Reads the first page of messages through the authenticated session. */
export async function firstMessage(page: Page): Promise<{ id: number; uuid: string; title: string | null }> {
  const res = await page.request.get('/api/messages?page=1&page_size=10');
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return body.data.items[0];
}

export async function listChannels(page: Page): Promise<Array<{ id: number; name: string; type: string; enabled: boolean }>> {
  const res = await page.request.get('/api/channels?brief=true');
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return body.data.items;
}

/** Calls the real login endpoint; the context keeps the np_session cookie. */
export async function apiLogin(
  ctx: APIRequestContext,
  username: string,
  password: string,
): Promise<User> {
  const res = await ctx.post('/api/auth/login', { data: { username, password } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).data.user as User;
}

/** Root-only: creates a user and returns its numeric id. */
export async function createUser(
  ctx: APIRequestContext,
  username: string,
  password: string,
  role: 'user' | 'admin' = 'user',
): Promise<number> {
  const res = await ctx.post('/api/users', { data: { username, password, role } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).data.id as number;
}

/** Admin password reset also flips must_change_password=true on the server. */
export async function adminResetPassword(
  ctx: APIRequestContext,
  userId: number,
  password: string,
): Promise<void> {
  const res = await ctx.patch(`/api/users/${userId}`, { data: { password } });
  expect(res.ok(), await res.text()).toBeTruthy();
}

/** Builds a storageState for a named account so specs can reuse the session. */
export async function storageStateFor(
  username: string,
  password: string,
  xff?: string,
): Promise<Awaited<ReturnType<APIRequestContext['storageState']>>> {
  const ctx = await pwRequest.newContext({
    baseURL: BASE,
    extraHTTPHeaders: xff ? { 'x-forwarded-for': xff } : undefined,
  });
  try {
    await apiLogin(ctx, username, password);
    return ctx.storageState();
  } finally {
    await ctx.dispose();
  }
}
/** Root-only: PATCH one system option (value must be a string). */
export async function setOption(
  ctx: APIRequestContext,
  key: string,
  value: string,
): Promise<void> {
  const res = await ctx.patch('/api/options', { data: { key, value } });
  expect(res.ok(), `${key}: ${await res.text()}`).toBeTruthy();
}
