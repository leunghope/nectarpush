import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, call } from '@/api/client';
import { errMessage } from '@/lib/errors';
import { useDocumentTitle } from '@/hooks/misc';
import { toast } from '@/stores/ui';
import type { Channel, ChannelListData, Webhook, WebhookConstructRule } from '@nectarpush/shared';
import { PageHead, Alert, SkeletonRows } from '@/components/ui/Feedback';
import { Field, Switch } from '@/components/ui/Field';
import { CopyButton } from '@/components/ui/CopyButton';
import { Icon } from '@/components/ui/Icon';
import {
  defaultExtractRows,
  newExtractRow,
  referencedVars,
  rowsFromRule,
  ruleFromRows,
  type ExtractRow,
} from './webhookRules';

export function WebhookEditPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;
  useDocumentTitle(isEdit ? '编辑 Webhook' : '新建 Webhook');
  const navigate = useNavigate();
  const qc = useQueryClient();

  const channelsQ = useQuery({
    queryKey: ['channels', 'all'],
    queryFn: () => call<ChannelListData>(api.GET('/api/channels', { params: { query: { brief: true } } })),
  });
  const channels: Channel[] = channelsQ.data?.items ?? [];

  const webhookQ = useQuery({
    queryKey: ['webhook', id],
    queryFn: () => call<Webhook>(api.GET('/api/webhooks/{id}', { params: { path: { id: Number(id) } } })),
    enabled: isEdit,
  });

  const [name, setName] = useState('');
  const [targetChannel, setTargetChannel] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [extractRows, setExtractRows] = useState<ExtractRow[]>(defaultExtractRows);
  const [construct, setConstruct] = useState<WebhookConstructRule>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (webhookQ.data) {
      const w = webhookQ.data;
      setName(w.name);
      setTargetChannel(w.target_channel);
      setEnabled(w.enabled);
      setExtractRows(rowsFromRule(w.extract_rule));
      setConstruct({ ...(w.construct_rule ?? {}) });
    }
  }, [webhookQ.data]);

  useEffect(() => {
    if (!isEdit && channels.length > 0 && !targetChannel) setTargetChannel(channels[0].name);
  }, [channels, isEdit, targetChannel]);

  const ruleResult = useMemo(() => ruleFromRows(extractRows), [extractRows]);
  const definedVars = ruleResult.ok ? Object.keys(ruleResult.rule) : [];
  const usedVars = useMemo(() => referencedVars(construct), [construct]);
  const missingVars = ruleResult.ok ? usedVars.filter((key) => !(key in ruleResult.rule)) : [];

  function collectConstruct(): WebhookConstructRule {
    const out: WebhookConstructRule = {};
    for (const key of ['title', 'description', 'content', 'url'] as const) {
      const v = construct[key];
      if (v && v.trim()) out[key] = v.trim();
    }
    return out;
  }

  async function save() {
    setError('');
    if (!name.trim()) return setError('请填写 Webhook 名称');
    if (!targetChannel) return setError('请选择目标通道');
    const rules = ruleFromRows(extractRows);
    if (!rules.ok) return setError(rules.error);
    setBusy(true);
    try {
      const body = {
        name: name.trim(),
        target_channel: targetChannel,
        enabled,
        extract_rule: rules.rule,
        construct_rule: collectConstruct(),
      };
      if (isEdit) {
        await call(api.PATCH('/api/webhooks/{id}', { params: { path: { id: Number(id) } }, body: { status_only: false, ...body } }));
        toast.success('Webhook 已保存');
        qc.invalidateQueries({ queryKey: ['webhooks'] });
        qc.invalidateQueries({ queryKey: ['webhook', id] });
      } else {
        await call(api.POST('/api/webhooks', { body }));
        toast.success('Webhook 已创建');
        qc.invalidateQueries({ queryKey: ['webhooks'] });
        navigate('/webhooks', { replace: true });
      }
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (isEdit && webhookQ.isLoading) {
    return (
      <>
        <PageHead eyebrow="Connect / Webhooks" title="编辑 Webhook" />
        <div className="panel"><div className="panel-body"><SkeletonRows rows={8} /></div></div>
      </>
    );
  }

  const w = webhookQ.data;

  return (
    <>
      <PageHead
        eyebrow="Connect / Webhooks"
        title={isEdit ? '编辑 Webhook' : '新建 Webhook'}
        description={isEdit && w ? `短链 /webhook/${w.link}` : 'Webhook 提供固定的免鉴权触发链接，收到 POST 请求后按规则转发到目标通道。'}
        actions={
          <>
            <Link className="btn btn-ghost" to="/webhooks">返回列表</Link>
            <button className="btn btn-primary" onClick={save} disabled={busy}>
              {busy ? '保存中…' : '保存 Webhook'}
            </button>
          </>
        }
      />

      <div className="stack">
        <section className="panel">
          <div className="panel-title">
            <div className="panel-title-copy">
              <h2>基础信息</h2>
              <p>名称、方法与启用状态</p>
            </div>
          </div>
          <div className="panel-body">
            {error && <Alert tone="error">{error}</Alert>}

            <Field label="名称" htmlFor="wh-name" hint="NAME" required>
              <input id="wh-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>

            <div className="form-grid">
              <Field label="短链" htmlFor="wh-link" hint="PATH">
                <input id="wh-link" className="input" value={isEdit && w ? `/webhook/${w.link}` : '创建后自动生成'} readOnly />
              </Field>
              <Field label="方法" htmlFor="wh-method" hint="METHOD">
                <select id="wh-method" className="select" value="POST" disabled>
                  <option value="POST">POST</option>
                </select>
              </Field>
            </div>

            <Field label="目标通道" htmlFor="wh-target" hint="CHANNEL" required>
              <select id="wh-target" className="select" value={targetChannel} onChange={(e) => setTargetChannel(e.target.value)}>
                <option value="">请选择</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}（{c.type}）
                  </option>
                ))}
              </select>
            </Field>

            {isEdit && w && (
              <Field label="完整触发地址" htmlFor="wh-trigger" hint="TRIGGER URL">
                <div className="row-gap">
                  <span id="wh-trigger" className="mono-ellipsis mono" style={{ flex: 1 }}>{w.trigger_url}</span>
                  <CopyButton value={w.trigger_url} showLabel={false} className="icon-btn" />
                </div>
              </Field>
            )}

            <div className="mt-4">
              <div className="setting-row">
                <div className="setting-label">
                  <h3>启用此 Webhook</h3>
                  <p>停用后短链返回 404，历史消息不受影响</p>
                </div>
                <div className="setting-control">
                  <Switch checked={enabled} onChange={setEnabled} label="启用此 Webhook" />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-title">
            <div className="panel-title-copy">
              <h2>提取规则</h2>
              <p>从请求中提取消息字段；按顺序应用</p>
            </div>
          </div>
          <div className="panel-body">
            <p className="field-help" style={{ marginBottom: 14 }}>
              左侧填写变量名（字母、数字、下划线），右侧填写请求体中的 JSONPath，例如{' '}
              <code>$.head_commit.message</code>。变量名可在下方构造规则中用 <code>$变量</code> 引用。
            </p>
            <div className="rule-editor">
              {extractRows.length > 0 && (
                <div className="rule-head" aria-hidden="true">
                  <span>变量名</span>
                  <span>JSONPath</span>
                  <span />
                </div>
              )}
              {extractRows.map((row, index) => (
                <div className="rule-row" key={row.id}>
                  <input
                    className="input"
                    aria-label={`变量名 ${index + 1}`}
                    placeholder="如 title"
                    maxLength={40}
                    value={row.key}
                    onChange={(e) =>
                      setExtractRows((rows) => rows.map((r) => (r.id === row.id ? { ...r, key: e.target.value } : r)))
                    }
                  />
                  <input
                    className="input"
                    aria-label={`JSONPath ${index + 1}`}
                    placeholder="如 $.head_commit.message"
                    maxLength={500}
                    value={row.path}
                    onChange={(e) =>
                      setExtractRows((rows) => rows.map((r) => (r.id === row.id ? { ...r, path: e.target.value } : r)))
                    }
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`删除提取规则 ${index + 1}`}
                    onClick={() => setExtractRows((rows) => rows.filter((r) => r.id !== row.id))}
                  >
                    <Icon name="trash" className="icon-sm" />
                  </button>
                </div>
              ))}
              {extractRows.length === 0 && (
                <p className="field-help">尚未配置提取规则，构造规则中将没有可用变量。</p>
              )}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setExtractRows((rows) => [...rows, newExtractRow()])}
              >
                <Icon name="plus" className="icon-sm" /> 添加提取规则
              </button>
            </div>
            {!ruleResult.ok && <p className="field-help rule-error">{ruleResult.error}</p>}
            {ruleResult.ok && ruleResult.warnings.length > 0 && (
              <p className="field-help">{ruleResult.warnings.join('；')}</p>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-title">
            <div className="panel-title-copy">
              <h2>构造规则</h2>
              <p>用提取出的变量拼装消息内容</p>
            </div>
          </div>
          <div className="panel-body">
            <div className="field-label" style={{ display: 'block', marginBottom: 8 }}>构造模板<span className="hint">TEMPLATE</span></div>
            <p className="field-help" style={{ marginBottom: 10 }}>
              用 <code>$变量</code> 引用上方提取结果，例如 <code>⭐ 新 Star：$repo</code>。留空则不发送该字段（不会自动沿用提取值）。
            </p>
            <p className="field-help" style={{ marginBottom: 12 }}>
              {definedVars.length > 0 ? (
                <>
                  可用变量：
                  {definedVars.map((key) => (
                    <code key={key} style={{ marginRight: 6 }}>{`$${key}`}</code>
                  ))}
                </>
              ) : (
                '尚未定义提取变量，构造模板中的 $变量 将被替换为空。'
              )}
            </p>
            {missingVars.length > 0 && (
              <Alert tone="warning">
                构造规则引用了未定义的变量：{missingVars.map((key) => `$${key}`).join('、')}。保存后这些占位会被替换为空。
              </Alert>
            )}
            <Field label="标题" htmlFor="cr-title" hint="TITLE">
              <input id="cr-title" className="input" value={construct.title ?? ''} onChange={(e) => setConstruct((c) => ({ ...c, title: e.target.value }))} placeholder="如 ⭐ 新 Star：$repo" />
            </Field>
            <Field label="描述" htmlFor="cr-desc" hint="DESCRIPTION">
              <input id="cr-desc" className="input" value={construct.description ?? ''} onChange={(e) => setConstruct((c) => ({ ...c, description: e.target.value }))} placeholder="如 来自 $sender" />
            </Field>
            <Field label="正文" htmlFor="cr-content" hint="CONTENT">
              <textarea id="cr-content" className="textarea" rows={5} value={construct.content ?? ''} onChange={(e) => setConstruct((c) => ({ ...c, content: e.target.value }))} placeholder="如 $repo 收到一条新事件：$title" />
            </Field>
            <Field label="链接" htmlFor="cr-url" hint="URL">
              <input id="cr-url" className="input" value={construct.url ?? ''} onChange={(e) => setConstruct((c) => ({ ...c, url: e.target.value }))} placeholder="如 $url" />
            </Field>
          </div>
        </section>
      </div>
    </>
  );
}
