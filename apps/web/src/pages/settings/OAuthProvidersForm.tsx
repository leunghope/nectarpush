import { useEffect, useRef, useState } from 'react';
import { api, call } from '@/api/client';
import { errMessage } from '@/lib/errors';
import type { OAuthDiscoveryData } from '@nectarpush/shared';
import { Alert } from '@/components/ui/Feedback';
import {
  emptyProviderDraft,
  githubProviderDraft,
  parseProviderDrafts,
  serializeProviderDrafts,
  validateProviderDrafts,
  type ProviderDraft,
  type ProviderIssue,
} from './oauthProviders';

const FIELD_LABELS: Record<string, string> = {
  id: 'id',
  display_name: '显示名称',
  authorize_url: 'authorize_url',
  token_url: 'token_url',
  userinfo_url: 'userinfo_url',
  client_id: 'client_id',
  client_secret: 'client_secret',
  scope: 'scope',
  map_username: 'map_username',
  map_email: 'map_email',
};

function issuesFor(issues: ProviderIssue[], index: number, field: string): string | undefined {
  return issues.find((it) => it.index === index && it.field === field)?.message;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function TextField({
  id,
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  error,
  required,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  error?: string;
  required?: boolean;
}) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        <span>
          {label}
          {required && <span aria-hidden="true"> *</span>}
        </span>
      </label>
      <input
        id={id}
        className="input"
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={type === 'password' ? 'new-password' : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && <div className="error-text">{error}</div>}
    </div>
  );
}

/**
 * Stage 9 OAuth2 provider editor (design §5). Replaces the raw JSON textarea
 * with a card form + GitHub preset + secret redaction hints, and keeps
 * `OAuth2Providers` in sync as a serialized JSON string via `onChange`.
 */
