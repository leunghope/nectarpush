import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../src/modules/auth/auth.service';
import type { OAuthProviderConfig } from '../src/modules/oauth/providers';

const provider: OAuthProviderConfig = {
  id: 'authentik',
  display_name: 'Leunghope SSO',
  authorize_url: 'https://sso.example.com/application/o/authorize/',
  token_url: 'https://sso.example.com/application/o/token/',
  userinfo_url: 'https://sso.example.com/application/o/userinfo/',
  client_id: 'cid',
  client_secret: 'S3CR3T',
  scope: 'openid email profile',
  map_username: 'sub',
  map_email: 'email',
};

function makeService() {
  const prisma = {
    user: {
      findFirst: vi.fn(async () => ({ id: 7, username: 'authentik_abc', status: 'active' })),
      create: vi.fn(),
    },
    // D-03：oauthLogin 先查绑定表；命中且属主未软删即登录。
    oAuthBinding: {
      findFirst: vi.fn(async () => ({
        id: 1,
        userId: 7,
        provider: 'authentik',
        oauthId: 'abc-123',
        user: { id: 7, username: 'authentik_abc', status: 'active', deletedAt: null },
      })),
    },
  };
  const options = { get: () => '', getBool: () => false };
  const users = { toView: (u: { id: number; username: string; status: string }) => u };
  const channels = { ensureEmailChannel: vi.fn(async () => undefined) };
  return new AuthService(prisma as never, options as never, users as never, channels as never);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AuthService.oauthLogin (O-1: form-encoded token request)', () => {
  it('POSTs application/x-www-form-urlencoded with the four fields, then uses userinfo', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url === provider.token_url) {
          return new Response(JSON.stringify({ access_token: 'TOK', token_type: 'bearer' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ sub: 'abc-123', email: 'a@b.c' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    const svc = makeService();
    const { user } = await svc.oauthLogin(provider, 'AUTHCODE', 'http://127.0.0.1:3300/api/auth/oauth/authentik/callback');

    // token request assertions
    expect(calls[0].url).toBe(provider.token_url);
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/x-www-form-urlencoded');
    const body = new URLSearchParams(String(calls[0].init?.body));
    expect(body.get('client_id')).toBe('cid');
    expect(body.get('client_secret')).toBe('S3CR3T');
    expect(body.get('code')).toBe('AUTHCODE');
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('redirect_uri')).toBe('http://127.0.0.1:3300/api/auth/oauth/authentik/callback');

    // userinfo request carries the bearer token
    expect(calls[1].url).toBe(provider.userinfo_url);
    expect((calls[1].init?.headers as Record<string, string>).authorization).toBe('Bearer TOK');
    expect(user).toMatchObject({ id: 7 });
  });

  it('accepts a form-urlencoded token response body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === provider.token_url) {
          return new Response('access_token=TOK2&token_type=bearer', { status: 200 });
        }
        return new Response(JSON.stringify({ sub: 'abc' }), { status: 200 });
      }),
    );
    const svc = makeService();
    const { user } = await svc.oauthLogin(provider, 'CODE');
    expect(user).toMatchObject({ id: 7 });
  });

  it('throws UNAUTHORIZED when no access_token is returned', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })),
    );
    const svc = makeService();
    await expect(svc.oauthLogin(provider, 'BAD')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('AuthService OAuth state + binding', () => {
  function makeBindService(owner: { id: number } | null) {
    const prisma = {
      user: {
        // oauthBind 先按 id 取当前用户（target）。
        findFirst: vi.fn(async () => ({ id: 7, username: 'me', status: 'active', deletedAt: null })),
      },
      // D-03：再查绑定表判断身份归属；owner=null 表示该身份尚未被绑定。
      oAuthBinding: {
        findFirst: vi.fn(async () =>
          owner
            ? {
                id: 1,
                userId: owner.id,
                provider: 'authentik',
                oauthId: 'abc-123',
                user: { id: owner.id, deletedAt: null },
              }
            : null,
        ),
        create: vi.fn(async () => ({ id: 2, userId: 7, provider: 'authentik', oauthId: 'abc-123' })),
      },
    };
    const options = { get: () => '', getBool: () => true };
    const users = { toView: (u: unknown) => u };
    const channels = { ensureEmailChannel: vi.fn(async () => undefined) };
    return new AuthService(prisma as never, options as never, users as never, channels as never);
  }

  function stubIdentity() {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === provider.token_url) {
        return new Response(JSON.stringify({ access_token: 'TOK' }), { status: 200 });
      }
      return new Response(JSON.stringify({ sub: 'abc-123', email: 'a@b.c' }), { status: 200 });
    }));
  }

  it('stores bind intent in the state payload and consumes it once', () => {
    const svc = makeService();
    const { url } = svc.buildAuthorizeUrl(provider, 'http://127.0.0.1:3000/cb', { mode: 'bind', userId: 7 });
    const state = new URL(url).searchParams.get('state')!;
    expect(svc.consumeState(state)).toMatchObject({ mode: 'bind', userId: 7 });
    expect(svc.consumeState(state)).toBeNull();
  });

  it('binds the identity to the signed-in account', async () => {
    stubIdentity();
    const svc = makeBindService(null);
    const user = await svc.oauthBind(7, provider, 'CODE');
    expect(user).toMatchObject({ id: 7 });
  });

  it('rejects binding an identity already owned by another account', async () => {
    stubIdentity();
    const svc = makeBindService({ id: 9 });
    await expect(svc.oauthBind(7, provider, 'CODE'))
      .rejects.toMatchObject({ code: 'OAUTH_ALREADY_BOUND' });
  });
});

describe('AuthService.oauthLogin email duplicate (B-03 协同)', () => {
  it('自动建号前发现映射邮箱已被占用 → 友好 DUPLICATE_NAME，不建号', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === provider.token_url) {
          return new Response(JSON.stringify({ access_token: 'TOK' }), { status: 200 });
        }
        return new Response(JSON.stringify({ sub: 'brand-new-id', email: 'dup@example.com' }), {
          status: 200,
        });
      }),
    );
    const prisma = {
      user: {
        // email 查重命中已有账号。
        findFirst: vi.fn(async () => ({ id: 99, username: 'existing', email: 'dup@example.com' })),
        create: vi.fn(),
      },
      oAuthBinding: { findFirst: vi.fn(async () => null) },
    };
    const options = { get: () => '', getBool: () => true };
    const users = { toView: (u: unknown) => u };
    const channels = { ensureEmailChannel: vi.fn(async () => undefined) };
    const svc = new AuthService(prisma as never, options as never, users as never, channels as never);
    await expect(svc.oauthLogin(provider, 'CODE')).rejects.toMatchObject({
      code: 'DUPLICATE_NAME',
      message: expect.stringContaining('该邮箱已被其他账号使用'),
    });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });
});
