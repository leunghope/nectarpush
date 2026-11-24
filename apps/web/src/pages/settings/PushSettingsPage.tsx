import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, call } from '@/api/client';
import { errMessage } from '@/lib/errors';
import { useDocumentTitle } from '@/hooks/misc';
import { toast } from '@/stores/ui';
import type { Channel, ChannelListData, PushSettingsData } from '@nectarpush/shared';
import { PageHead, Alert, SkeletonRows } from '@/components/ui/Feedback';
import { CopyButton } from '@/components/ui/CopyButton';
import { Icon } from '@/components/ui/Icon';
import { SettingsLayout, SettingsSection, SettingRow, type SettingsNavItem } from '@/components/layout/SettingsLayout';

const SECTIONS: SettingsNavItem[] = [
  { id: 'channel', label: '默认通道' },
  { id: 'start', label: '快速开始' },
  { id: 'params', label: '参数说明' },
  { id: 'status', label: '查询状态' },
];

const PARAMS: Array<[string, string, string, string]> = [
  ['channel', 'string', '否', '目标通道名称；留空则使用默认通道'],
  ['title', 'string', '否', '消息标题'],
  ['content', 'string', '否', '消息正文，支持 Markdown'],
  ['to', 'string', '否', '接收目标（依赖通道能力）'],
  ['render_mode', 'string', '否', 'markdown / code / raw'],
  ['async', 'boolean', '否', '异步投递，立即返回 messageId'],
];

export function PushSettingsPage() {
  useDocumentTitle('推送设置');
  const qc = useQueryClient();
  const [defaultChannel, setDefaultChannel] = useState<string>('');
  const [editingDefault, setEditingDefault] = useState(false);

  const pushQ = useQuery({
    queryKey: ['me-push'],
    queryFn: () => call<PushSettingsData>(api.GET('/api/me/push')),
  });
  const channelsQ = useQuery({
    queryKey: ['channels', 'all'],
    queryFn: () => call<ChannelListData>(api.GET('/api/channels', { params: { query: { brief: true } } })),
  });
  const channels: Channel[] = channelsQ.data?.items ?? [];
  const data = pushQ.data;

  async function saveDefault() {
    try {
      await call(api.PATCH('/api/me/push', { body: { default_channel: defaultChannel || undefined } }));
      toast.success('默认通道已更新');
      setEditingDefault(false);
      qc.invalidateQueries({ queryKey: ['me-push'] });
    } catch (err) {
      toast.error(errMessage(err));
    }
  }

  const quickStart = data?.examples?.curl ?? data?.examples?.[Object.keys(data?.examples ?? {})[0] ?? ''] ?? '';
  const statusExample =
    data?.examples?.status ??
    `curl "${data?.push_endpoint ?? ''}/api/messages/{messageId}" \\
  -H "Content-Type: application/json"`;

  return (
    <>
      <PageHead eyebrow="Account / Push" title="推送设置" description="了解如何通过 API 或 Webhook 向已有通道推送消息" />
      <SettingsLayout sections={SECTIONS}>
        {pushQ.isError ? (
          <Alert tone="error">加载失败：{errMessage(pushQ.error)}</Alert>
        ) : pushQ.isLoading || !data ? (
          <div className="panel"><div className="panel-body"><SkeletonRows rows={6} /></div></div>
        ) : (
          <>
            <SettingsSection id="channel" title="默认通道" description="未显式指定 channel 时，消息将投递到该通道">
              <SettingRow label="推送通道" description="留空则使用内置通道">
                {editingDefault ? (
                  <div className="row-gap">
                    <select className="select" value={defaultChannel} onChange={(e) => setDefaultChannel(e.target.value)}>
                      <option value="">未设置</option>
                      {channels.map((c) => (
                        <option key={c.id} value={c.name}>{c.name}（{c.type}）</option>
                      ))}
                    </select>
                    <button className="btn btn-sm btn-primary" onClick={saveDefault}>保存</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => setEditingDefault(false)}>取消</button>
                  </div>
                ) : (
                  <div className="row-gap">
                    <span>{data.default_channel || '未设置'}</span>
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => {
                        setDefaultChannel(data.default_channel ?? '');
                        setEditingDefault(true);
                      }}
                    >
                      修改
                    </button>
                  </div>
                )}
              </SettingRow>
              <SettingRow label="推送地址" description="使用 POST 调用此地址即可推送消息">
                <div className="row-gap" style={{ maxWidth: 420 }}>
                  <span className="mono-ellipsis mono" style={{ flex: 1 }}>{data.push_endpoint}</span>
                  <CopyButton value={data.push_endpoint} showLabel={false} className="icon-btn" />
                </div>
              </SettingRow>
            </SettingsSection>

            <SettingsSection
              id="start"
              title="快速开始"
              description="使用 curl 发送一条消息"
              actions={
                <Link className="btn btn-sm btn-ghost" to="/me#token">
                  <Icon name="key" className="icon-sm" /> 管理 Token
                </Link>
              }
            >
              <div className="code-head">
                <span className="field-label">curl</span>
                {quickStart && <CopyButton value={quickStart} />}
              </div>
              <pre className="code-block">{quickStart || '暂无示例'}</pre>
            </SettingsSection>

            <SettingsSection id="params" title="参数说明" description="推送接口的请求体字段">
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>参数</th>
                      <th>类型</th>
                      <th>必填</th>
                      <th>说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PARAMS.map(([name, type, required, desc]) => (
                      <tr key={name}>
                        <td className="mono">{name}</td>
                        <td className="muted-text">{type}</td>
                        <td className="muted-text">{required}</td>
                        <td>{desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SettingsSection>

            <SettingsSection id="status" title="查询推送状态" description="使用返回的 messageId 轮询异步回执">
              <div className="code-head">
                <span className="field-label">curl</span>
                <CopyButton value={statusExample} />
              </div>
              <pre className="code-block">{statusExample}</pre>
            </SettingsSection>
          </>
        )}
      </SettingsLayout>
    </>
  );
}
