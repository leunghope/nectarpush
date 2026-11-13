import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, call } from '@/api/client';
import { errMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { useDebouncedValue, useDocumentTitle } from '@/hooks/misc';
import { toast } from '@/stores/ui';
import { useConfirm } from '@/components/ui/Modal';
import type { PageMeta, User, UserPageData } from '@nectarpush/shared';
import { PageHead, Empty, SkeletonRows, Alert } from '@/components/ui/Feedback';
import { Switch } from '@/components/ui/Field';
import { UserRoleBadge, UserStatusBadge } from '@/components/ui/StatusBadge';
import { TableFoot } from '@/components/ui/Pagination';
import { Icon } from '@/components/ui/Icon';

export function UsersPage() {
  useDocumentTitle('用户管理');
  const [keyword, setKeyword] = useState('');
  const debounced = useDebouncedValue(keyword, 350);
  const [page, setPage] = useState(1);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const qc = useQueryClient();
  const confirm = useConfirm();

  const q = useQuery({
    queryKey: ['users', page, debounced, includeDeleted],
    queryFn: () =>
      call<UserPageData>(
        api.GET('/api/users', {
          params: { query: { page, page_size: 10, keyword: debounced || undefined, include_deleted: includeDeleted || undefined } },
        }),
      ),
  });

  const items: User[] = q.data?.items ?? [];
  const meta = q.data?.page as PageMeta | undefined;

  function refresh() {
    qc.invalidateQueries({ queryKey: ['users'] });
  }

  async function manage(u: User, action: 'enable' | 'disable') {
    try {
      await call(api.POST('/api/users/{id}/manage', { params: { path: { id: u.id } }, body: { action } }));
      toast.success(action === 'enable' ? '用户已启用' : '用户已停用');
      refresh();
    } catch (err) {
      toast.error(errMessage(err));
    }
  }

  async function remove(u: User) {
    const ok = await confirm({
      title: '删除用户',
      message: `确定删除用户「${u.username}」吗？删除后该用户将进入已注销状态，可由管理员恢复。`,
      confirmText: '确认删除',
      cancelText: '取消',
      danger: true,
    });
    if (!ok) return;
    try {
      await call(api.DELETE('/api/users/{id}', { params: { path: { id: u.id } } }));
      toast.success('用户已删除');
      refresh();
    } catch (err) {
      toast.error(errMessage(err));
    }
  }

  async function restore(u: User) {
    try {
      await call(api.POST('/api/users/{id}/restore', { params: { path: { id: u.id } }, body: {} }));
      toast.success('用户已恢复');
      refresh();
    } catch (err) {
      toast.error(errMessage(err));
    }
  }

  return (
    <>
      <PageHead
        eyebrow="Admin / Users"
        title="用户管理"
        description="管理账号、角色与访问状态"
        actions={
          <Link className="btn btn-primary" to="/users/new">
            <Icon name="plus" /> 添加用户
          </Link>
        }
      />

      <div className="panel">
        <div className="table-toolbar">
          <div className="toolbar-search">
            <Icon name="search" className="toolbar-search-icon" />
            <input
              className="input"
              placeholder="搜索用户名或邮箱"
              value={keyword}
              onChange={(e) => {
                setKeyword(e.target.value);
                setPage(1);
              }}
              aria-label="搜索用户"
            />
          </div>
          <span className="spacer" />
          <span className="row-gap">
            <Switch checked={includeDeleted} onChange={(v) => { setIncludeDeleted(v); setPage(1); }} label="显示已注销用户" />
          </span>
        </div>

        {q.isError ? (
          <Alert tone="error">加载失败：{errMessage(q.error)}</Alert>
        ) : q.isLoading ? (
          <SkeletonRows rows={6} />
        ) : items.length === 0 ? (
          <Empty icon="users" title="没有匹配的用户" description="调整搜索条件，或新增一个用户。">
            <Link className="btn btn-primary" to="/users/new">
              <Icon name="plus" /> 添加用户
            </Link>
          </Empty>
        ) : (
          <>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>用户名</th>
                    <th>邮箱</th>
                    <th>角色</th>
                    <th>状态</th>
                    <th>创建时间</th>
                    <th style={{ textAlign: 'right' }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <strong>{u.username}</strong>
                        {u.display_name && <div className="muted-text">{u.display_name}</div>}
                      </td>
                      <td className="muted-text">{u.email ?? '—'}</td>
                      <td><UserRoleBadge role={u.role} /></td>
                      <td><UserStatusBadge status={u.status} deleted={!!u.deleted_at} /></td>
                      <td className="muted-text">{formatDate(u.created_at)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="row-gap" style={{ justifyContent: 'flex-end' }}>
                          {u.deleted_at ? (
                            <>
                              <Link className="table-link" to={`/users/${u.id}/edit`}>查看</Link>
                              <button className="btn btn-sm btn-ghost" onClick={() => restore(u)}>恢复</button>
                            </>
                          ) : (
                            <>
                              <Link className="table-link" to={`/users/${u.id}/edit`}>编辑</Link>
                              <button className="btn btn-sm btn-ghost" onClick={() => manage(u, u.status === 'active' ? 'disable' : 'enable')}>
                                {u.status === 'active' ? '停用' : '启用'}
                              </button>
                              <button className="btn btn-sm btn-ghost text-danger" onClick={() => remove(u)}>删除</button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TableFoot total={meta?.total ?? items.length} page={meta?.page ?? page} totalPages={meta?.total_pages ?? 1} onChange={setPage} unit="人" />
          </>
        )}
      </div>
    </>
  );
}
