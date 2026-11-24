import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, call } from '@/api/client';
import { errMessage } from '@/lib/errors';
import { formatLatency } from '@/lib/format';
import { useDocumentTitle } from '@/hooks/misc';
import { toast } from '@/stores/ui';
import { useConfirm } from '@/components/ui/Modal';
import type {
  Channel,
  ChannelCreated,
  ChannelListData,
  ChannelTokenData,
  ChannelTypeDescriptor,
  ChannelTypeListData,
  ChannelTestResultData,
  ChannelType,
  ChannelGuide,
  ConfigField,
} from '@nectarpush/shared';
import { PageHead, Alert, Empty, SkeletonRows, Spinner } from '@/components/ui/Feedback';
import { Field, Switch, Badge } from '@/components/ui/Field';
import { CopyButton } from '@/components/ui/CopyButton';
import { Icon } from '@/components/ui/Icon';

const TO_MODE_LABEL: Record<string, string> = {
  recipient: '接收人',
  '@mention': '@提及',
  chat: '会话 / 群组',
  none: '无需目标',
};

/** A checkbox option rendered by ConfigControl (static enum or live candidates). */
type ConfigOption = { value: string; label: string };

/**
 * Single dynamic config control derived from a ConfigField descriptor.
 * `dynamicOptions` feeds fields whose `options_source` is `channels` (e.g. the
 * group channel's child list) with the user's live channel list; it is
 * `undefined` while that list is still loading.
 */
function ConfigControl({
  field,
  value,
  onChange,
  id,
  dynamicOptions,
  selfId,
}: {
  field: ConfigField;
  value: string;
  onChange: (v: string) => void;
  id?: string;
  dynamicOptions?: { id: number; name: string; type: string; enabled: boolean }[];
  /** The channel being edited; never offered as its own child. */
  selfId?: number;
}) {
  const isSecretPlaceholder = field.secret && value === '******';
  const v = isSecretPlaceholder ? '' : value ?? '';

  switch (field.type) {
    case 'boolean':
      return (
        <div className="checkbox-row">
          <Switch checked={v === 'true'} onChange={(b) => onChange(b ? 'true' : 'false')} label={v === 'true' ? '开启' : '关闭'} />
        </div>
      );
    case 'select':
      return (
        <select id={id} className="select" value={v} onChange={(e) => onChange(e.target.value)}>
          <option value="">请选择</option>
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case 'multiselect': {
      const selected = v ? v.split(',').filter(Boolean) : [];
      const toggle = (opt: string) => {
        const set = new Set(selected);
        if (set.has(opt)) set.delete(opt);
        else set.add(opt);
        onChange([...set].join(','));
      };
      let options: ConfigOption[];
      if (field.options_source === 'channels') {
        // Candidates = the user's own channels, minus itself and other groups
        // (a group of groups would need cycle handling we do not support).
        const selectable = (dynamicOptions ?? []).filter((c) => c.id !== selfId && c.type !== 'group');
        options = selectable.map((c) => ({
          value: String(c.id),
          label: `${c.name} · ${c.type}${c.enabled ? '' : '（已停用）'}`,
        }));
        if (!dynamicOptions) {
          // Still loading: keep stored ids visible without calling them stale.
          options = selected.map((s) => ({ value: s, label: s }));
        } else {
          const known = new Set(options.map((o) => o.value));
          for (const s of selected) {
            if (!known.has(s)) options.push({ value: s, label: `${s}（已失效）` });
          }
        }
      } else {
        options = (field.options ?? []).map((o) => ({ value: o, label: o }));
      }
      return (
        <div className="checkbox-group" id={id} role="group" aria-label={field.label}>
          {options.map((o) => (
            <label key={o.value} className="checkbox-row">
              <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} /> {o.label}
            </label>
          ))}
          {options.length === 0 && (
            <span style={{ opacity: 0.7 }}>暂无可选通道，请先新建其他通道</span>
          )}
        </div>
      );
    }
    case 'textarea':
      return <textarea id={id} className="textarea" rows={4} value={v} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder ?? ''} />;
    case 'number':
      return <input id={id} type="number" className="input" value={v} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder ?? ''} />;
    case 'password':
      return (
        <input
          id={id}
          type="password"
          className="input"
          value={v}
          onChange={(e) => onChange(e.target.value)}
          placeholder={isSecretPlaceholder ? '****** （已配置，留空保持不变）' : field.placeholder ?? ''}
          autoComplete="new-password"
        />
      );
    default:
      return <input id={id} className="input" value={v} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder ?? ''} />;
  }
}

