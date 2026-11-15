import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, call } from '@/api/client';
import { renderContent } from '@/lib/markdown';
import { errMessage } from '@/lib/errors';
import { useDocumentTitle } from '@/hooks/misc';
import { toast } from '@/stores/ui';
import type { Channel, ChannelListData, RenderMode, SendResultData } from '@nectarpush/shared';
import { PageHead, Alert } from '@/components/ui/Feedback';
import { Field } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';

/**
 * P08 新建消息：独立的「编辑消息 + 实时预览」两栏页面。
 * 契约没有草稿接口，`保存草稿` 保持禁用并说明原因。
 */
export function NewMessagePage() {
  useDocumentTitle('新建消息');
  const navigate = useNavigate();
  const qc = useQueryClient();

  const channelsQ = useQuery({
    queryKey: ['channels', 'all'],
    queryFn: () => call<ChannelListData>(api.GET('/api/channels', { params: { query: { brief: true } } })),
  });
  const channels: Channel[] = channelsQ.data?.items ?? [];

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [format, setFormat] = useState<RenderMode>('markdown');
  const [channel, setChannel] = useState('');
  const [to, setTo] = useState('');
  const [fullPreview, setFullPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!channel && channels.length > 0) setChannel(channels[0].name);
  }, [channels, channel]);

  const previewHtml = useMemo(() => renderContent(content || '*（暂无内容）*', format), [content, format]);

  async function send() {
    setError('');
    if (!channel) {
      setError('请选择发送通道');
      return;
    }
    if (!content.trim() && !title.trim()) {
      setError('请输入标题或内容');
      return;
    }
    setBusy(true);
    try {
      const data = await call<SendResultData>(api.POST('/api/messages', {
        body: { channel, title: title || undefined, content: content || undefined, to: to || undefined, render_mode: format, async: false },
      }));
      toast.success('消息已发送');
      qc.invalidateQueries({ queryKey: ['messages'] });
      qc.invalidateQueries({ queryKey: ['message', data.uuid] });
      navigate('/messages');
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (fullPreview) {
    return (
      <>
        <PageHead
          eyebrow="Work / Messages"
          title="预览消息"
          description="确认实际发送内容。最终样式可能因通道而异。"
          actions={
            <>
              <button className="btn" type="button" onClick={() => setFullPreview(false)}>
                <Icon name="chevron-left" className="icon-sm" /> 返回编辑
              </button>
              <button className="btn btn-primary" type="button" onClick={send} disabled={busy}>
                确认发送 <Icon name="send" className="icon-sm" />
              </button>
            </>
          }
        />
        <section className="panel">
          <div className="panel-body">
            <div className="article" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      <PageHead eyebrow="Work / Messages" title="新建消息" description="编写一次，通过多个通道触达目标。" />

      {channelsQ.isSuccess && channels.length === 0 && (
        <Alert tone="warning" actions={<Link className="btn btn-sm" to="/channels/new">创建通道</Link>}>
          你还没有可用通道，请先创建一个通道再发送消息。
        </Alert>
      )}

      <div className="grid-2">
        <section className="panel">
          <div className="panel-title">
            <div className="panel-title-copy">
              <h2>编辑消息</h2>
              <p>支持 Markdown，最终按通道能力渲染</p>
            </div>
          </div>
          <div className="panel-body">
            {error && <Alert tone="error">{error}</Alert>}
            <Field label="标题" htmlFor="nm-title" hint="TITLE">
              <input id="nm-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="消息标题" />
            </Field>
            <div className="form-grid">
              <Field label="消息格式" htmlFor="nm-format" hint="FORMAT">
                <select id="nm-format" className="select" value={format} onChange={(e) => setFormat(e.target.value as RenderMode)}>
                  <option value="markdown">Markdown</option>
                  <option value="raw">纯文本</option>
                </select>
              </Field>
              <Field label="保存状态" htmlFor="nm-status" hint="STATUS">
                <select id="nm-status" className="select" value="immediate" disabled>
                  <option value="immediate">立即发送</option>
                </select>
              </Field>
            </div>
            <Field label="内容" htmlFor="nm-content" hint="MARKDOWN">
              <textarea
                id="nm-content"
                className="textarea"
                rows={14}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={'# 部署完成\n\n**api-gateway v2.4.1** 已成功发布到生产环境。'}
              />
            </Field>
            <div className="form-grid">
              <Field label="发送通道" htmlFor="nm-channel" hint="CHANNEL" required>
                <select id="nm-channel" className="select" value={channel} onChange={(e) => setChannel(e.target.value)}>
                  {channels.length === 0 && <option value="">暂无可用通道</option>}
                  {channels.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                      {c.type ? ` · ${c.type}` : ''}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="接收目标" htmlFor="nm-to" hint="TO">
                <input id="nm-to" className="input" value={to} onChange={(e) => setTo(e.target.value)} placeholder="@all 或 a|b · 留空使用默认目标" />
              </Field>
            </div>
            <p className="muted-text" style={{ marginTop: -6 }}>草稿功能暂未开放：后端契约暂未提供草稿接口，仅支持立即发送。</p>
            <div className="form-actions">
              <button className="btn btn-ghost" type="button" disabled title="后端暂未提供草稿接口">
                保存草稿
              </button>
              <span className="spacer" />
              <button className="btn" type="button" onClick={() => setFullPreview(true)}>
                全屏预览
              </button>
              <button className="btn btn-primary" type="button" onClick={send} disabled={busy || channels.length === 0}>
                {busy ? '发送中…' : (<>发送 <Icon name="send" className="icon-sm" /></>)}
              </button>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-title">
            <div className="panel-title-copy">
              <h2>实时预览</h2>
              <p>最终样式可能因通道而异</p>
            </div>
            <div className="head-tools">
              <span className="tag">PREVIEW</span>
            </div>
          </div>
          <div className="panel-body">
            <div className="article" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </div>
        </section>
      </div>
    </>
  );
}
