import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, call } from '@/api/client';
import { errMessage } from '@/lib/errors';
import { useDocumentTitle } from '@/hooks/misc';
import { toast } from '@/stores/ui';
import type { Channel, ChannelListData, ChannelTestResultData } from '@nectarpush/shared';
import { PageHead, Alert, Empty, SkeletonCards } from '@/components/ui/Feedback';
import { Switch, Segmented } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';

type Filter = 'all' | 'enabled' | 'disabled';

export function ChannelsPage() {
  useDocumentTitle('通道');
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');
  const [testingId, setTestingId] = useState<number | null>(null);

  const listQ = useQuery({
    queryKey: ['channels', 'list'],
    queryFn: () => call<ChannelListData>(api.GET('/api/channels')),
  });
  const items: Channel[] = listQ.data?.items ?? [];

  const enabledCount = items.filter((c) => c.enabled).length;
  const visible = useMemo(() => {
    if (filter === 'enabled') return items.filter((c) => c.enabled);
    if (filter === 'disabled') return items.filter((c) => !c.enabled);
    return items;
  }, [items, filter]);

  async function toggle(c: Channel, enabled: boolean) {
    try {
      await call(api.PATCH('/api/channels/{id}', { params: { path: { id: c.id } }, body: { status_only: true, enabled } }));
      qc.invalidateQueries({ queryKey: ['channels'] });
    } catch (err) {
      toast.error(errMessage(err));
    }
  }

  async function test(c: Channel) {
    setTestingId(c.id);
    try {
      const res = await call<ChannelTestResultData>(api.POST('/api/channels/{id}/test', {
        params: { path: { id: c.id } },
        body: {},
      }));
      if (res.success) toast.success(`「${c.name}」测试成功 · ${res.latency_ms ?? 0} ms`);
      else toast.error(`「${c.name}」测试失败：${res.message || '未知错误'}`);
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setTestingId(null);
    }
  }

  return (
    <>
      <PageHead
        eyebrow="Connect / Channels"
        title="消息通道"
        description="集中管理 16 类推送协议与接收能力"
        actions={
          <Link className="btn btn-primary" to="/channels/new">
            <Icon name="plus" /> 添加通道
          </Link>
        }
      />

      {listQ.isError ? (
        <Alert tone="error">加载失败：{errMessage(listQ.error)}</Alert>
      ) : listQ.isLoading ? (
        <SkeletonCards count={6} />
      ) : items.length === 0 ? (
        <div className="panel">
          <Empty icon="plug" title="还没有消息通道" description="从邮件、Webhook、飞书等 16 种类型中选择，完成首次配置。">
            <Link className="btn btn-primary btn-sm" to="/channels/new">
              添加第一个通道
            </Link>
          </Empty>
        </div>
      ) : (
        <>
          <div className="row">
            <span className="small muted">{items.length} 个通道 · {enabledCount} 个已启用</span>
            <span className="spacer" />
            <Segmented<Filter>
              ariaLabel="筛选通道"
              value={filter}
              options={[
                { value: 'all', label: '全部' },
                { value: 'enabled', label: '已启用' },
                { value: 'disabled', label: '已停用' },
              ]}
              onChange={setFilter}
            />
          </div>

          <div className="channel-grid" style={{ marginTop: 16 }}>
            {visible.map((c) => (
              <article key={c.id} className="channel-card">
                <div className="channel-head">
                  <span className="tag">{c.type}</span>
                  <span className="channel-switch">
                    <Switch checked={c.enabled} onChange={(v) => toggle(c, v)} label={c.enabled ? '已启用' : '已停用'} />
                  </span>
                </div>
                <div>
                  <h3 className="channel-name">{c.name}</h3>
                  <p className="channel-meta">{c.type} · {c.enabled ? '已启用' : '已停用'}</p>
                  <div className={c.description?.trim() ? 'channel-target' : 'channel-target is-empty'} title={c.description?.trim() || undefined}>
                    {c.description?.trim() || '未填写说明'}
                  </div>
                </div>
                <div className="channel-actions">
                  <Link className="btn btn-ghost btn-sm" to={`/channels/${c.id}/edit`}>
                    配置
                  </Link>
                  <span className="spacer" />
                  <button className="btn btn-ghost btn-sm" onClick={() => test(c)} disabled={testingId === c.id}>
                    <Icon name="send" className="icon-sm" />
                    {testingId === c.id ? '测试中…' : '测试'}
                  </button>
                </div>
              </article>
            ))}
          </div>

          {visible.length === 0 && (
            <div className="panel" style={{ marginTop: 16 }}>
              <Empty icon="plug" title="没有符合条件的通道" description="试试切换筛选条件。" />
            </div>
          )}
        </>
      )}
    </>
  );
}
