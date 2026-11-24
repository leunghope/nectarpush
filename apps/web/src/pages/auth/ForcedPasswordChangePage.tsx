import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, call } from '@/api/client';
import { bootstrapAuth } from '@/lib/auth';
import { errMessage } from '@/lib/errors';
import { useAuthStore } from '@/stores/auth';
import { toast } from '@/stores/ui';
import { useDocumentTitle } from '@/hooks/misc';
import { Brand, ThemeToggle } from '@/components/ui/Brand';
import { Field } from '@/components/ui/Field';
import { Alert } from '@/components/ui/Feedback';

export function ForcedPasswordChangePage() {
  useDocumentTitle('修改密码');
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const [oldPassword, setOldPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!oldPassword || !password) {
      setError('请填写当前密码与新密码');
      return;
    }
    if (password.length < 8 || password.length > 20) {
      setError('新密码长度需为 8–20 位');
      return;
    }
    if (password !== confirm) {
      setError('两次输入的新密码不一致');
      return;
    }
    setBusy(true);
    try {
      await call(api.PATCH('/api/me', { body: { old_password: oldPassword, password } }));
      toast.success('密码已更新');
      await bootstrapAuth();
      navigate('/', { replace: true });
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    try {
      await call(api.POST('/api/auth/logout'));
    } catch {
      /* ignore */
    }
    useAuthStore.getState().markAnonymous();
  }

  return (
    <div className="auth-shell">
      <div className="auth-top">
        <Brand />
        <div className="top-actions">
          <ThemeToggle />
        </div>
      </div>
      <main className="auth-main">
        <div className="auth-wrap">
          <div className="auth-kicker">安全提示</div>
          <h1 className="auth-title">请先修改初始密码</h1>
          <p className="auth-lede">
            当前账户（{user?.username ?? '当前用户'}）使用初始密码，出于安全考虑必须先修改密码才能继续使用。
          </p>
          <form className="auth-form" onSubmit={submit} noValidate>
            {error && <Alert tone="error">{error}</Alert>}
            <Field label="当前密码" htmlFor="old_password" required>
              <input
                id="old_password"
                type="password"
                className="input"
                autoComplete="current-password"
                autoFocus
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
              />
            </Field>
            <Field label="新密码" htmlFor="password" hint="8–20 位" required>
              <input
                id="password"
                type="password"
                className="input"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <Field label="确认新密码" htmlFor="confirm" required>
              <input
                id="confirm"
                type="password"
                className="input"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </Field>
            <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
              {busy ? '正在保存…' : '保存并继续'}
            </button>
            <div className="form-actions" style={{ justifyContent: 'center' }}>
              <button type="button" className="btn btn-ghost" onClick={logout}>
                退出登录
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
