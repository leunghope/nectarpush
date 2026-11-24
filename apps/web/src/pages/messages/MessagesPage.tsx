import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, call } from '@/api/client';
import { errMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { useDebouncedValue, useDocumentTitle } from '@/hooks/misc';
import { useAuthStore } from '@/stores/auth';
import { toast } from '@/stores/ui';
import { useConfirm } from '@/components/ui/Modal';
import type { Channel, ChannelListData, MessagePageData, MessageStatus } from '@nectarpush/shared';
import { PageHead, Alert, Empty, SkeletonRows } from '@/components/ui/Feedback';
import { MessageStatusBadge } from '@/components/ui/StatusBadge';
import { TableFoot } from '@/components/ui/Pagination';
import { Icon } from '@/components/ui/Icon';

const PAGE_SIZE = 10;
const STATUS_OPTIONS: MessageStatus[] = ['success', 'partial', 'pending', 'async_pending', 'failed'];
/** Filter wording follows the prototype: short labels rather than badge wording. */
const STATUS_FILTER_LABEL: Record<MessageStatus, string> = {
  success: '成功',
  partial: '部分成功',
  pending: '待发送',
  async_pending: '异步等待',
  failed: '失败',
};

export function MessagesPage() {
  useDocumentTitle('消息');
  const qc = useQueryClient();
  const confirm = useConfirm();
  const role = useAuthStore((s) => s.user?.role);

  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') || 1) || 1;
  const keyword = params.get('keyword') || '';
  const status = params.get('status') || '';
  const channel = params.get('channel') || '';

  const [kwInput, setKwInput] = useState(keyword);
  const debouncedKw = useDebouncedValue(kwInput, 350);

  useEffect(() => {
    setKwInput(keyword);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword]);

  useEffect(() => {
    if (debouncedKw === keyword) return;
    update({ keyword: debouncedKw });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedKw]);

  function update(patch: Record<string, string | number | undefined>) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === '' || v === null) next.delete(k);
      else next.set(k, String(v));
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  }

  const channelsQ = useQuery({
    queryKey: ['channels', 'all'],
    queryFn: () => call<ChannelListData>(api.GET('/api/channels', { params: { query: { brief: true } } })),
  });
  const channels: Channel[] = channelsQ.data?.items ?? [];

  const listQ = useQuery({
    queryKey: ['messages', 'list', { page, keyword, status, channel }],
    queryFn: () =>
      call<MessagePageData>(
        api.GET('/api/messages', {
          params: {
            query: {
              page,
              page_size: PAGE_SIZE,
              keyword: keyword || undefined,
              status: (status || undefined) as MessageStatus | undefined,
              channel: channel || undefined,
            },
          },
        }),
      ),
  });

  /** 清空消息（阶段3 D-18）：own=仅本人（所有用户）；all=全部用户（仅 root）。 */
  async function clearMessages(scope: 'own' | 'all') {
    const ok = await confirm({
      title: scope === 'all' ? '清空全部用户的消息' : '清空消息',
      message:
        scope === 'all'
          ? '将删除所有用户的消息记录（含投递明细），此操作不可撤销。请再次确认。'
          : '清空后将删除你拥有的全部消息记录（仅限本人消息，不影响其他用户）。此操作不可撤销。',
      confirmText: '确认清空',
      danger: true,
    });
    if (!ok) return;
    try {
      await call(api.DELETE('/api/messages', { params: { query: { scope } } }));
      toast.success(scope === 'all' ? '已清空全部用户的消息' : '已清空消息');
      qc.invalidateQueries({ queryKey: ['messages'] });
    } catch (err) {
      toast.error(errMessage(err));
    }
  }

  const items = listQ.data?.items ?? [];
  const meta = listQ.data?.page;
  const hasFilters = !!(keyword || status || channel);

  return (
    <>
      <PageHead
        eyebrow="Work / Messages"
        title="消息列表"
        description="筛选、追踪并排查每一次消息投递"
        actions={
          <>
            <button className="btn btn-danger" onClick={() => clearMessages('own')}>
              <Icon name="trash" /> 清空
            </button>
            {role === 'root' && (
              <button className="btn btn-danger" onClick={() => clearMessages('all')}>
                <Icon name="trash" /> 清空全部
              </button>
            )}
            <Link className="btn btn-primary" to="/messages/new">
              <Icon name="plus" /> 新建消息
            </Link>
          </>
        }
      />

      <div className="panel">
        <div className="table-toolbar">
          <div className="toolbar-search">
            <Icon name="search" className="toolbar-search-icon" />
            <input
              className="input"
              placeholder="搜索标题或消息 ID"
              value={kwInput}
              onChange={(e) => setKwInput(e.target.value)}
            />
          </div>
          <select className="select" value={status} onChange={(e) => update({ status: e.target.value })} aria-label="按状态筛选">
            <option value="">全部状态</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {STATUS_FILTER_LABEL[s]}
              </option>
            ))}
          </select>
          <select className="select" value={channel} onChange={(e) => update({ channel: e.target.value })} aria-label="按通道筛选">
            <option value="">全部通道</option>
            {channels.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
          {hasFilters && (
            <button className="btn btn-ghost btn-sm" onClick={() => { setKwInput(''); setParams(new URLSearchParams(), { replace: true }); }}>
              清除筛选
            </button>
          )}
          <span className="spacer" />
          <button className="btn btn-ghost" onClick={() => listQ.refetch()} aria-label="刷新">
            <Icon name="refresh" />
          </button>
        </div>

        {listQ.isError ? (
          <div className="table-empty">
            <Alert tone="error">加载失败：{errMessage(listQ.error)}</Alert>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>标题</th>
                  <th>状态</th>
                  <th>通道</th>
                  <th>接收目标</th>
                  <th>创建时间</th>
                  <th style={{ textAlign: 'right' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {listQ.isLoading ? (
                  <tr>
                    <td colSpan={6} style={{ padding: 0 }}>
                      <SkeletonRows rows={6} />
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: 0 }}>
                      <Empty
                        icon="inbox"
                        title={hasFilters ? '没有找到消息' : '还没有消息'}
                        description={hasFilters ? '调整筛选条件，或创建你的第一条消息。' : '发送第一条消息后会显示在这里。'}
                      >
                        <Link className="btn btn-primary btn-sm" to="/messages/new">
                          新建消息
                        </Link>
                      </Empty>
                    </td>
                  </tr>
                ) : (
                  items.map((m) => (
                    <tr key={m.id}>
                      <td>
                        <strong>{m.title || '（无标题）'}</strong>
                        <div className="mono xs muted">{m.uuid}</div>
                      </td>
                      <td>
                        <MessageStatusBadge status={m.status} />
                      </td>
                      <td>{m.channel_name}</td>
                      <td className="mono-ellipsis">{m.to || '—'}</td>
                      <td className="muted-text">{formatDate(m.created_at)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <Link className="table-link" to={`/messages/${m.id}`}>
                          查看
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {meta && items.length > 0 && (
          <TableFoot total={meta.total} page={meta.page} totalPages={meta.total_pages} onChange={(p) => update({ page: p })} />
        )}
      </div>
    </>
  );
}
