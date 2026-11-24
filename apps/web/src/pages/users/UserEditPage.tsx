import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, call } from '@/api/client';
import { errMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { useDocumentTitle } from '@/hooks/misc';
import { toast } from '@/stores/ui';
import type { User, UserOAuthListData, UserRole } from '@nectarpush/shared';
import { PageHead, Alert, SkeletonRows } from '@/components/ui/Feedback';
import { Field, Switch } from '@/components/ui/Field';
import { useConfirm } from '@/components/ui/Modal';
import { UserRoleBadge, UserStatusBadge } from '@/components/ui/StatusBadge';

type ManageAction =
  | 'enable'
  | 'disable'
  | 'promote'
  | 'demote'
  | 'allow_send_email_to_others'
  | 'disallow_send_email_to_others'
  | 'allow_save_message'
  | 'disallow_save_message';

export function UserEditPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;
  useDocumentTitle(isEdit ? '编辑用户' : '新增用户');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();

  const userQ = useQuery({
    queryKey: ['user', id],
    queryFn: () => call<User>(api.GET('/api/users/{id}', { params: { path: { id: Number(id) } } })),
    enabled: isEdit,
  });

  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('user');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);


  useEffect(() => {
    if (userQ.data) {
      setUsername(userQ.data.username);
      setDisplayName(userQ.data.display_name ?? '');
      setRole(userQ.data.role);
    }
  }, [userQ.data]);

  const current = userQ.data;

  const oauthQ = useQuery({
    queryKey: ['user-oauth', id],
    queryFn: () => call<UserOAuthListData>(api.GET('/api/users/{id}/oauth', { params: { path: { id: Number(id) } } })),
    enabled: isEdit && !!current && !current.deleted_at,
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!username.trim()) return setError('请填写用户名');
    if (!isEdit && !password) return setError('请填写初始密码');
    if (password && (password.length < 8 || password.length > 20)) return setError('密码长度需为 8–20 位');
    setBusy(true);
    try {
      if (isEdit) {
        await call(api.PATCH('/api/users/{id}', {
          params: { path: { id: Number(id) } },
          body: { username: username.trim(), display_name: displayName.trim(), password: password || undefined },
        }));
        toast.success('用户已保存');
        qc.invalidateQueries({ queryKey: ['user', id] });
        qc.invalidateQueries({ queryKey: ['users'] });
        setPassword('');
      } else {
        await call(api.POST('/api/users', {
          body: { username: username.trim(), password, display_name: displayName.trim() || undefined, role },
        }));
        toast.success('用户已创建');
        qc.invalidateQueries({ queryKey: ['users'] });
        navigate('/users', { replace: true });
      }
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function manage(action: ManageAction, successText: string) {
    try {
      await call(api.POST('/api/users/{id}/manage', { params: { path: { id: Number(id) } }, body: { action } }));
      toast.success(successText);
      qc.invalidateQueries({ queryKey: ['user', id] });
      qc.invalidateQueries({ queryKey: ['users'] });
    } catch (err) {
      toast.error(errMessage(err));
    }
  }

  async function changeRole(next: UserRole) {
    if (!current) return;
    if (next === 'admin' && current.role === 'user') await manage('promote', '已提升为管理员');
    else if (next === 'user' && current.role === 'admin') await manage('demote', '已降级为普通用户');
    else return;
    setRole(next);
  }

  async function removeUser() {
    const ok = await confirm({
      title: '删除用户',
      message: `确定删除用户「${username}」吗？该用户将进入已注销状态，可由管理员恢复。`,
      confirmText: '确认删除',
      danger: true,
    });
    if (!ok) return;
    try {
      await call(api.DELETE('/api/users/{id}', { params: { path: { id: Number(id) } } }));
      toast.success('用户已删除');
      qc.invalidateQueries({ queryKey: ['users'] });
      navigate('/users', { replace: true });
    } catch (err) {
      toast.error(errMessage(err));
    }
  }

  async function unbindOAuth(provider: string, label: string) {
    const ok = await confirm({
      title: '解绑第三方登录',
      message: `确定解绑「${label}」吗？解绑后该用户将不能再用它登录，需要重新绑定。`,
      confirmText: '确认解绑',
      danger: true,
    });
    if (!ok) return;
    try {
      await call(api.DELETE('/api/users/{id}/oauth/{provider}', {
        params: { path: { id: Number(id), provider } },
      }));
      toast.success('已解绑');
      qc.invalidateQueries({ queryKey: ['user-oauth', id] });
    } catch (err) {
      toast.error(errMessage(err));
    }
  }

  async function restoreUser() {
    try {
      await call(api.POST('/api/users/{id}/restore', { params: { path: { id: Number(id) } }, body: {} }));
      toast.success('用户已恢复');
      qc.invalidateQueries({ queryKey: ['user', id] });
      qc.invalidateQueries({ queryKey: ['users'] });
    } catch (err) {
      toast.error(errMessage(err));
    }
  }

  if (isEdit && userQ.isLoading) {
    return (
      <>
        <PageHead eyebrow="Admin / Users" title="编辑用户" />
        <div className="panel"><div className="panel-body"><SkeletonRows rows={6} /></div></div>
      </>
    );
  }
  if (isEdit && userQ.isError) {
    return (
      <>
        <PageHead eyebrow="Admin / Users" title="编辑用户" />
        <Alert tone="error">加载失败：{errMessage(userQ.error)}</Alert>
        <div style={{ marginTop: 16 }}><Link className="btn" to="/users">返回用户列表</Link></div>
      </>
    );
  }

  return (
    <>
      <PageHead
        eyebrow="Admin / Users"
        title={isEdit ? '编辑用户' : '新增用户'}
        description={isEdit ? `uid_${id}` : '创建新的账户并分配初始角色'}
        actions={
          <>
            <Link className="btn btn-ghost" to="/users">返回用户列表</Link>
            <button className="btn btn-primary" type="submit" form="user-form" disabled={busy}>
              {busy ? '保存中…' : '保存用户'}
            </button>
          </>
        }
      />

      <div className={isEdit ? 'stack' : ''}>
        <section className="panel">
          <div className="panel-title">
            <div className="panel-title-copy">
              <h2>账号信息</h2>
              <p>登录凭据与展示名</p>
            </div>
          </div>
          <div className="panel-body">
            {error && <Alert tone="error">{error}</Alert>}
            <form id="user-form" onSubmit={submit}>
              <Field label="用户名" htmlFor="u-username" hint="USERNAME" required>
                <input id="u-username" className="input" value={username} onChange={(e) => setUsername(e.target.value)} />
              </Field>
              {isEdit && (
                <Field label="邮箱" htmlFor="u-email" hint="EMAIL">
                  <input id="u-email" className="input" value={current?.email ?? '—'} readOnly />
                </Field>
              )}
              <Field label="显示名" htmlFor="u-display" hint="DISPLAY NAME">
                <input id="u-display" className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
              </Field>
              <Field
                label={isEdit ? '重置密码' : '初始密码'}
                htmlFor="u-password"
                hint={isEdit ? '留空则不修改 · 8–20 位' : '8–20 位'}
                required={!isEdit}
              >
                <input
                  id="u-password"
                  type="password"
                  className="input"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={isEdit ? '留空保持不变' : ''}
                />
              </Field>
              {!isEdit && (
                <Field label="初始角色" htmlFor="u-role" hint="ROLE">
                  <select id="u-role" className="select" value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
                    <option value="user">普通用户</option>
                    <option value="admin">管理员</option>
                    <option value="root">超级管理员</option>
                  </select>
                </Field>
              )}
              {!isEdit && (
                <div className="section-actions">
                  <button className="btn btn-primary" type="submit" disabled={busy}>
                    {busy ? '保存中…' : '创建用户'}
                  </button>
                </div>
              )}
            </form>
          </div>
        </section>

        {isEdit && current && (
          <>
            <section className="panel">
              <div className="panel-title">
                <div className="panel-title-copy">
                  <h2>权限与状态</h2>
                  <p>角色与账号可用性</p>
                </div>
              </div>
              <div className="panel-body">
                <div className="kv">
                  <div className="kv-row"><dt>用户 ID</dt><dd className="mono">{current.id}</dd></div>
                  <div className="kv-row"><dt>当前角色</dt><dd><UserRoleBadge role={current.role} /></dd></div>
                  <div className="kv-row"><dt>状态</dt><dd><UserStatusBadge status={current.status} deleted={!!current.deleted_at} /></dd></div>
                  <div className="kv-row"><dt>创建时间</dt><dd>{formatDate(current.created_at)}</dd></div>
                  <div className="kv-row"><dt>注销时间</dt><dd>{current.deleted_at ? formatDate(current.deleted_at) : '—'}</dd></div>
                </div>

                {current.deleted_at ? (
                  <div className="section-actions">
                    <button className="btn" onClick={restoreUser}>恢复该用户</button>
                  </div>
                ) : (
                  <>
                    <div className="setting-row">
                      <div className="setting-label">
                        <h3>角色</h3>
                        <p>提升或降级用户权限</p>
                      </div>
                      <div className="setting-control">
                        <select
                          className="select"
                          value={role}
                          onChange={(e) => changeRole(e.target.value as UserRole)}
                          disabled={current.role === 'root'}
                        >
                          {(current.role === 'user' || current.role === 'admin') && (
                            <>
                              <option value="user">普通用户</option>
                              <option value="admin">管理员</option>
                            </>
                          )}
                          {current.role === 'root' && <option value="root">超级管理员</option>}
                        </select>
                      </div>
                    </div>

                    <div className="setting-row">
                      <div className="setting-label">
                        <h3>账号状态</h3>
                        <p>停用后无法登录，但历史消息保留</p>
                      </div>
                      <div className="setting-control">
                        <Switch
                          checked={current.status === 'active'}
                          onChange={(v) => manage(v ? 'enable' : 'disable', v ? '已启用' : '已停用')}
                          label={current.status === 'active' ? '已启用' : '已停用'}
                        />
                      </div>
                    </div>

                    <div className="section-actions">
                      <button className="btn btn-sm btn-danger" onClick={removeUser}>删除用户</button>
                    </div>
                  </>
                )}
              </div>
            </section>

            {!current.deleted_at && (
              <section className="panel">
                <div className="panel-title">
                  <div className="panel-title-copy">
                    <h2>权限</h2>
                    <p>消息发送与存储的细粒度控制</p>
                  </div>
                </div>
                <div className="panel-body">
                  <div className="setting-row">
                    <div className="setting-label">
                      <h3>向他人的邮箱发送消息</h3>
                      <p>允许该用户使用 email 通道发送给非本人邮箱</p>
                    </div>
                    <div className="setting-control">
                      <Switch
                        checked={current.permissions.send_email_to_others}
                        onChange={(v) =>
                          manage(
                            v ? 'allow_send_email_to_others' : 'disallow_send_email_to_others',
                            v ? '已开启：可发送给他人邮箱' : '已关闭：仅可发送给本人邮箱',
                          )
                        }
                        label={current.permissions.send_email_to_others ? '已开启' : '已关闭'}
                      />
                    </div>
                  </div>
                  <div className="setting-row">
                    <div className="setting-label">
                      <h3>保存消息正文</h3>
                      <p>关闭后该用户的消息不落库，仅进行投递</p>
                    </div>
                    <div className="setting-control">
                      <Switch
                        checked={current.permissions.save_message}
                        onChange={(v) => manage(v ? 'allow_save_message' : 'disallow_save_message', v ? '已开启：保存消息' : '已关闭：不保存消息')}
                        label={current.permissions.save_message ? '已开启' : '已关闭'}
                      />
                    </div>
                  </div>
                </div>
              </section>
            )}

            {!current.deleted_at && (
              <section className="panel">
                <div className="panel-title">
                  <div className="panel-title-copy">
                    <h2>第三方登录</h2>
                    <p>该用户已绑定的 OAuth2 账户</p>
                  </div>
                </div>
                <div className="panel-body">
                  {oauthQ.isLoading ? (
                    <SkeletonRows rows={2} />
                  ) : oauthQ.isError ? (
                    <Alert tone="error">加载失败：{errMessage(oauthQ.error)}</Alert>
                  ) : (oauthQ.data?.items.length ?? 0) === 0 ? (
                    <p className="small muted">该用户尚未绑定第三方登录。</p>
                  ) : (
                    <div className="kv">
                      {oauthQ.data?.items.map((b) => (
                        <div className="kv-row" key={b.provider}>
                          <dt>{b.display_name || b.provider}</dt>
                          <dd className="row-inline">
                            <span className="mono small">{b.oauth_id}</span>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => unbindOAuth(b.provider, b.display_name || b.provider)}
                            >
                              解绑
                            </button>
                          </dd>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="small muted" style={{ marginTop: 10 }}>
                    绑定由用户本人在「我的 → 安全」页面完成；管理员只能查看与解绑。
                  </p>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </>
  );
}
