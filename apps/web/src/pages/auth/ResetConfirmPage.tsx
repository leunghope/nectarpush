import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, call } from '@/api/client';
import { errMessage } from '@/lib/errors';
import { useDocumentTitle } from '@/hooks/misc';
import { AuthShell } from '@/components/layout/Shells';
import { Field } from '@/components/ui/Field';
import { Alert } from '@/components/ui/Feedback';

/**
 * D-06（阶段3）：重置页由用户自设新密码；成功后只提示成功，
 * 不再展示/复制任何明文密码（取代原「展示随机新密码」）。
 */
export function ResetConfirmPage() {
  useDocumentTitle('重置密码');
  const [params] = useSearchParams();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [token, setToken] = useState(params.get('token') ?? '');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!email || !token) {
      setError('请填写邮箱与重置令牌');
      return;
    }
    if (newPassword.length < 8 || newPassword.length > 20) {
      setError('新密码长度需为 8–20 位');
      return;
    }
    if (newPassword !== confirm) {
      setError('两次输入的新密码不一致');
      return;
    }
    setBusy(true);
    try {
      await call(
        api.POST('/api/auth/reset-confirm', {
          body: { email, token, new_password: newPassword, new_password_confirm: confirm },
        }),
      );
      setDone(true);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      kicker="Auth / Reset"
      title={done ? '密码已重置' : '设置新密码'}
      lede={done ? '现在可以使用新密码登录。' : '重置链接仅可使用一次，30 分钟内有效。'}
      footer={
        <>
          <Link to="/login">返回登录</Link>
        </>
      }
    >
      {done ? (
        <>
          <Alert tone="success">密码已重置，请使用新密码登录。</Alert>
          <Link to="/login" className="btn btn-primary btn-block">
            前往登录
          </Link>
        </>
      ) : (
        <form onSubmit={submit} noValidate>
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="邮箱" htmlFor="email" required>
            <input id="email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="重置令牌" htmlFor="token" hint="来自邮件链接" required>
            <input id="token" className="input" value={token} onChange={(e) => setToken(e.target.value)} />
          </Field>
          <Field label="新密码" htmlFor="new-password" hint="8–20 位" required>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                id="new-password"
                type={showPassword ? 'text' : 'password'}
                className="input"
                style={{ flex: 1 }}
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-ghost"
                aria-pressed={showPassword}
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? '隐藏' : '显示'}
              </button>
            </div>
          </Field>
          <Field label="确认新密码" htmlFor="confirm-password" required>
            <input
              id="confirm-password"
              type="password"
              className="input"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>
          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
            {busy ? '处理中…' : '重置密码'}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
