import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { bootstrap, call, cookieOf, loginRoot, type TestApp } from './helpers/app';

/**
 * D-03 OAuth 多绑全链路 e2e：登录自动建号 / 登录命中绑定 / 一用户多绑 /
 * 同身份幂等 / 跨用户拒绝 / 解绑后再绑 / email 重复友好错误（B-03）/ 注销清绑定。
 *
 * 应用与测试同进程（bootstrap in-process），故用选择性 fetch stub 拦截 provider
 * 的 token/userinfo 外呼；其余 URL（本地 HTTP）透传真 fetch，避免打断 call()。
 * 每个测试用独立 provider（pa..pg）与独立身份，避免相互污染。
 */
const SSO = 'https://sso.test/';
const PROVIDER_IDS = ['pa', 'pb', 'pc', 'pd', 'pe', 'pf', 'pg'];
const identities = new Map<string, { sub: string; email: string | null }>();
function setIdentity(providerId: string, sub: string, email: string | null = null) {
  identities.set(`${SSO}${providerId}/userinfo`, { sub, email });
}
function providerConfig(id: string) {
  return {
    id,
    display_name: id.toUpperCase(),
    authorize_url: `${SSO}${id}/authorize`,
    token_url: `${SSO}${id}/token`,
    userinfo_url: `${SSO}${id}/userinfo`,
    client_id: 'cid',
    client_secret: 'secret',
    scope: 'openid profile email',
    map_username: 'sub',
    map_email: 'email',
  };
}

