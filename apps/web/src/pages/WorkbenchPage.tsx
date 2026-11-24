import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, call } from '@/api/client';
import { renderContent } from '@/lib/markdown';
import { errMessage } from '@/lib/errors';
import { RENDER_MODE_LABEL, formatRelative } from '@/lib/format';
import { useDocumentTitle } from '@/hooks/misc';
import { useSseContext } from '@/components/layout/SseProvider';
import { toast } from '@/stores/ui';
import type {
  Channel,
  ChannelListData,
  MessagePageData,
  MessageStatus,
  MessageSummary,
  RenderMode,
  SendResultData,
} from '@nectarpush/shared';
import { PageHead, Alert, Empty, SkeletonRows } from '@/components/ui/Feedback';
import { Field, Switch, Segmented } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { MessageStatusBadge } from '@/components/ui/StatusBadge';
import { SignalBar } from '@/components/biz/SignalBar';

type Mode = 'edit' | 'preview';

const STATUS_DOT: Record<MessageStatus, string> = {
  pending: 'dot-warning',
  async_pending: 'dot-warning',
  success: 'dot-success',
  partial: 'dot-warning',
  failed: 'dot-danger',
};

function useCount(status: MessageStatus | undefined, since: string) {
  return useQuery({
    queryKey: ['messages', 'stat', status ?? 'all', since],
    queryFn: () =>
      call<MessagePageData>(
        api.GET('/api/messages', {
          params: { query: { page: 1, page_size: 1, since, ...(status ? { status } : {}) } },
        }),
      ),
    staleTime: 30_000,
  });
}

