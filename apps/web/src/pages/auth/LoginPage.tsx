import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, call } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { errMessage } from '@/lib/errors';
import { useDocumentTitle } from '@/hooks/misc';
import { useBranding } from '@/hooks/branding';
import type { OAuthProviderListData, User } from '@nectarpush/shared';
import { AuthShell } from '@/components/layout/Shells';
import { Field } from '@/components/ui/Field';
import { Alert } from '@/components/ui/Feedback';
import { oauthErrorText } from './oauthErrors';

type LoginResult = { user: User; must_change_password: boolean };

export function LoginPage() {
  useDocumentTitle('登录');
  const brand = useBranding();
  const [params] = useSearchParams();
  const next = params.get('next') || '/';
  const navigate = useNavigate();
  const status = useAuthStore((s) => s.status);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const oauthError = params.get('oauth_error');
  const providersQ = useQuery({
    queryKey: ['oauth-providers'],
    queryFn: () => call<OAuthProviderListData>(api.GET('/api/auth/oauth/providers')),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const providers = providersQ.data?.items ?? [];

  if (status === 'authenticated') return <Navigate to={next} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!username || !password) {
      setError('请输入用户名和密码');
      return;
    }
    setBusy(true);
    try {
      const data = await call<LoginResult>(api.POST('/api/auth/login', { body: { username, password } }));
      const store = useAuthStore.getState();
      store.setAuthenticated(data.user);
      if (data.must_change_password) store.markPasswordChangeRequired();
      navigate(data.must_change_password ? '/me' : next, { replace: true });
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      kicker="Auth / Sign in"
      title="欢迎回来"
      lede={`登录 ${brand.site_name}，继续管理你的消息通道。`}
      footer={
        <>
          还没有账户？<Link to="/register">注册</Link> · <Link to="/reset">忘记密码</Link>
        </>
      }
    >
      <form onSubmit={submit} noValidate>
        {error && <Alert tone="error">{error}</Alert>}
        {oauthError && <Alert tone="error">{oauthErrorText(oauthError)}</Alert>}
        <Field label="用户名" htmlFor="username" required>
          <input
            id="username"
            className="input"
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </Field>
        <Field label="密码" htmlFor="password" required>
          <input
            id="password"
            type="password"
            className="input"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
          {busy ? '正在登录…' : '登录'}
        </button>
      </form>
      {providers.length > 0 && (
        <>
          <div className="auth-divider">或使用第三方账号</div>
          <div className="oauth-login-list">
            {providers.map((p) => (
              <a
                key={p.id}
                className="btn btn-block"
                href={`/api/auth/oauth/${encodeURIComponent(p.id)}/start`}
              >
                使用 {p.display_name} 登录
              </a>
            ))}
          </div>
        </>
      )}
    </AuthShell>
  );
}