export function OAuthProvidersForm({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [providers, setProviders] = useState<ProviderDraft[]>(() => parseProviderDrafts(value));
  const [confirmIndex, setConfirmIndex] = useState<number | null>(null);
  const [addKind, setAddKind] = useState<'github' | 'custom'>('github');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advancedText, setAdvancedText] = useState('');
  const [advancedError, setAdvancedError] = useState('');
  const [discoveryInputs, setDiscoveryInputs] = useState<Record<number, string>>({});
  const [discoveryBusy, setDiscoveryBusy] = useState<number | null>(null);
  const [discoveryErrors, setDiscoveryErrors] = useState<Record<number, string>>({});
  const [discoveryNotes, setDiscoveryNotes] = useState<Record<number, string>>({});
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  const lastEmitted = useRef(value);

  // Re-sync from the parent only when the value changes for reasons other than
  // our own emit (e.g. options loaded or reloaded after a save).
  useEffect(() => {
    if (value !== lastEmitted.current) {
      setProviders(parseProviderDrafts(value));
      lastEmitted.current = value;
    }
  }, [value]);

  const issues = validateProviderDrafts(providers);
  const invalid = issues.length > 0;

  function emit(next: ProviderDraft[]) {
    setProviders(next);
    const s = serializeProviderDrafts(next);
    lastEmitted.current = s;
    onChange(s);
  }

  function updateAt(index: number, patch: Partial<ProviderDraft>) {
    emit(providers.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }

  function addProvider() {
    const draft = addKind === 'github' ? githubProviderDraft() : emptyProviderDraft();
    emit([...providers, draft]);
  }

  function removeAt(index: number) {
    emit(providers.filter((_, i) => i !== index));
    setConfirmIndex(null);
  }

  async function runDiscovery(index: number, fallbackUrl: string) {
    const url = (discoveryInputs[index] ?? fallbackUrl).trim();
    if (!url) return;
    setDiscoveryBusy(index);
    setDiscoveryErrors((prev) => ({ ...prev, [index]: '' }));
    setDiscoveryNotes((prev) => ({ ...prev, [index]: '' }));
    try {
      const data = await call<OAuthDiscoveryData>(
        api.POST('/api/options/oauth2/discover', { body: { url } }),
      );
      const current = providers[index];
      updateAt(index, {
        discovery_url: url,
        authorize_url: data.authorize_url,
        token_url: data.token_url,
        userinfo_url: data.userinfo_url,
        scope: data.scope || current?.scope || '',
        map_username: data.map_username || current?.map_username || 'sub',
        map_email: data.map_email || current?.map_email || 'email',
      });
      setDiscoveryInputs((prev) => ({ ...prev, [index]: url }));
      setDiscoveryNotes((prev) => ({ ...prev, [index]: data.warnings.join('；') }));
      // A document without userinfo_endpoint stays expanded so it can be filled in.
      setCollapsed((prev) => ({ ...prev, [index]: Boolean(data.userinfo_url) }));
    } catch (e) {
      setDiscoveryErrors((prev) => ({ ...prev, [index]: errMessage(e) }));
    } finally {
      setDiscoveryBusy(null);
    }
  }

  function openAdvanced() {
    setAdvancedText(JSON.stringify(JSON.parse(serializeProviderDrafts(providers)), null, 2));
    setAdvancedError('');
    setAdvancedOpen(true);
  }

  function applyAdvanced() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(advancedText || '[]');
    } catch {
      setAdvancedError('JSON 语法错误，请修正后再应用');
      return;
    }
    if (!Array.isArray(parsed)) {
      setAdvancedError('顶层必须是 JSON 数组');
      return;
    }
    const next = parseProviderDrafts(JSON.stringify(parsed));
    setAdvancedError('');
    emit(next);
  }

  return (
    <div className="oauth-form">
      {invalid && (
        <div aria-live="polite">
          <Alert tone="error">配置未通过校验，修正后才能保存：共 {issues.length} 处问题。</Alert>
        </div>
      )}

      {providers.length === 0 && (
        <p className="saved-note" style={{ marginBottom: 16 }}>尚未配置任何 OAuth2 提供方。</p>
      )}

      {providers.map((p, i) => {
        const errId = issuesFor(issues, i, 'id');
        const errAuthorize = issuesFor(issues, i, 'authorize_url');
        const errToken = issuesFor(issues, i, 'token_url');
        const errUserinfo = issuesFor(issues, i, 'userinfo_url');
        const errClientId = issuesFor(issues, i, 'client_id');
        const errMapUser = issuesFor(issues, i, 'map_username');
        const errDiscovery = issuesFor(issues, i, 'discovery_url');
        const isCollapsed = collapsed[i] ?? Boolean(
          p.discovery_url.trim() && p.authorize_url && p.token_url && p.userinfo_url,
        );
        const heading = p.display_name.trim() || p.id.trim() || '未命名提供方';
        return (
          <div className="oauth-provider" key={i}>
            <div className="oauth-provider-head">
              <div className="oauth-provider-title">
                <strong>{heading}</strong>
                <span className={`badge ${p.has_secret ? 'badge-success' : 'badge-neutral'}`}>
                  <span className="dot" />
                  {p.has_secret ? '已配置' : '未配置'}
                </span>
              </div>
              {confirmIndex === i ? (
                <div className="oauth-delete-confirm">
                  <span>删除该提供方？其 secret 将一并丢弃。</span>
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => removeAt(i)}>
                    删除
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmIndex(null)}>
                    取消
                  </button>
                </div>
              ) : (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmIndex(i)}>
                  删除
                </button>
              )}
            </div>

            <div className="oauth-group">
              <div className="oauth-group-label">基本信息</div>
              <div className="form-grid">
                <TextField
                  id={`oauth-id-${i}`}
                  label={FIELD_LABELS.id}
                  value={p.id}
                  required
                  error={errId}
                  onChange={(v) => updateAt(i, { id: v })}
                />
                <TextField
                  id={`oauth-name-${i}`}
                  label={FIELD_LABELS.display_name}
                  value={p.display_name}
                  onChange={(v) => updateAt(i, { display_name: v })}
                />
              </div>
            </div>

            <div className="oauth-group">
              <div className="oauth-group-label">端点</div>
              <div className="discovery-row">
                <div className="field">
                  <label className="field-label" htmlFor={`oauth-discovery-${i}`}>
                    发现端点（OIDC）
                  </label>
                  <input
                    id={`oauth-discovery-${i}`}
                    className="input"
                    value={discoveryInputs[i] ?? p.discovery_url}
                    placeholder="https://sso.example.com（自动补全 .well-known）"
                    onChange={(e) => {
                      const v = e.target.value;
                      setDiscoveryInputs((prev) => ({ ...prev, [i]: v }));
                    }}
                  />
                </div>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={discoveryBusy === i || !(discoveryInputs[i] ?? p.discovery_url).trim()}
                  onClick={() => runDiscovery(i, p.discovery_url)}
                >
                  {discoveryBusy === i ? '获取中…' : '获取端点'}
                </button>
              </div>
              {errDiscovery && <div className="error-text">{errDiscovery}</div>}
              {discoveryErrors[i] && <div className="error-text">{discoveryErrors[i]}</div>}
              {discoveryNotes[i] && <div className="field-help">{discoveryNotes[i]}</div>}
              {isCollapsed ? (
                <div className="discovery-summary">
                  <span className="badge badge-success">
                    <span className="dot" />
                    已填充
                  </span>
                  <span className="discovery-summary-host">{hostOf(p.authorize_url)}</span>
                  <span className="discovery-summary-meta">授权 / Token / 用户信息</span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setCollapsed((prev) => ({ ...prev, [i]: false }))}
                  >
                    展开修改
                  </button>
                </div>
              ) : (
                <>
                  <TextField
                    id={`oauth-authorize-${i}`}
                    label={FIELD_LABELS.authorize_url}
                    value={p.authorize_url}
                    required
                    error={errAuthorize}
                    onChange={(v) => updateAt(i, { authorize_url: v })}
                  />
                  <TextField
                    id={`oauth-token-${i}`}
                    label={FIELD_LABELS.token_url}
                    value={p.token_url}
                    required
                    error={errToken}
                    onChange={(v) => updateAt(i, { token_url: v })}
                  />
                  <TextField
                    id={`oauth-userinfo-${i}`}
                    label={FIELD_LABELS.userinfo_url}
                    value={p.userinfo_url}
                    required
                    error={errUserinfo}
                    onChange={(v) => updateAt(i, { userinfo_url: v })}
                  />
                  {p.discovery_url.trim() && p.authorize_url && p.token_url && p.userinfo_url && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setCollapsed((prev) => ({ ...prev, [i]: true }))}
                    >
                      收起端点
                    </button>
                  )}
                </>
              )}
            </div>

            <div className="oauth-group">
              <div className="oauth-group-label">凭据</div>
              <div className="form-grid">
                <TextField
                  id={`oauth-clientid-${i}`}
                  label={FIELD_LABELS.client_id}
                  value={p.client_id}
                  required
                  error={errClientId}
                  onChange={(v) => updateAt(i, { client_id: v })}
                />
                <TextField
                  id={`oauth-secret-${i}`}
                  label={FIELD_LABELS.client_secret}
                  type="password"
                  value={p.client_secret}
                  placeholder={p.has_secret ? '已配置（留空保持不变）' : '请输入 client_secret'}
                  onChange={(v) => updateAt(i, { client_secret: v })}
                />
              </div>
            </div>

            <div className="oauth-group">
              <div className="oauth-group-label">映射</div>
              <div className="form-grid">
                <TextField
                  id={`oauth-scope-${i}`}
                  label={FIELD_LABELS.scope}
                  value={p.scope}
                  onChange={(v) => updateAt(i, { scope: v })}
                />
                <TextField
                  id={`oauth-mapuser-${i}`}
                  label={FIELD_LABELS.map_username}
                  value={p.map_username}
                  required
                  error={errMapUser}
                  onChange={(v) => updateAt(i, { map_username: v })}
                />
                <TextField
                  id={`oauth-mapemail-${i}`}
                  label={FIELD_LABELS.map_email}
                  value={p.map_email}
                  onChange={(v) => updateAt(i, { map_email: v })}
                />
              </div>
            </div>
          </div>
        );
      })}

      <div className="oauth-add">
        <select className="select" value={addKind} onChange={(e) => setAddKind(e.target.value as 'github' | 'custom')} aria-label="新增提供方类型">
          <option value="github">GitHub 预设</option>
          <option value="custom">自定义提供方</option>
        </select>
        <button type="button" className="btn" onClick={addProvider}>
          添加提供方
        </button>
      </div>

      <details
        className="oauth-advanced"
        open={advancedOpen}
        onToggle={(e) => {
          const open = (e.target as HTMLDetailsElement).open;
          if (open && !advancedOpen) openAdvanced();
          else if (!open) setAdvancedOpen(false);
        }}
      >
        <summary>高级 JSON（排障用）</summary>
        <p className="saved-note">
          这里显示将提交给 <code>OAuth2Providers</code> 的实际 JSON（不含已保存的 secret）。小心编辑后可点击「应用 JSON」。
        </p>
        <textarea
          className="textarea"
          rows={8}
          value={advancedText}
          onChange={(e) => setAdvancedText(e.target.value)}
          spellCheck={false}
        />
        {advancedError && <div className="error-text" aria-live="polite">{advancedError}</div>}
        <div style={{ marginTop: 8 }}>
          <button type="button" className="btn btn-sm" onClick={applyAdvanced}>
            应用 JSON
          </button>
        </div>
      </details>
    </div>
  );
}
