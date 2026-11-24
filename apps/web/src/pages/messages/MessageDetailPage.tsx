import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, call } from '@/api/client';
import { errMessage } from '@/lib/errors';
import { formatDate, formatLatency, DELIVERY_STATUS_LABEL, DELIVERY_STATUS_TONE, MESSAGE_STATUS_LABEL, RENDER_MODE_LABEL } from '@/lib/format';
import { renderContent } from '@/lib/markdown';
import { useDocumentTitle } from '@/hooks/misc';
import { toast } from '@/stores/ui';
import { Modal, useConfirm } from '@/components/ui/Modal';
import type { MessageDetail, MessageDelivery, RenderMode } from '@nectarpush/shared';
import { PageHead, Alert, SkeletonRows, Empty } from '@/components/ui/Feedback';
import { Field, Segmented, Badge } from '@/components/ui/Field';
import { MessageStatusBadge } from '@/components/ui/StatusBadge';
import { CopyButton } from '@/components/ui/CopyButton';
import { Icon } from '@/components/ui/Icon';

export function MessageDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [viewDelivery, setViewDelivery] = useState<MessageDelivery | null>(null);

  const detailQ = useQuery({
    queryKey: ['message', id],
    queryFn: () => call<MessageDetail>(api.GET('/api/messages/{id}', { params: { path: { id: Number(id) } } })),
    enabled: !!id,
    // 待发送 / 异步等待时轮询，直到状态收敛
    refetchInterval: (q) => {
      const d = q.state.data;
      return d && (d.status === 'pending' || d.status === 'async_pending') ? 3000 : false;
    },
  });
  const msg = detailQ.data;
  useDocumentTitle(msg ? msg.title || '消息详情' : '消息详情');

  const [form, setForm] = useState({ title: '', description: '', content: '', url: '', render_mode: 'markdown' as RenderMode });

  useEffect(() => {
    if (msg) {
      setForm({
        title: msg.title ?? '',
        description: msg.description ?? '',
        content: msg.content ?? '',
        url: msg.url ?? '',
        render_mode: msg.render_mode,
      });
    }
  }, [msg]);

  if (detailQ.isLoading) {
    return (
      <>
        <PageHead title="消息详情" />
        <div className="panel">
          <div className="panel-body">
            <SkeletonRows rows={8} />
          </div>
        </div>
      </>
    );
  }
  if (detailQ.isError || !msg) {
    return (
      <>
        <PageHead title="消息详情" />
        <Alert tone="error">加载失败：{errMessage(detailQ.error)}</Alert>
        <div style={{ marginTop: 16 }}>
          <Link className="btn" to="/messages">
            返回列表
          </Link>
        </div>
      </>
    );
  }

  const editable = msg.status === 'pending' || msg.status === 'failed';
  const failedDeliveries = msg.deliveries.filter((d) => d.status === 'failed');
  const isGroup = msg.channel_type === 'group';

  async function resend() {
    setBusy(true);
    try {
      await call(api.POST('/api/messages/{id}/resend', { params: { path: { id: Number(id) } } }));
      toast.success('已重新发送');
      qc.invalidateQueries({ queryKey: ['message', id] });
      qc.invalidateQueries({ queryKey: ['messages'] });
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  /** Re-send only the failed rows in place (no new message / uuid). */
  async function retryFailed() {
    setBusy(true);
    try {
      const updated = await call<MessageDetail>(
        api.POST('/api/messages/{id}/retry', { params: { path: { id: Number(id) } } }),
      );
      qc.setQueryData(['message', id], updated);
      qc.invalidateQueries({ queryKey: ['messages'] });
      toast.success(updated.status === 'success' ? '失败项已重试成功' : '已重试失败项，仍有通道未成功');
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const ok = await confirm({ title: '删除消息', message: '确定删除这条消息记录吗？此操作不可撤销。', confirmText: '删除', danger: true });
    if (!ok) return;
    try {
      await call(api.DELETE('/api/messages/{id}', { params: { path: { id: Number(id) } } }));
      toast.success('已删除');
      qc.invalidateQueries({ queryKey: ['messages'] });
      navigate('/messages', { replace: true });
    } catch (err) {
      toast.error(errMessage(err));
    }
  }

  async function save() {
    setBusy(true);
    try {
      await call(api.PATCH('/api/messages/{id}', {
        params: { path: { id: Number(id) } },
        body: {
          title: form.title || undefined,
          description: form.description || undefined,
          content: form.content || undefined,
          url: form.url || undefined,
          render_mode: form.render_mode,
        },
      }));
      toast.success('已保存');
      setEditing(false);
      qc.invalidateQueries({ queryKey: ['message', id] });
      qc.invalidateQueries({ queryKey: ['messages'] });
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead
        eyebrow="Work / Messages"
        title={msg.title || '（无标题）'}
        description={`消息 ID · ${msg.uuid}`}
        actions={
          <>
            {editable && !editing && (
              <button className="btn" onClick={() => setEditing(true)}>
                <Icon name="edit" /> 编辑
              </button>
            )}
            <Link className="btn" to={`/message/${msg.uuid}`} target="_blank" rel="noreferrer">
              <Icon name="external" /> 查看公开链接
            </Link>
            <button className="btn btn-primary" onClick={resend} disabled={busy}>
              <Icon name="refresh" /> 重新发送
            </button>
          </>
        }
      />

      {failedDeliveries.length > 0 && (
        <Alert
          tone="warning"
          actions={
            <button className="btn btn-sm" onClick={retryFailed} disabled={busy}>
              重试失败项（{failedDeliveries.length}）
            </button>
          }
        >
          有 {failedDeliveries.length} 个通道投递失败：{failedDeliveries.map((d) => d.channel_name).join('、')}。
        </Alert>
      )}
      {msg.status === 'partial' && failedDeliveries.length === 0 && (
        <Alert tone="info">该消息由旧版本发送，投递明细为汇总记录，无法单独重试失败项。</Alert>
      )}

      <div className="grid-2">
        <section className="panel">
          <div className="panel-title">
            <div className="panel-title-copy">
              <h2>消息内容</h2>
              <p>{RENDER_MODE_LABEL[msg.render_mode] || msg.render_mode} 渲染结果</p>
            </div>
            <div className="head-tools">
              <MessageStatusBadge status={msg.status} />
            </div>
          </div>
          <div className="panel-body">
            {editing ? (
              <div className="stack">
                <Field label="标题" htmlFor="m-title" hint="TITLE">
                  <input id="m-title" className="input" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
                </Field>
                <Field label="渲染格式" htmlFor="m-mode" hint="FORMAT">
                  <Segmented<RenderMode>
                    ariaLabel="渲染格式"
                    value={form.render_mode}
                    options={(Object.keys(RENDER_MODE_LABEL) as RenderMode[]).map((m) => ({ value: m, label: RENDER_MODE_LABEL[m] }))}
                    onChange={(v) => setForm((f) => ({ ...f, render_mode: v }))}
                  />
                </Field>
                <Field label="内容" htmlFor="m-content" hint="MARKDOWN">
                  <textarea id="m-content" className="textarea" rows={12} value={form.content} onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))} />
                </Field>
                <Field label="描述" htmlFor="m-desc" hint="DESCRIPTION">
                  <input id="m-desc" className="input" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
                </Field>
                <Field label="跳转链接" htmlFor="m-url" hint="URL">
                  <input id="m-url" className="input" value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} placeholder="https://" />
                </Field>
                <div className="form-actions">
                  <button className="btn" onClick={() => setEditing(false)} disabled={busy}>
                    取消
                  </button>
                  <button className="btn btn-primary" onClick={save} disabled={busy}>
                    {busy ? '保存中…' : '保存'}
                  </button>
                </div>
              </div>
            ) : msg.content ? (
              <div className="article" dangerouslySetInnerHTML={{ __html: renderContent(msg.content, msg.render_mode) }} />
            ) : (
              <Empty icon="inbox" title="无正文内容" description="该消息没有正文。" />
            )}
            {msg.description && !editing && <p className="muted-text" style={{ marginTop: 16 }}>{msg.description}</p>}
          </div>
        </section>

        <aside className="panel">
          <div className="panel-title">
            <div className="panel-title-copy">
              <h2>元信息</h2>
              <p>来源、格式与创建者</p>
            </div>
          </div>
          <div className="panel-body">
            <dl className="kv">
              <div>
                <dt>状态</dt>
                <dd>{MESSAGE_STATUS_LABEL[msg.status]}</dd>
              </div>
              <div>
                <dt>创建时间</dt>
                <dd>{formatDate(msg.created_at)}</dd>
              </div>
              <div>
                <dt>来源</dt>
                <dd className="mono">{msg.channel_name}</dd>
              </div>
              <div>
                <dt>内容格式</dt>
                <dd>{RENDER_MODE_LABEL[msg.render_mode] || msg.render_mode}</dd>
              </div>
              <div>
                <dt>接收目标</dt>
                <dd className="mono-ellipsis">{msg.to || '—'}</dd>
              </div>
              <div>
                <dt>消息 ID</dt>
                <dd className="mono-ellipsis">{msg.uuid}</dd>
              </div>
              <div>
                <dt>公开链接</dt>
                <dd>
                  <span className="mono-ellipsis">/message/{msg.uuid}</span>
                  <CopyButton value={`${window.location.origin}/message/${msg.uuid}`} showLabel={false} />
                </dd>
              </div>
            </dl>
            <div className="section-actions" style={{ marginTop: 20 }}>
              <button className="btn btn-danger btn-block" onClick={remove}>
                <Icon name="trash" /> 删除消息
              </button>
            </div>
          </div>
        </aside>
      </div>

      <div className="mt-4">
        <section className="panel">
          <div className="panel-title">
            <div className="panel-title-copy">
              <h2>投递明细</h2>
              <p>{isGroup ? `群组 ${msg.channel_name} · 逐个子通道的投递结果` : '每个通道与接收目标的独立投递结果'}</p>
            </div>
            <div className="head-tools">
              <span className="tag">共 {msg.deliveries.length} 条</span>
            </div>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>通道</th>
                  <th>接收目标</th>
                  <th>状态</th>
                  <th>响应 / 错误</th>
                  <th>耗时</th>
                </tr>
              </thead>
              <tbody>
                {msg.deliveries.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ padding: 0 }}>
                      <Empty icon="inbox" title="暂无投递记录" description="消息尚未产生投递明细。" />
                    </td>
                  </tr>
                ) : (
                  msg.deliveries.map((d: MessageDelivery) => (
                    <tr key={d.id}>
                      <td>{d.channel_name}</td>
                      <td className="mono-ellipsis">{msg.to || '—'}</td>
                      <td>
                        <Badge tone={DELIVERY_STATUS_TONE[d.status]}>{DELIVERY_STATUS_LABEL[d.status]}</Badge>
                      </td>
                      <td style={{ maxWidth: 360 }}>
                        {d.error ? (
                          <span className="cell-action">
                            <span className="mono-ellipsis text-danger" title={d.error}>
                              {d.error}
                            </span>
                            <button type="button" className="table-link" onClick={() => setViewDelivery(d)}>
                              查看
                            </button>
                          </span>
                        ) : (
                          <span className="muted-text">—</span>
                        )}
                      </td>
                      <td>{formatLatency(d.latency_ms)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {viewDelivery && (
        <Modal
          open
          title={`投递详情 · ${viewDelivery.channel_name}`}
          onClose={() => setViewDelivery(null)}
          actions={
            <button className="btn" onClick={() => setViewDelivery(null)}>
              关闭
            </button>
          }
        >
          <dl className="kv">
            <div>
              <dt>通道</dt>
              <dd className="mono">{viewDelivery.channel_name}</dd>
            </div>
            <div>
              <dt>状态</dt>
              <dd>
                <Badge tone={DELIVERY_STATUS_TONE[viewDelivery.status]}>{DELIVERY_STATUS_LABEL[viewDelivery.status]}</Badge>
              </dd>
            </div>
            <div>
              <dt>耗时</dt>
              <dd>{formatLatency(viewDelivery.latency_ms)}</dd>
            </div>
            <div>
              <dt>投递时间</dt>
              <dd>{formatDate(viewDelivery.created_at)}</dd>
            </div>
          </dl>
          <div style={{ marginTop: 16 }}>
            <div className="field-label">响应 / 错误</div>
            <pre className="raw-pre" style={{ marginTop: 8 }}>
              {viewDelivery.error || '通道未返回错误信息'}
            </pre>
            {viewDelivery.error && (
              <div style={{ marginTop: 8 }}>
                <CopyButton value={viewDelivery.error} />
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
