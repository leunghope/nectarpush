import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, call } from '@/api/client';
import { errMessage } from '@/lib/errors';
import { useDocumentTitle } from '@/hooks/misc';
import { toast } from '@/stores/ui';
import { useConfirm } from '@/components/ui/Modal';
import type { Webhook, WebhookListData } from '@nectarpush/shared';
import { PageHead, Empty, SkeletonRows, Alert } from '@/components/ui/Feedback';
import { Icon } from '@/components/ui/Icon';

function ruleSummary(w: Webhook): string {
  const ex = Object.keys(w.extract_rule ?? {});
  const co = Object.keys(w.construct_rule ?? {});
  const parts: string[] = [];
  if (ex.length) parts.push(`提取 ${ex.join('、')}`);
  if (co.length) parts.push(`构造 ${co.join('、')}`);
  return parts.length ? parts.join(' · ') : '—';
}

export function WebhooksPage() {
  useDocumentTitle('Webhook');
  const qc = useQueryClient();
  const confirm = useConfirm();

  const q = useQuery({
    queryKey: ['webhooks'],
    queryFn: () => call<WebhookListData>(api.GET('/api/webhooks')),
  });

  const items = q.data?.items ?? [];
  const enabledCount = items.filter((w) => w.enabled).length;

  async function remove(w: Webhook) {
    const ok = await confirm({
      title: '删除 Webhook',
      message: `确定删除「${w.name}」吗？删除后其触发链接立即失效。`,
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;
    try {
      await call(api.DELETE('/api/webhooks/{id}', { params: { path: { id: w.id } } }));
      toast.success('Webhook 已删除');
      qc.invalidateQueries({ queryKey: ['webhooks'] });
    } catch (err) {
      toast.error(errMessage(err));
    }
  }

  return (
    <>
      <PageHead
        eyebrow="Connect / Webhooks"
        title="Webhook"
        description="把外部请求转成 NectarPush 消息，并保留短链入口"
        actions={
          <Link className="btn btn-primary" to="/webhooks/new">
            <Icon name="plus" /> 新建 Webhook
          </Link>
        }
      />

      {q.isError ? (
        <Alert tone="error">加载失败：{errMessage(q.error)}</Alert>
      ) : q.isLoading ? (
        <div className="panel">
          <SkeletonRows rows={6} />
        </div>
      ) : items.length === 0 ? (
        <div className="panel">
          <Empty
            icon="link"
            title="还没有 Webhook"
            description="创建 Webhook 后，外部系统即可通过固定链接触发推送。"
          >
            <Link className="btn btn-primary" to="/webhooks/new">
              <Icon name="plus" /> 新建 Webhook
            </Link>
          </Empty>
        </div>
      ) : (
        <div className="panel">
          <div className="table-toolbar">
            <span className="small muted">{items.length} 个 Webhook · {enabledCount} 个启用</span>
            <span className="spacer" />
            <button className="btn btn-ghost" onClick={() => q.refetch()} aria-label="刷新">
              <Icon name="refresh" />
            </button>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>短链</th>
                  <th>方法</th>
                  <th>提取 / 构造规则</th>
                  <th style={{ textAlign: 'right' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((w) => (
                  <tr key={w.id}>
                    <td>
                      <strong>{w.name}</strong>
                      <div className="mono xs muted">wh_{w.id}</div>
                    </td>
                    <td className="mono-ellipsis" style={{ maxWidth: 260 }}>/webhook/{w.link}</td>
                    <td><span className="tag">POST</span></td>
                    <td className="muted-text">{ruleSummary(w)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <Link className="table-link" to={`/webhooks/${w.id}/edit`}>编辑</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-foot">
            <span className="small muted">共 {items.length} 个 Webhook</span>
          </div>
        </div>
      )}
    </>
  );
}