export function WorkbenchPage() {
  useDocumentTitle('工作台');
  const qc = useQueryClient();
  const { subscribe, status: sseStatus } = useSseContext();

  const channelsQ = useQuery({
    queryKey: ['channels', 'all'],
    queryFn: () => call<ChannelListData>(api.GET('/api/channels', { params: { query: { brief: true } } })),
  });
  const channels: Channel[] = channelsQ.data?.items ?? [];

  const recentQ = useQuery({
    queryKey: ['messages', 'recent'],
    queryFn: () => call<MessagePageData>(api.GET('/api/messages', { params: { query: { page: 1, page_size: 10 } } })),
  });

  const todaySince = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }, []);
  const totalQ = useCount(undefined, todaySince);
  const successQ = useCount('success', todaySince);
  const asyncQ = useCount('async_pending', todaySince);
  const failedQ = useCount('failed', todaySince);

  const total = totalQ.data?.page.total ?? 0;
  const success = successQ.data?.page.total ?? 0;
  const asyncPending = asyncQ.data?.page.total ?? 0;
  const failed = failedQ.data?.page.total ?? 0;
  const statsLoading = totalQ.isLoading || successQ.isLoading;
  const successRate = total > 0 ? `${((success / total) * 100).toFixed(1)}%` : '—';

  const [live, setLive] = useState<MessageSummary[]>([]);
  const [highlightId, setHighlightId] = useState<number | null>(null);

  useEffect(() => {
    return subscribe((ev) => {
      if (ev.type !== 'message.created') return;
      setLive((prev) => [ev.payload, ...prev.filter((m) => m.id !== ev.payload.id)].slice(0, 12));
      setHighlightId(ev.payload.id);
      const t = window.setTimeout(() => setHighlightId((id) => (id === ev.payload.id ? null : id)), 2200);
      qc.invalidateQueries({ queryKey: ['messages'] });
      return () => window.clearTimeout(t);
    });
  }, [subscribe, qc]);

  const merged = useMemo<MessageSummary[]>(() => {
    const base = recentQ.data?.items ?? [];
    const seen = new Set(base.map((m) => m.id));
    return [...live.filter((m) => !seen.has(m.id)), ...base].slice(0, 10);
  }, [recentQ.data, live]);

  // compose state
  const [channel, setChannel] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [to, setTo] = useState('');
  const [renderMode, setRenderMode] = useState<RenderMode>('markdown');
  const [isAsync, setIsAsync] = useState(false);
  const [mode, setMode] = useState<Mode>('edit');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const composeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!channel && channels.length > 0) setChannel(channels[0].name);
  }, [channels, channel]);

  const send = useCallback(async () => {
    setError('');
    if (!channel) {
      setError('请选择推送通道');
      return;
    }
    if (!content.trim() && !title.trim()) {
      setError('请输入标题或内容');
      return;
    }
    setBusy(true);
    try {
      const data = await call<SendResultData>(api.POST('/api/messages', {
        body: { channel, title: title || undefined, content: content || undefined, to: to || undefined, render_mode: renderMode, async: isAsync },
      }));
      toast.success(isAsync ? '已提交异步发送' : '消息已发送');
      qc.invalidateQueries({ queryKey: ['messages'] });
      qc.invalidateQueries({ queryKey: ['message', data.uuid] });
      setTitle('');
      setContent('');
      setTo('');
      setMode('edit');
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }, [channel, content, title, to, renderMode, isAsync, qc]);

  // ⌘ ↵ / Ctrl ↵ sends from within the composer.
  function onComposerKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!busy && channels.length > 0) void send();
    }
  }

  const channelOptions = channelsQ.isLoading ? (
    <div className="skeleton skeleton-line" />
  ) : (
    <select id="wb-channel" className="select" value={channel} onChange={(e) => setChannel(e.target.value)}>
      {channels.length === 0 && <option value="">暂无可用通道</option>}
      {channels.map((c) => (
        <option key={c.id} value={c.name}>
          {c.name}
          {c.type ? ` · ${c.type}` : ''}
        </option>
      ))}
    </select>
  );

  const today = new Date();
  const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][today.getDay()];
  const desc = `${today.getFullYear()} 年 ${today.getMonth() + 1} 月 ${today.getDate()} 日 · ${weekday} · 所有系统运行正常`;

  return (
    <>
      <PageHead
        eyebrow="Work / Overview"
        title="工作台"
        description={desc}
        actions={
          <>
            <Link className="btn" to="/messages">
              查看全部消息
            </Link>
            <Link className="btn btn-primary" to="/me/push">
              API 文档
            </Link>
          </>
        }
      />

      {channelsQ.isSuccess && channels.length === 0 && (
        <Alert tone="warning" actions={<Link className="btn btn-sm" to="/channels/new">创建通道</Link>}>
          你还没有可用通道，请先创建一个通道再发送消息。
        </Alert>
      )}

      <SignalBar
        loading={statsLoading}
        signals={[
          {
            tone: channels.length === 0 ? 'warning' : 'live',
            content: sseStatus === 'open' ? 'SSE 已连接' : channels.length === 0 ? '暂无数据' : 'SSE 已连接',
          },
          { content: <>今日发送 <strong>{total}</strong> 条</> },
          { content: <>成功率 <strong>{successRate}</strong></> },
          { content: <>异步待回执 <strong>{asyncPending}</strong></> },
          { content: <>最近错误 <strong>{failed}</strong></> },
        ]}
      />

      <div className="workbench-grid">
        <section className="panel compose" aria-labelledby="compose-title" ref={composeRef} onKeyDown={onComposerKeyDown}>
          <div className="panel-head">
            <div className="panel-head-copy">
              <span className="panel-index">01 / SEND</span>
              <h2 id="compose-title">快速发送</h2>
              <p>选择通道，写好内容，一次送达多个目标。</p>
            </div>
            <span className="tag tag-accent">Markdown</span>
          </div>
          <div className="panel-body">
            {error && <Alert tone="error">{error}</Alert>}

            <div className="form-grid">
              <Field label="通道" htmlFor="wb-channel" hint="CHANNEL" required>
                {channelOptions}
              </Field>
              <Field label="标题" htmlFor="wb-title" hint="OPTIONAL">
                <input id="wb-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="缺省使用系统名" />
              </Field>
            </div>

            <Field label="内容" htmlFor="wb-content" hint="MARKDOWN">
              {mode === 'edit' ? (
                <textarea
                  id="wb-content"
                  className="textarea"
                  rows={4}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder={'**构建成功** ✅ 用时 12s\n\n分支 `main` 已部署到生产环境。'}
                />
              ) : (
                <div className="article md-preview" dangerouslySetInnerHTML={{ __html: renderContent(content || '*（暂无内容）*', renderMode) }} />
              )}
            </Field>

            <div className="compose-row">
              <Segmented<RenderMode>
                ariaLabel="渲染模式"
                value={renderMode}
                options={(Object.keys(RENDER_MODE_LABEL) as RenderMode[]).map((m) => ({ value: m, label: RENDER_MODE_LABEL[m] }))}
                onChange={setRenderMode}
              />
              <span className="inline-control">
                异步投递 <Switch checked={isAsync} onChange={setIsAsync} label="异步投递" />
              </span>
            </div>

            <Field label="目标" htmlFor="wb-to" hint="TO / OPTIONAL">
              <input
                id="wb-to"
                className="input"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="@all 或 a|b · 留空则发送到全部目标"
              />
            </Field>

            <div className="compose-actions">
              <button className="btn btn-primary" onClick={send} disabled={busy || channels.length === 0}>
                {busy ? '发送中…' : (<>发送消息 <Icon name="send" className="icon-sm" /></>)}
              </button>
              <button className="btn" type="button" onClick={() => setMode(mode === 'preview' ? 'edit' : 'preview')}>
                {mode === 'preview' ? '返回编辑' : '预览'}
              </button>
              <span className="shortcut">⌘ ↵</span>
            </div>
          </div>
        </section>

        <section className="panel recent">
          <div className="recent-head">
            <div>
              <h2>最近消息</h2>
              <p>{recentQ.isLoading ? '正在加载投递状态…' : `${merged.length} 条投递 · 按时间倒序`}</p>
            </div>
            {sseStatus === 'open' && (
              <span className="live-flag">
                <span className="dot dot-live" />
                LIVE
              </span>
            )}
          </div>
          {recentQ.isLoading ? (
            <SkeletonRows rows={5} />
          ) : recentQ.isError ? (
            <div className="table-empty" style={{ padding: 24 }}>
              <Alert tone="error">加载失败：{errMessage(recentQ.error)}</Alert>
            </div>
          ) : merged.length === 0 ? (
            <Empty icon="inbox" title="还没有发送记录" description="配置一个消息通道，或直接发送第一条消息。">
              <Link className="btn" to="/channels/new">配置通道</Link>
              <Link className="btn btn-primary" to="/messages/new">发送第一条</Link>
            </Empty>
          ) : (
            <div className="message-list">
              {merged.map((m) => (
                <Link key={m.id} to={`/messages/${m.id}`} className={`message-row${highlightId === m.id ? ' is-live' : ''}`}>
                  <span className={`dot ${STATUS_DOT[m.status] ?? 'dot-accent'}`} aria-hidden="true" />
                  <div>
                    <p className="message-title">{m.title || '（无标题）'}</p>
                    <div className="message-meta">
                      <span>{m.channel_name}</span>
                      <MessageStatusBadge status={m.status} />
                    </div>
                  </div>
                  <span className="message-time">{formatRelative(m.created_at)}</span>
                </Link>
              ))}
            </div>
          )}
          <div className="recent-foot">
            <span className="tertiary xs">SSE 新消息高亮 2 秒</span>
            <Link to="/messages">查看全部 →</Link>
          </div>
        </section>
      </div>
    </>
  );
}
