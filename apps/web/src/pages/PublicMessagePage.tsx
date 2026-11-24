import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, call } from '@/api/client';
import { errMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { renderContent } from '@/lib/markdown';
import { useDocumentTitle } from '@/hooks/misc';
import type { PublicMessageDetail } from '@nectarpush/shared';
import { PublicShell } from '@/components/layout/Shells';
import { Empty, SkeletonRows } from '@/components/ui/Feedback';
import { Icon } from '@/components/ui/Icon';

export function PublicMessagePage() {
  const { uuid } = useParams<{ uuid: string }>();
  const q = useQuery({
    queryKey: ['public-message', uuid],
    queryFn: () => call<PublicMessageDetail>(api.GET('/api/messages/{uuid}', { params: { path: { uuid: uuid! } } })),
    enabled: !!uuid,
    retry: false,
  });
  useDocumentTitle(q.data?.title || '消息');

  if (q.isLoading) {
    return (
      <PublicShell>
        <SkeletonRows rows={8} />
      </PublicShell>
    );
  }

  if (q.isError || !q.data) {
    const status = (q.error as { status?: number } | null)?.status;
    const disabled = status === 403;
    return (
      <PublicShell>
        <Empty
          icon={disabled ? 'link' : 'inbox'}
          title={disabled ? '公开访问已关闭' : '消息不存在或已删除'}
          description={
            disabled
              ? '这条消息仍存在，但所有者已关闭公开链接。'
              : '请检查链接是否完整。公开链接可能已过期。'
          }
        >
          <Link className="btn btn-primary" to="/">
            返回首页
          </Link>
        </Empty>
        {!disabled && q.isError && <p className="small muted" style={{ marginTop: 12 }}>{errMessage(q.error)}</p>}
      </PublicShell>
    );
  }

  const msg = q.data;

  return (
    <PublicShell>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
        <span className="small muted">
          <span className="dot dot-success" /> {formatDate(msg.created_at)} · 公开快照
        </span>
        <span className="mono xs muted">{msg.uuid}</span>
      </div>
      <p className="eyebrow public-kicker">Public message</p>
      <h1 className="public-title">{msg.title || '（无标题）'}</h1>
      <p className="public-lede">由 NectarPush 发布的公开消息</p>
      <div className="divider" />
      {msg.content ? (
        <div className="article" dangerouslySetInnerHTML={{ __html: renderContent(msg.content, msg.render_mode) }} />
      ) : (
        <p className="muted-text">该消息没有正文内容。</p>
      )}
      {msg.url && (
        <p style={{ marginTop: 16 }}>
          <a className="btn btn-sm" href={msg.url} target="_blank" rel="noreferrer">
            <Icon name="external" className="icon-sm" /> 查看相关链接
          </a>
        </p>
      )}
      <div className="divider" />
      <p className="small muted">
        这是只读快照。消息内容可能随后续更新而变化，所有者可随时关闭公开访问。
      </p>
    </PublicShell>
  );
}