describe('D-03 OAuth multi-bind (阶段3 B4)', () => {
  let t: TestApp;
  let base = '';
  let rootCookie = '';
  let alice = '';
  let bob = '';
  let realFetch: typeof fetch;
  let autoUsername = '';

  async function makeUser(username: string, password: string, email?: string): Promise<string> {
    const reg = await call(base, '/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, ...(email ? { email } : {}) }),
    });
    expect(reg.status, reg.raw).toBe(200);
    const login = await call(base, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    expect(login.status, login.raw).toBe(200);
    return cookieOf(login.setCookie);
  }

  async function startState(path: string, cookie?: string): Promise<string> {
    const res = await fetch(`${base}${path}`, {
      headers: cookie ? { cookie } : {},
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    const state = new URL(res.headers.get('location') ?? '').searchParams.get('state');
    expect(state).toBeTruthy();
    return state!;
  }
  async function loginCallback(providerId: string): Promise<Response> {
    const state = await startState(`/api/auth/oauth/${providerId}/start`);
    return fetch(`${base}/api/auth/oauth/${providerId}/callback?code=TESTCODE&state=${state}`, {
      redirect: 'manual',
    });
  }
  async function bindCallback(providerId: string, cookie: string): Promise<Response> {
    const state = await startState(`/api/me/oauth/${providerId}/start`, cookie);
    return fetch(`${base}/api/auth/oauth/${providerId}/callback?code=TESTCODE&state=${state}`, {
      redirect: 'manual',
    });
  }
  async function bindingsOf(cookie: string): Promise<any[]> {
    const res = await call(base, '/api/me/security', { cookie });
    expect(res.status).toBe(200);
    return (res.body?.data as any).oauth.bindings;
  }

  beforeAll(async () => {
    // 选择性 fetch stub：只拦 provider 外呼，其余透传。
    realFetch = global.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any, init?: any) => {
        const u = String(url);
        if (u.startsWith(SSO)) {
          if (u.endsWith('/token')) {
            return new Response(JSON.stringify({ access_token: 'TOK', token_type: 'bearer' }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          }
          if (u.endsWith('/userinfo')) {
            return new Response(JSON.stringify(identities.get(u) ?? { sub: 'anon', email: null }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          }
        }
        return realFetch(url, init);
      }),
    );

    t = await bootstrap();
    base = t.base;
    // 新库 root 强制改密（D-02）：先改密再取管理 cookie。
    rootCookie = await loginRoot(base, '123456');
    const chg = await call(base, '/api/me', {
      method: 'PATCH',
      cookie: rootCookie,
      body: JSON.stringify({ old_password: '123456', password: 'root-oauth-pass' }),
    });
    expect(chg.status, chg.raw).toBe(200);
    rootCookie = await loginRoot(base, 'root-oauth-pass');

    alice = await makeUser('oauth-alice', 'alice-pass-42');
    bob = await makeUser('oauth-bob', 'bob-pass-42');

    const patch = await call(base, '/api/options', {
      method: 'PATCH',
      cookie: rootCookie,
      body: JSON.stringify({
        key: 'OAuth2Providers',
        value: JSON.stringify(PROVIDER_IDS.map(providerConfig)),
      }),
    });
    expect(patch.status, patch.raw).toBe(200);
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await t.close();
    t.cleanup();
  });

  it('OAuth 登录自动建号：无密码、生成绑定', async () => {
    setIdentity('pd', 'pd-new');
    const res = await loginCallback('pd');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/?oauth=ok');
    const cookie = cookieOf(res.headers.get('set-cookie') ?? undefined);
    const me = await call(base, '/api/me', { cookie });
    expect(me.status).toBe(200);
    autoUsername = (me.body?.data as any).username;
    expect(autoUsername).toBeTruthy();
    const sec = await call(base, '/api/me/security', { cookie });
    const data = sec.body?.data as any;
    expect(data.has_password).toBe(false);
    expect(data.oauth.bindings).toEqual([
      { provider: 'pd', display_name: 'PD', oauth_id: 'pd-new' },
    ]);
  });

  it('OAuth 登录命中既有绑定：登录同一用户，不重复建号', async () => {
    setIdentity('pd', 'pd-new');
    const res = await loginCallback('pd');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/?oauth=ok');
    const cookie = cookieOf(res.headers.get('set-cookie') ?? undefined);
    const me = await call(base, '/api/me', { cookie });
    expect((me.body?.data as any).username).toBe(autoUsername);
    expect(await bindingsOf(cookie)).toHaveLength(1);
  });

  it('一用户可绑定多个 provider（多绑）', async () => {
    setIdentity('pa', 'alice-a');
    setIdentity('pb', 'alice-b');
    expect((await bindCallback('pa', alice)).headers.get('location')).toContain('oauth_bound=pa');
    expect((await bindCallback('pb', alice)).headers.get('location')).toContain('oauth_bound=pb');
    const bindings = await bindingsOf(alice);
    expect(bindings.map((b) => b.provider).sort()).toEqual(['pa', 'pb']);
    expect(bindings.find((b) => b.provider === 'pa').oauth_id).toBe('alice-a');
    expect(bindings.find((b) => b.provider === 'pb').oauth_id).toBe('alice-b');
  });

  it('同一身份重复绑定本人幂等：不产生重复绑定行', async () => {
    setIdentity('pa', 'alice-a');
    expect((await bindCallback('pa', alice)).headers.get('location')).toContain('oauth_bound=pa');
    const bindings = await bindingsOf(alice);
    expect(bindings.filter((b) => b.provider === 'pa')).toHaveLength(1);
  });

  it('跨用户拒绝：身份已绑他人 → already_bound', async () => {
    setIdentity('pc', 'carol-shared');
    expect((await bindCallback('pc', alice)).headers.get('location')).toContain('oauth_bound=pc');
    // bob 试图绑定同一身份 → 拒绝。
    const res = await bindCallback('pc', bob);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/me?oauth_error=already_bound');
    expect(await bindingsOf(bob)).toEqual([]);
    // alice 的绑定不受影响。
    expect((await bindingsOf(alice)).some((b) => b.provider === 'pc')).toBe(true);
  });

  it('解绑后身份释放，可被他人重新绑定', async () => {
    setIdentity('pe', 'pe-shared');
    expect((await bindCallback('pe', alice)).headers.get('location')).toContain('oauth_bound=pe');
    const unbind = await call(base, '/api/me/oauth/pe', { method: 'DELETE', cookie: alice });
    expect(unbind.status, unbind.raw).toBe(200);
    expect((await bindingsOf(alice)).some((b) => b.provider === 'pe')).toBe(false);
    // 身份已释放 → bob 现在可以绑定。
    expect((await bindCallback('pe', bob)).headers.get('location')).toContain('oauth_bound=pe');
    expect((await bindingsOf(bob)).some((b) => b.provider === 'pe')).toBe(true);
  });

  it('email 重复自动建号 → 友好错误（B-03），不建号不 500', async () => {
    await makeUser('oauth-carol', 'carol-pass-42', 'dup@example.com');
    setIdentity('pf', 'pf-fresh', 'dup@example.com');
    const res = await loginCallback('pf');
    // 优雅重定向到错误页（非 500），且未下发会话。
    expect(res.status).toBe(302);
    const loc = res.headers.get('location') ?? '';
    expect(loc).toContain('/login?oauth_error=');
    expect(loc).not.toContain('oauth=ok');
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('注销账号清空其全部绑定，身份可被他人绑定', async () => {
    const dave = await makeUser('oauth-dave', 'dave-pass-42');
    setIdentity('pg', 'dave-g');
    expect((await bindCallback('pg', dave)).headers.get('location')).toContain('oauth_bound=pg');
    expect(await bindingsOf(dave)).toHaveLength(1);
    const del = await call(base, '/api/me', { method: 'DELETE', cookie: dave });
    expect(del.status, del.raw).toBe(200);
    // dave 已软删，其绑定应被清空 → bob 可绑定同一身份。
    expect((await bindCallback('pg', bob)).headers.get('location')).toContain('oauth_bound=pg');
    expect((await bindingsOf(bob)).some((b) => b.provider === 'pg')).toBe(true);
  });
});