/** 协议指引：后端 guides.ts 是唯一来源，这里只负责排版。 */
function ChannelGuideBlock({ guide, name }: { guide: ChannelGuide; name: string }) {
  return (
    <section className="channel-guide" aria-label={`${name} 配置指引`}>
      <div className="channel-guide-head">
        <Icon name="info" className="icon-sm" />
        <strong>{name} 配置指引</strong>
      </div>
      <p className="channel-guide-summary">{guide.summary}</p>
      {(guide.steps?.length ?? 0) > 0 && (
        <ol className="channel-guide-steps">
          {guide.steps?.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      )}
      {(guide.links?.length ?? 0) > 0 && (
        <div className="channel-guide-links">
          {guide.links?.map((l) => (
            <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="table-link">
              {l.label}
              <Icon name="external" className="icon-xs" />
            </a>
          ))}
        </div>
      )}
      {guide.note && <p className="channel-guide-note">{guide.note}</p>}
    </section>
  );
}

export function ChannelEditPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;
  useDocumentTitle(isEdit ? '编辑通道' : '新建通道');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();

  const typesQ = useQuery({
    queryKey: ['channel-types'],
    queryFn: () => call<ChannelTypeListData>(api.GET('/api/channels/types')),
    staleTime: 5 * 60_000,
  });
  const types: ChannelTypeDescriptor[] = typesQ.data?.items ?? [];

  const channelQ = useQuery({
    queryKey: ['channel', id],
    queryFn: () => call<Channel>(api.GET('/api/channels/{id}', { params: { path: { id: Number(id) } } })),
    enabled: isEdit,
  });

  const [selectedType, setSelectedType] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [token, setToken] = useState('');
  // Q-07: channel-level tokens are shown exactly once (create / rotate).
  const [issuedToken, setIssuedToken] = useState<{ channelId: number; token: string } | null>(null);
  const [config, setConfig] = useState<Record<string, string>>({});
  const [testTo, setTestTo] = useState('');
  const [testResult, setTestResult] = useState<ChannelTestResultData | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (channelQ.data) {
      const c = channelQ.data;
      setSelectedType(c.type);
      setName(c.name);
      setDescription(c.description ?? '');
      setEnabled(c.enabled);
      setConfig({ ...(c.config ?? {}) });
    }
  }, [channelQ.data]);

  // A token is scoped to the channel that issued it; never show it after
  // switching to another channel (or returning to a previous one).
  useEffect(() => {
    setIssuedToken((cur) => (cur && cur.channelId !== Number(id) ? null : cur));
  }, [id]);

  const descriptor = useMemo(() => types.find((t) => t.type === selectedType), [types, selectedType]);
  const fields: ConfigField[] = descriptor?.config_schema?.fields ?? [];

  // `hidden` types (currently only `none`) keep working for existing channels
  // but are no longer offered when creating one — they stay listed only when
  // the channel being edited already uses them.
  const visibleTypes = useMemo(
    () => types.filter((t) => !t.hidden || t.type === selectedType),
    [types, selectedType],
  );

  // Group children are picked from the user's real channels, so the edit screen
  // needs the brief channel list whenever a field asks for it.
  const needsChannelOptions = fields.some((f) => f.options_source === 'channels');
  const channelOptionsQ = useQuery({
    queryKey: ['channels', 'brief'],
    queryFn: () => call<ChannelListData>(api.GET('/api/channels', { params: { query: { brief: true } } })),
    enabled: needsChannelOptions,
    staleTime: 30_000,
  });

  // On the create screen preselect the first core type so the schema form is
  // immediately visible (matches the prototype's default channel-config state).
  useEffect(() => {
    if (isEdit || selectedType || types.length === 0) return;
    const first =
      types.find((t) => !t.hidden && t.status === 'core') ?? types.find((t) => !t.hidden) ?? types[0];
    setSelectedType(first.type);
    setConfig({});
  }, [isEdit, selectedType, types]);

  useEffect(() => {
    if (!descriptor) return;
    setConfig((prev) => {
      const next = { ...prev };
      for (const f of descriptor.config_schema.fields) {
        if (next[f.key] === undefined && f.default !== null && f.default !== undefined) {
          next[f.key] = String(f.default);
        }
      }
      return next;
    });
  }, [descriptor]);

  function buildConfig(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const f of fields) {
      let v = config[f.key];
      if (v === undefined) v = f.default != null ? String(f.default) : '';
      if (f.secret && v === '******') v = '';
      out[f.key] = v;
    }
    return out;
  }

  async function save() {
    setError('');
    if (!isEdit && !selectedType) {
      setError('请选择通道类型');
      return;
    }
    if (!name.trim()) {
      setError('请填写通道名称');
      return;
    }
    for (const f of fields) {
      if (!f.required) continue;
      const v = config[f.key];
      if (f.secret) {
        if (!isEdit && (!v || v === '******')) {
          setError(`请填写 ${f.label}`);
          return;
        }
      } else if (!v) {
        setError(`请填写 ${f.label}`);
        return;
      }
    }
    setBusy(true);
    try {
      if (isEdit) {
        await call(api.PATCH('/api/channels/{id}', {
          params: { path: { id: Number(id) } },
          body: { status_only: false, name, description: description || undefined, enabled, config: buildConfig(), token: token || undefined },
        }));
        toast.success('通道已更新');
        qc.invalidateQueries({ queryKey: ['channels'] });
        qc.invalidateQueries({ queryKey: ['channel', id] });
        navigate('/channels');
      } else {
        const created = await call<ChannelCreated>(api.POST('/api/channels', {
          body: { type: selectedType as ChannelType, name, description: description || undefined, enabled, config: buildConfig(), token: token || undefined },
        }));
        toast.success('通道已创建');
        if (created.access_token) setIssuedToken({ channelId: created.id, token: created.access_token });
        qc.invalidateQueries({ queryKey: ['channels'] });
        navigate(`/channels/${created.id}/edit`, { replace: true });
      }
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function testSend() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await call<ChannelTestResultData>(api.POST('/api/channels/{id}/test', {
        params: { path: { id: Number(id) } },
        body: { to: testTo || undefined },
      }));
      setTestResult(res);
      if (res.success) toast.success('测试发送成功');
      else toast.error(res.message || '测试发送失败');
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setTesting(false);
    }
  }

  async function rotateToken() {
    try {
      const res = await call<ChannelTokenData>(api.POST('/api/channels/{id}/token', {
        params: { path: { id: Number(id) } },
        body: {},
      }));
      setIssuedToken({ channelId: Number(id), token: res.access_token });
      setToken('');
      toast.success('通道级令牌已重新生成');
    } catch (err) {
      toast.error(errMessage(err));
    }
  }

  async function remove() {
    const ok = await confirm({ title: '删除通道', message: `确定删除通道「${name}」吗？此操作不可撤销。`, confirmText: '删除', danger: true });
    if (!ok) return;
    try {
      await call(api.DELETE('/api/channels/{id}', { params: { path: { id: Number(id) } } }));
      toast.success('通道已删除');
      qc.invalidateQueries({ queryKey: ['channels'] });
      navigate('/channels', { replace: true });
    } catch (err) {
      toast.error(errMessage(err));
    }
  }

  if (isEdit && channelQ.isLoading) {
    return (
      <>
        <PageHead eyebrow="Connect / Channels" title="编辑通道" />
        <div className="panel">
          <div className="panel-body">
            <SkeletonRows rows={8} />
          </div>
        </div>
      </>
    );
  }
  if (isEdit && channelQ.isError) {
    return (
      <>
        <PageHead eyebrow="Connect / Channels" title="编辑通道" />
        <Alert tone="error">加载失败：{errMessage(channelQ.error)}</Alert>
        <div style={{ marginTop: 16 }}>
          <Link className="btn" to="/channels">返回列表</Link>
        </div>
      </>
    );
  }

  const caps = descriptor?.capabilities;

  // Child ids that are checked but no longer resolvable (deleted, someone
  // else's, or a group). Surfaced so the user does not save a broken group.
  const childField = fields.find((f) => f.options_source === 'channels');
  const staleChildIds = (() => {
    if (!childField || !channelOptionsQ.data) return [] as string[];
    const items = channelOptionsQ.data.items ?? [];
    return (config[childField.key] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => !items.some((c) => String(c.id) === s && c.id !== Number(id) && c.type !== 'group'));
  })();

  const capabilityTags = caps
    ? [
        caps.title && '标题',
        caps.content && '正文',
        caps.url && '链接',
        caps.markdown && 'Markdown',
      ].filter(Boolean) as string[]
    : [];

  const formPanel = !descriptor ? (
    <section className="panel">
      <div className="panel-title">
        <div className="panel-title-copy">
          <h2>配置通道</h2>
          <p>尚未选择通道类型</p>
        </div>
      </div>
      <div className="panel-body">
        <Empty icon="plug" title="选择一种协议类型" description="在「协议类型」中选择一种通道，即可按配置表单填写。" />
      </div>
    </section>
  ) : (
    <section className="panel">
      <div className="panel-title">
        <div className="panel-title-copy">
          <h2>{descriptor.display_name} 通道配置</h2>
          <p>{descriptor.type} · JSON Schema v1</p>
        </div>
        {descriptor.status === 'draft' && <div className="head-tools"><Badge tone="badge-warning" dot={false}>骨架未联调</Badge></div>}
      </div>
      <div className="panel-body">
        {error && <Alert tone="error">{error}</Alert>}

        {staleChildIds.length > 0 && (
          <Alert tone="warning">
            子通道 {staleChildIds.join('、')} 已不可用（已删除或不属于你），请取消勾选后再保存。
          </Alert>
        )}

        <Field label="通道名称" htmlFor="ch-name" hint="NAME" required>
          <input id="ch-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <Field label="协议类型" htmlFor="ch-type" hint="PROTOCOL" required>
          <select
            id="ch-type"
            className="select"
            value={selectedType}
            disabled={isEdit}
            onChange={(e) => {
              setSelectedType(e.target.value);
              setConfig({});
              setError('');
              setTestResult(null);
            }}
          >
            {(isEdit ? visibleTypes.filter((t) => t.type === selectedType) : visibleTypes).map((t) => (
              <option key={t.type} value={t.type}>
                {t.type} · {t.display_name}
                {t.status === 'draft' ? '（骨架未联调）' : ''}
              </option>
            ))}
          </select>
          {isEdit && <p className="small muted" style={{ marginTop: 6 }}>通道创建后协议类型不可更改。</p>}
        </Field>

        {descriptor.guide && <ChannelGuideBlock guide={descriptor.guide} name={descriptor.display_name} />}

        {fields.map((f) => (
          <Field
            key={f.key}
            label={f.label}
            // Checkbox groups and switches are not labelable form controls.
            htmlFor={f.type === 'multiselect' || f.type === 'boolean' ? undefined : `cfg-${f.key}`}
            hint={f.help ?? undefined}
            required={f.required}
          >
            <ConfigControl
              id={`cfg-${f.key}`}
              field={f}
              value={config[f.key] ?? ''}
              onChange={(v) => setConfig((prev) => ({ ...prev, [f.key]: v }))}
              dynamicOptions={channelOptionsQ.data?.items}
              selfId={isEdit ? Number(id) : undefined}
            />
          </Field>
        ))}

        <Field label="通道级令牌" htmlFor="ch-token" hint={isEdit ? '留空则不修改' : 'TOKEN（可选）'}>
          <div className="form-row-inline">
            <input id="ch-token" className="input" value={token} onChange={(e) => setToken(e.target.value)} placeholder={isEdit ? '留空保持不变' : ''} />
            {isEdit && (
              <button type="button" className="btn" onClick={rotateToken}>
                重新生成
              </button>
            )}
          </div>
          <p className="small muted" style={{ marginTop: 6 }}>
            令牌仅在创建或重新生成时明文显示一次；列表与详情不再回显。
          </p>
        </Field>

        {issuedToken && issuedToken.channelId === Number(id) && (
          <Alert tone="success">
            <div className="row-inline" style={{ marginTop: 8 }}>
              <code className="mono" data-testid="issued-token" style={{ wordBreak: 'break-all' }}>{issuedToken.token}</code>
              <CopyButton value={issuedToken.token} />
            </div>
            <p className="small muted" style={{ marginTop: 6 }}>请立即保存；关闭后无法再次查看，只能重新生成。</p>
            <div style={{ marginTop: 10 }}>
              <Link className="btn btn-sm" to="/channels">返回列表</Link>
            </div>
          </Alert>
        )}

        <Field label="说明" htmlFor="ch-desc" hint="DESCRIPTION（可选）">
          <input id="ch-desc" className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>

        <Field label="测试接收目标" htmlFor="ch-test-to" hint="TEST TO（可选）">
          <input id="ch-test-to" className="input" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="用于测试发送的接收目标，留空使用默认" />
        </Field>

        {capabilityTags.length > 0 && (
          <div className="capability-row">
            <span className="small muted">接收能力：</span>
            {capabilityTags.map((t) => (
              <span key={t} className="tag tag-accent">{t}</span>
            ))}
          </div>
        )}

        <div className="mt-4">
          <div className="setting-row">
            <div className="setting-label">
              <h3>启用此通道</h3>
              <p>停用后，新消息无法通过此通道发送</p>
            </div>
            <div className="setting-control">
              <Switch checked={enabled} onChange={setEnabled} label="启用此通道" />
            </div>
          </div>
        </div>
        <div className="panel-actions">
          <Link className="btn btn-ghost" to="/channels">取消</Link>
          <span className="spacer" />
          <button className="btn" onClick={testSend} disabled={testing || !isEdit} title={isEdit ? undefined : '请先保存通道后再测试'}>
            {testing ? '测试中…' : '测试发送'}
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? '保存中…' : '保存配置'}
          </button>
        </div>
      </div>
    </section>
  );

  const sidePanel = testing || testResult ? (
    <aside className="panel">
      <div className="panel-title">
        <div className="panel-title-copy">
          <h2>{testResult ? '测试结果' : '测试发送'}</h2>
          <p>{testResult ? '上游返回与耗时' : '正在向接收目标发送…'}</p>
        </div>
      </div>
      <div className="panel-body">
        {testing && <Spinner label="正在测试" />}
        {testResult && (
          <div className="test-result">
            <Badge tone={testResult.success ? 'badge-success' : 'badge-danger'}>{testResult.success ? '成功' : '失败'}</Badge>
            <p className="muted-text" style={{ marginTop: 8 }}>{testResult.message}</p>
            {testResult.latency_ms != null && <p className="small muted">耗时 {formatLatency(testResult.latency_ms)}</p>}
            {testResult.raw && (
              <div style={{ marginTop: 10 }}>
                <div className="row-gap" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                  <span className="field-label">原始响应</span>
                  <CopyButton value={testResult.raw} />
                </div>
                <pre className="code-block">{testResult.raw}</pre>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  ) : (
    <aside className="panel">
      <div className="panel-title">
        <div className="panel-title-copy">
          <h2>通道能力</h2>
          <p>由通道 Schema 决定可用目标类型</p>
        </div>
      </div>
      <div className="panel-body">
        <dl className="kv">
          <div>
            <dt>Schema</dt>
            <dd className="mono">{descriptor ? `${descriptor.type}/v1.json` : '—'}</dd>
          </div>
          <div>
            <dt>目标模式</dt>
            <dd>{caps?.to_mode ? (TO_MODE_LABEL[caps.to_mode] ?? caps.to_mode) : '—'}</dd>
          </div>
          <div>
            <dt>内容能力</dt>
            <dd>{capabilityTags.length ? capabilityTags.join(' · ') : '—'}</dd>
          </div>
          <div>
            <dt>状态</dt>
            <dd>{descriptor?.status === 'draft' ? '骨架未联调' : '核心支持'}</dd>
          </div>
        </dl>
      </div>
    </aside>
  );

  return (
    <>
      <PageHead
        eyebrow="Connect / Channels"
        title={isEdit ? '配置消息通道' : '添加消息通道'}
        description="字段由通道 Schema 驱动，能力决定可选目标。"
        actions={
          <>
            {isEdit && (
              <button className="btn btn-danger" onClick={remove} disabled={busy}>
                <Icon name="trash" /> 删除
              </button>
            )}
            <Link className="btn btn-ghost" to="/channels">返回列表</Link>
          </>
        }
      />
      <div className="channel-edit-layout">
        {formPanel}
        {sidePanel}
      </div>
    </>
  );
}
