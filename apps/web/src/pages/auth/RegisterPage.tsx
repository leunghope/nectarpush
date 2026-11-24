import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, call } from '@/api/client';
import { errMessage } from '@/lib/errors';
import { useDocumentTitle } from '@/hooks/misc';
import { toast } from '@/stores/ui';
import type { TurnstileSiteKeyData } from '@nectarpush/shared';
import { AuthShell } from '@/components/layout/Shells';
import { Field } from '@/components/ui/Field';
import { Alert } from '@/components/ui/Feedback';
import { Turnstile } from '@/components/ui/Turnstile';

export function RegisterPage() {
  useDocumentTitle('注册');
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', password: '', display_name: '', email: '', code: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [turnstile, setTurnstile] = useState('');

  const { data: ts } = useQuery({
    queryKey: ['turnstile-site'],
    queryFn: () => call<TurnstileSiteKeyData>(api.GET('/api/public/turnstile-sitekey')),
    staleTime: 5 * 60_000,
  });
  const turnstileEnabled = !!ts?.enabled && !!ts?.site_key;

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function sendCode() {
    if (!form.email) {
      setError('请先填写邮箱');
      return;
    }
    setError('');
    setSending(true);
    try {
      await call(api.POST('/api/auth/verification', {
        body: { email: form.email, turnstile_token: turnstileEnabled ? turnstile : undefined },
      }));
      toast.success('验证码已发送，请查收邮箱');
      setCooldown(60);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSending(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!form.username || !form.password) {
      setError('请填写用户名和密码');
      return;
    }
    if (form.password.length < 8 || form.password.length > 20) {
      setError('密码长度需为 8–20 位');
      return;
    }
    setBusy(true);
    try {
      await call(api.POST('/api/auth/register', {
        body: {
          username: form.username,
          password: form.password,
          display_name: form.display_name || undefined,
          email: form.email || undefined,
          verification_code: form.code || undefined,
          turnstile_token: turnstileEnabled ? turnstile : undefined,
        },
      }));
      toast.success('注册成功，请登录');
      navigate('/login', { replace: true });
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      kicker="Auth / Register"
      title="创建账号"
      lede="只需一分钟，开始统一管理消息推送。"
      footer={
        <>
          已有账户？<Link to="/login">返回登录</Link>
        </>
      }
    >
      <form onSubmit={submit} noValidate>
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="用户名" htmlFor="username" hint="1–12 位" required>
          <input id="username" className="input" autoComplete="username" value={form.username} onChange={(e) => set('username', e.target.value)} />
        </Field>
        <Field label="密码" htmlFor="password" hint="8–20 位" required>
          <input id="password" type="password" className="input" autoComplete="new-password" value={form.password} onChange={(e) => set('password', e.target.value)} />
        </Field>
        <Field label="显示名称" htmlFor="display_name" hint="可选 · ≤20 位">
          <input id="display_name" className="input" value={form.display_name} onChange={(e) => set('display_name', e.target.value)} />
        </Field>
        <Field label="邮箱" htmlFor="email" hint="如已开启邮箱验证，则必填">
          <input id="email" type="email" className="input" autoComplete="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field
          label="邮箱验证码"
          htmlFor="code"
          hint="如已开启邮箱验证，则必填"
        >
          <div className="input-group">
            <input id="code" className="input" value={form.code} onChange={(e) => set('code', e.target.value)} />
            <button type="button" className="btn" onClick={sendCode} disabled={sending || cooldown > 0}>
              {cooldown > 0 ? `${cooldown}s` : sending ? '发送中…' : '获取验证码'}
            </button>
          </div>
        </Field>
        {turnstileEnabled && ts?.site_key && (
          <div className="field">
            <Turnstile siteKey={ts.site_key} onToken={setTurnstile} />
          </div>
        )}
        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
          {busy ? '正在注册…' : '注册'}
        </button>
      </form>
    </AuthShell>
  );
}
