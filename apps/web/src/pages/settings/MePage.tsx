import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, call } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { errMessage } from '@/lib/errors';
import { useDocumentTitle } from '@/hooks/misc';
import { toast } from '@/stores/ui';
import type { EmailChangeData, PushSettingsData, User } from '@nectarpush/shared';
import { PageHead, Alert } from '@/components/ui/Feedback';
import { Field } from '@/components/ui/Field';
import { CopyButton } from '@/components/ui/CopyButton';
import { useConfirm } from '@/components/ui/Modal';
import { SettingsLayout, SettingsSection, type SettingsNavItem } from '@/components/layout/SettingsLayout';
import { oauthErrorText } from '@/pages/auth/oauthErrors';
import { OAuthBindingSection } from './OAuthBindingSection';
import { useMeSecurity } from './useMeSecurity';

type TokenResult = { token: string };

export function MePage() {
  useDocumentTitle('个人设置');
  const user = useAuthStore((s) => s.user);
  const patchUser = useAuthStore((s) => s.patchUser);
  const navigate = useNavigate();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const securityQ = useMeSecurity();

  const [username, setUsername] = useState(user?.username ?? '');
  const [displayName, setDisplayName] = useState(user?.display_name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [emailCode, setEmailCode] = useState('');
  const [emailNotice, setEmailNotice] = useState('');
  const [emailCooldown, setEmailCooldown] = useState(0);
  const [emailCodeBusy, setEmailCodeBusy] = useState(false);
  const [profileError, setProfileError] = useState('');

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwError, setPwError] = useState('');

  const [newToken, setNewToken] = useState<string | null>(null);

  const hasPassword = securityQ.data?.has_password ?? true;
  const emailChangeRequiresCode = securityQ.data?.email_change_requires_code ?? false;
  const currentEmail = user?.email ?? '';
  const emailChanged = email.trim() !== currentEmail;

  useEffect(() => {
    if (emailCooldown <= 0) return;
    const timer = window.setTimeout(() => setEmailCooldown((v) => v - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [emailCooldown]);

  const sections: SettingsNavItem[] = [
    { id: 'profile', label: '个人资料' },
    { id: 'password', label: hasPassword ? '修改密码' : '设置密码' },
    { id: 'oauth', label: '第三方登录' },
    { id: 'token', label: 'API Token' },
    ...(user?.role === 'root' ? [] : [{ id: 'danger', label: '注销账号' }]),
  ];

  useEffect(() => {
    const bound = params.get('oauth_bound');
    const err = params.get('oauth_error');
    if (!bound && !err) return;
    if (bound) toast.success(`已绑定 ${bound}`);
    if (err) toast.error(oauthErrorText(err));
    qc.invalidateQueries({ queryKey: ['me-security'] });
    navigate('/me', { replace: true });
  }, [params, qc, navigate]);

  const pushQ = useQuery({
    queryKey: ['me-push'],
    queryFn: () => call<PushSettingsData>(api.GET('/api/me/push')),
  });
  const tokenMasked = pushQ.data?.token_masked;

  const profileMut = useMutation({
    mutationFn: (body: {
      username?: string;
      display_name?: string;
      email?: string;
      email_code?: string;
    }) => call<User>(api.PATCH('/api/me', { body })),
    onSuccess: (u) => {
      patchUser(u);
      setEmailCode('');
      setEmailNotice('');
      qc.invalidateQueries({ queryKey: ['me-security'] });
      qc.invalidateQueries({ queryKey: ['channels'] });
      toast.success('账户信息已更新');
    },
    onError: (err) => setProfileError(errMessage(err)),
  });

  const passwordMut = useMutation({
    mutationFn: (body: { old_password?: string; password: string }) =>
      call<User>(api.PATCH('/api/me', { body })),
    onSuccess: (u) => {
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success('密码已更新');
      patchUser(u);
      qc.invalidateQueries({ queryKey: ['me-security'] });
    },
    onError: (err) => setPwError(errMessage(err)),
  });

  function submitProfile(e: FormEvent) {
    e.preventDefault();
    setProfileError('');
    if (!username.trim()) {
      setProfileError('请填写用户名');
      return;
    }
    const nextEmail = email.trim();
    if (nextEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
      setProfileError('请输入合法的邮箱地址');
      return;
    }
    if (emailChanged && nextEmail && !securityQ.data) {
      setProfileError('正在加载安全设置，请稍后重试');
      return;
    }
    const body: { username?: string; display_name?: string; email?: string; email_code?: string } = {
      username: username.trim(),
      display_name: displayName.trim(),
    };
    if (emailChanged) {
      body.email = nextEmail;
      if (emailChangeRequiresCode && nextEmail) {
        if (!/^\d{6}$/.test(emailCode.trim())) {
          setProfileError('请填写 6 位邮箱验证码');
          return;
        }
        body.email_code = emailCode.trim();
      }
    }
    profileMut.mutate(body);
  }

  async function sendEmailCode() {
    const nextEmail = email.trim();
    if (!nextEmail) return;
    setProfileError('');
    setEmailCodeBusy(true);
    try {
      const res = await call<EmailChangeData>(
        api.POST('/api/me/email/verification', { body: { email: nextEmail } }),
      );
      setEmailNotice(res.message);
      if (res.sent) {
        setEmailCooldown(60);
        toast.success(res.message);
      }
    } catch (err) {
      setProfileError(errMessage(err));
    } finally {
      setEmailCodeBusy(false);
    }
  }

  function submitPassword(e: FormEvent) {
    e.preventDefault();
    setPwError('');
    if (hasPassword && !oldPassword) {
      setPwError('请填写当前密码');
      return;
    }
    if (!newPassword) {
      setPwError('请填写新密码');
      return;
    }
    if (newPassword.length < 8 || newPassword.length > 20) {
      setPwError('新密码长度需为 8–20 位');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError('两次输入的新密码不一致');
      return;
    }
    passwordMut.mutate(hasPassword ? { old_password: oldPassword, password: newPassword } : { password: newPassword });
  }

  async function issueToken() {
    try {
      const res = await call<TokenResult>(api.POST('/api/me/token'));
      setNewToken(res.token);
      toast.success('新 Token 已生成，请立即复制保存');
      qc.invalidateQueries({ queryKey: ['me-push'] });
    } catch (err) {
      toast.error(errMessage(err));
    }
  }

  async function destroyAccount() {
    const ok = await confirm({
      title: '注销账户',
      message: '注销后将退出所有会话，账户进入已注销状态。确定继续吗？',
      confirmText: '注销账户',
      danger: true,
    });
    if (!ok) return;
    try {
      await call(api.DELETE('/api/me'));
      toast.success('账户已注销');
      useAuthStore.getState().markAnonymous();
      navigate('/login', { replace: true });
    } catch (err) {
      toast.error(errMessage(err));
    }
  }

  return (
    <>
      <PageHead eyebrow="Account / Profile" title="个人设置" description="管理个人资料、密码与 API Token" />
      <SettingsLayout sections={sections}>
        <SettingsSection id="profile" title="个人资料" description="用于登录与展示的基础信息">
          {profileError && <Alert tone="error">{profileError}</Alert>}
          <form onSubmit={submitProfile}>
            <Field label="用户名" htmlFor="me-username" required>
              <input id="me-username" className="input" value={username} onChange={(e) => setUsername(e.target.value)} />
            </Field>
            <Field label="邮箱" htmlFor="me-email" hint="修改后自动同步 email 通道">
              <input
                id="me-email"
                type="email"
                className="input"
                value={email}
                placeholder="用于接收邮件推送与找回密码"
                onChange={(e) => {
                  setEmail(e.target.value);
                  setEmailCode('');
                  setEmailNotice('');
                  setEmailCooldown(0);
                  setProfileError('');
                }}
              />
              {emailChanged && email.trim() && securityQ.data && !emailChangeRequiresCode && (
                <div className="field-help">
                  SMTP 未配置：邮箱可以保存，但暂时无法接收找回密码邮件。
                </div>
              )}
            </Field>
            {emailChanged && emailChangeRequiresCode && email.trim() && (
              <>
                <div className="field">
                  <span className="field-label">邮箱验证码</span>
                  <div className="code-row">
                    <input
                      id="me-email-code"
                      className="input"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      placeholder="6 位验证码"
                      value={emailCode}
                      onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    />
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={emailCodeBusy || emailCooldown > 0}
                      onClick={sendEmailCode}
                    >
                      {emailCooldown > 0 ? `${emailCooldown}s` : emailCodeBusy ? '发送中…' : '发送验证码'}
                    </button>
                  </div>
                  {emailNotice && <div className="field-help">{emailNotice}</div>}
                </div>
              </>
            )}
            <Field label="显示名" htmlFor="me-display">
              <input id="me-display" className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </Field>
            <div className="section-actions">
              <button className="btn btn-primary" type="submit" disabled={profileMut.isPending}>
                {profileMut.isPending ? '保存中…' : '保存资料'}
              </button>
              <span className="saved-note">未保存更改</span>
            </div>
          </form>
        </SettingsSection>

        <SettingsSection
          id="password"
          title={hasPassword ? '修改密码' : '设置登录密码'}
          description={
            hasPassword ? '定期更换密码以确保账户安全' : '当前为第三方登录账号，设置密码后可使用密码登录'
          }
        >
          {pwError && <Alert tone="error">{pwError}</Alert>}
          <form onSubmit={submitPassword}>
            {hasPassword && (
              <Field label="当前密码" htmlFor="old-password" required>
                <input id="old-password" type="password" className="input" autoComplete="current-password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} />
              </Field>
            )}
            <Field label="新密码" htmlFor="new-password" required hint="8–20 位">
              <input id="new-password" type="password" className="input" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </Field>
            <Field label="确认新密码" htmlFor="confirm-password" required>
              <input id="confirm-password" type="password" className="input" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
            </Field>
            <div className="section-actions">
              <button className="btn btn-primary" type="submit" disabled={passwordMut.isPending}>
                {passwordMut.isPending ? '更新中…' : hasPassword ? '更新密码' : '设置密码'}
              </button>
            </div>
          </form>
        </SettingsSection>

        <SettingsSection id="oauth" title="第三方登录" description="绑定后可用第三方账号一键登录">
          <OAuthBindingSection
            data={securityQ.data}
            onChanged={() => qc.invalidateQueries({ queryKey: ['me-security'] })}
          />
        </SettingsSection>

        <SettingsSection id="token" title="API Token" description="用于调用推送 API；生成后请立即保存">
          <div className="token-value">
            <span className="mono">{newToken ?? tokenMasked ?? '尚未生成'}</span>
            {(newToken || tokenMasked) && <CopyButton value={newToken ?? tokenMasked ?? ''} showLabel={false} className="icon-btn" />}
          </div>
          {newToken && <Alert tone="warning">新 Token 仅显示这一次，离开本页后将无法再次查看。</Alert>}
          <div className="section-actions">
            <button className="btn btn-primary" onClick={issueToken}>生成新 Token</button>
            <button className="btn btn-ghost" disabled title="后端暂未提供批量撤销接口，重新生成会使旧 Token 立即失效">撤销全部 Token</button>
          </div>
        </SettingsSection>

        {user?.role !== 'root' && (
          <SettingsSection id="danger" title="注销账号" description="永久停用当前账户">
            <div className="setting-row">
              <div className="setting-label">
                <h3>永久注销</h3>
                <p>注销后账户进入已注销状态，可由管理员恢复；所有会话将立即失效。</p>
              </div>
              <div className="setting-control">
                <button className="btn btn-danger" onClick={destroyAccount}>注销账户</button>
              </div>
            </div>
          </SettingsSection>
        )}
      </SettingsLayout>
    </>
  );
}