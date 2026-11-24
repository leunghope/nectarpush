import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, call } from '@/api/client';
import { errMessage } from '@/lib/errors';
import { useDocumentTitle } from '@/hooks/misc';
import type { TurnstileSiteKeyData } from '@nectarpush/shared';
import { AuthShell } from '@/components/layout/Shells';
import { Field } from '@/components/ui/Field';
import { Alert } from '@/components/ui/Feedback';
import { Turnstile } from '@/components/ui/Turnstile';

export function ResetRequestPage() {
  useDocumentTitle('找回密码');
  const [email, setEmail] = useState('');
  const [turnstile, setTurnstile] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const { data: ts } = useQuery({
    queryKey: ['turnstile-site'],
    queryFn: () => call<TurnstileSiteKeyData>(api.GET('/api/public/turnstile-sitekey')),
    staleTime: 5 * 60_000,
  });
  const turnstileEnabled = !!ts?.enabled && !!ts?.site_key;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!email) {
      setError('请输入邮箱地址');
      return;
    }
    setBusy(true);
    try {
      await call(api.POST('/api/auth/reset-request', {
        body: { email, turnstile_token: turnstileEnabled ? turnstile : undefined },
      }));
      setDone(true);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      kicker="Auth / Recovery"
      title="找回密码"
      lede="通过安全邮件链接重置你的密码。"
      footer={
        <>
          想起来了？<Link to="/login">返回登录</Link>
        </>
      }
    >
      {done ? (
        <>
          <Alert tone="success">如果该邮箱已注册，重置链接已发送，请查收邮箱（含垃圾箱）。</Alert>
          <p className="auth-lede">收到邮件后点击其中的链接即可完成密码重置。</p>
        </>
      ) : (
        <form onSubmit={submit} noValidate>
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="邮箱" htmlFor="email" required>
            <input id="email" type="email" className="input" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          {turnstileEnabled && ts?.site_key && (
            <div className="field">
              <Turnstile siteKey={ts.site_key} onToken={setTurnstile} />
            </div>
          )}
          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
            {busy ? '提交中…' : '发送重置邮件'}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
