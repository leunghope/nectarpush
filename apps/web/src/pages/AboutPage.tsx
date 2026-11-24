import { useQuery } from '@tanstack/react-query';
import { api, call } from '@/api/client';
import { renderContent } from '@/lib/markdown';
import { useDocumentTitle } from '@/hooks/misc';
import type { TextContentData, VersionData } from '@nectarpush/shared';
import { PublicShell } from '@/components/layout/Shells';
import { Empty, SkeletonRows } from '@/components/ui/Feedback';

export function AboutPage() {
  useDocumentTitle('关于');
  const aboutQ = useQuery({
    queryKey: ['public-about'],
    queryFn: () => call<TextContentData>(api.GET('/api/public/about')),
    staleTime: 5 * 60_000,
  });
  const versionQ = useQuery({
    queryKey: ['version'],
    queryFn: () => call<VersionData>(api.GET('/api/version')),
    staleTime: 5 * 60_000,
  });

  const content = aboutQ.data?.content?.trim();

  return (
    <PublicShell>
      {aboutQ.isLoading ? (
        <SkeletonRows rows={8} />
      ) : (
        <>
          <p className="eyebrow public-kicker">About / NectarPush</p>
          <h1 className="public-title">安静、精确，不喧哗的推送工具。</h1>
          <p className="public-lede">
            一次请求，送达邮件、Webhook、飞书、Telegram 等 16 种通道。
          </p>
          <div className="divider" />
          {content ? (
            <div className="article" dangerouslySetInnerHTML={{ __html: renderContent(content, 'markdown') }} />
          ) : (
            <Empty icon="info" title="关于内容尚未准备" description="管理员可在「其他设置 → 关于页面」中填写这段内容。" />
          )}
          <div className="divider" />
          <div className="grid-3">
            <div>
              <p className="eyebrow">VERSION</p>
              <p className="mono">{versionQ.data?.version ?? '—'}</p>
            </div>
            <div>
              <p className="eyebrow">LICENSE</p>
              <p>MIT</p>
            </div>
            <div>
              <p className="eyebrow">STACK</p>
              <p>NestJS · React · SQLite</p>
            </div>
          </div>
          <div className="divider" />
          <div className="article">
            <h3>设计原则</h3>
            <ul>
              <li>克制：默认安静，只在必要时提示。</li>
              <li>精确：每一次投递都有独立回执与延迟记录。</li>
              <li>可自托管：单进程起步，数据留在自己的机器上。</li>
            </ul>
            <p className="small muted">公开页面为只读快照，配置由站点的 root 账户维护。</p>
          </div>
        </>
      )}
    </PublicShell>
  );
}