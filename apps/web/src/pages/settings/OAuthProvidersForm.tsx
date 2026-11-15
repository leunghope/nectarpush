import { useRef, useState } from 'react';
import type { OAuth2CallbackBaseData } from '@nectarpush/shared';
import { errMessage } from '@/lib/errors';
import { toast } from '@/stores/ui';
import { Field, Switch } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Alert } from '@/components/ui/Feedback';
import { CopyButton } from '@/components/ui/CopyButton';
import {
  GITHUB_PROVIDER_ID,
  githubProviderDraft,
  emptyProviderDraft,
  parseProviderDrafts,
  readIconFile,
  serializeProviderDrafts,
  validateProviderDrafts,
  type ProviderDraft,
  type ProviderIssue,
} from './oauthProviders';

function issuesFor(issues: ProviderIssue[], index: number, field: string): string | undefined {
  return issues.find((i) => i.index === index && i.field === field)?.message;
}

/**
 * OAuth2 提供方管理：GitHub 与自定义 OIDC 拆成独立配置块。
 * 每块是手风琴（可折叠），头部直接带启用开关；只暴露最少必填项。
 * 回调地址由服务端基址（服务器地址优先）拼出并逐块展示——用户要把它原样登记到第三方，
 * 地址一旦与服务端实际发出的 redirect_uri 不一致，第三方就会报 Redirect URI Error。
 */
export function OAuthProvidersForm({
  value,
  onChange,
  callbackBase,
}: {
  value: string;
  onChange: (v: string) => void;
  callbackBase?: OAuth2CallbackBaseData;
}) {
  const [providers, setProviders] = useState<ProviderDraft[]>(() => parseProviderDrafts(value));
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(parseProviderDrafts(value).filter((p) => !p.client_id || !p.has_secret).map((p) => p.id)),
  );
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const lastEmitted = useRef(value);

  // 外部值变化（例如首次加载 options）时同步进来；自己 emit 的改动不回灌。
  if (value !== lastEmitted.current) {
    const parsed = parseProviderDrafts(value);
    lastEmitted.current = value;
    setProviders(parsed);
  }

  const issues = validateProviderDrafts(providers);

  function emit(next: ProviderDraft[]) {
    const json = serializeProviderDrafts(next);
    lastEmitted.current = json;
    setProviders(next);
    onChange(json);
  }

  function update(index: number, patch: Partial<ProviderDraft>) {
    emit(providers.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }

  function expand(id: string) {
    setOpen((cur) => new Set(cur).add(id));
  }

  function toggle(id: string) {
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function add(kind: 'github' | 'custom') {
    if (kind === 'github' && providers.some((p) => p.id === GITHUB_PROVIDER_ID)) return;
    const draft = kind === 'github' ? githubProviderDraft() : emptyProviderDraft();
    emit([...providers, draft]);
    expand(draft.id);
  }

  function remove(index: number) {
    emit(providers.filter((_, i) => i !== index));
    setConfirmId(null);
  }

  async function pickIcon(index: number, file: File | undefined) {
    if (!file) return;
    try {
      const url = await readIconFile(file);
      update(index, { icon: url });
    } catch (err) {
      toast.error(errMessage(err));
    }
  }

  const hasGithub = providers.some((p) => p.id === GITHUB_PROVIDER_ID);
  // 服务端基址缺失时退回浏览器 origin，仅为不让界面空白；正常情况由设置页传入。
  const baseUrl = (callbackBase?.base_url || window.location.origin).replace(/\/+$/, '');
  const callbackFor = (id: string) => `${baseUrl}/api/auth/oauth/${encodeURIComponent(id)}/callback`;
  const baseIsFallback = callbackBase?.source === 'fallback';

  return (
    <div className="oauth-form">
      {baseIsFallback && (
        <Alert tone="warning">
          服务端没能确定对外访问地址，回调地址暂时按 <code>{baseUrl}</code> 生成。
          请先在「服务器地址」填入用户实际访问的地址（例如 <code>https://push.example.com</code>），
          否则第三方会以 redirect_uri 不匹配拒绝授权。
        </Alert>
      )}

      {providers.length === 0 && (
        <p className="small muted" style={{ marginBottom: 12 }}>
          尚未配置第三方登录。添加 GitHub 登录或自定义 OIDC 提供方后，登录页会出现对应入口。
        </p>
      )}

      {providers.map((p, index) => {
        const isGithub = p.id === GITHUB_PROVIDER_ID;
        const isOpen = open.has(p.id);
        const configured = Boolean(p.client_id) && (p.has_secret || Boolean(p.client_secret));
        return (
          <section key={p.id} className={`oauth-provider${isOpen ? ' is-open' : ''}`}>
            <div className="oauth-provider-head">
              <button
                type="button"
                className="oauth-provider-toggle"
                aria-expanded={isOpen}
                aria-controls={`oauth-panel-${p.id}`}
                onClick={() => toggle(p.id)}
              >
                <span className="oauth-provider-icon" aria-hidden="true">
                  {p.icon ? <img src={p.icon} alt="" /> : isGithub ? 'GH' : 'SSO'}
                </span>
                <span className="oauth-provider-meta">
                  <strong>{p.display_name || (isGithub ? 'GitHub' : '未命名提供方')}</strong>
                  <span className="oauth-provider-sub">
                    {isGithub ? 'GitHub 登录' : `自定义 OIDC · ${p.id}`} · {configured ? '已配置' : '未配置'}
                  </span>
                </span>
              </button>

              <div className="oauth-provider-actions">
                <span className="oauth-enable">
                  <span className="small muted">{p.enabled ? '启用' : '停用'}</span>
                  <Switch checked={p.enabled} onChange={(v) => update(index, { enabled: v })} label={`${p.display_name || '该提供方'}启用`} />
                </span>
                {confirmId === p.id ? (
                  <span className="oauth-delete-confirm">
                    确定删除？
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => remove(index)}>
                      删除
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmId(null)}>
                      取消
                    </button>
                  </span>
                ) : (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmId(p.id)} aria-label={`删除 ${p.display_name || '提供方'}`}>
                    <Icon name="trash" className="icon-sm" />
                  </button>
                )}
              </div>

              {/* 展开箭头单独放在行尾，靠最右并垂直居中；点击同样切换手风琴 */}
              <button
                type="button"
                className="oauth-provider-chevron"
                aria-expanded={isOpen}
                aria-controls={`oauth-panel-${p.id}`}
                aria-label={`${isOpen ? '收起' : '展开'} ${p.display_name || (isGithub ? 'GitHub' : '提供方')} 配置`}
                onClick={() => toggle(p.id)}
              >
                <Icon name="chevron-right" className={`icon-sm oauth-chevron${isOpen ? ' is-open' : ''}`} />
              </button>
            </div>

            {isOpen && (
              <div className="oauth-provider-body" id={`oauth-panel-${p.id}`}>
                <div className="oauth-group">
                  <div className="oauth-group-label">基本信息</div>
                  <Field label="显示名称" htmlFor={`oauth-${index}-name`} required error={issuesFor(issues, index, 'display_name')}>
                    <input
                      id={`oauth-${index}-name`}
                      className="input"
                      value={p.display_name}
                      onChange={(e) => update(index, { display_name: e.target.value })}
                      placeholder={isGithub ? 'GitHub' : '例如：公司 SSO'}
                    />
                  </Field>

                  {!isGithub && (
                    <Field label="图标" hint="可选，PNG / JPEG / GIF / WebP / SVG，≤ 220 KB">
                      <div className="oauth-icon-row">
                        <span className="oauth-icon-preview" aria-hidden="true">
                          {p.icon ? <img src={p.icon} alt="" /> : <Icon name="grid" className="icon" />}
                        </span>
                        <label className="btn btn-sm">
                          {p.icon ? '更换图标' : '上传图标'}
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                            hidden
                            onChange={(e) => {
                              void pickIcon(index, e.target.files?.[0]);
                              e.target.value = '';
                            }}
                          />
                        </label>
                        {p.icon && (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => update(index, { icon: '' })}>
                            移除
                          </button>
                        )}
                      </div>
                      {issuesFor(issues, index, 'icon') && <p className="form-error">{issuesFor(issues, index, 'icon')}</p>}
                    </Field>
                  )}

                  <Field label="Client ID" htmlFor={`oauth-${index}-cid`} required error={issuesFor(issues, index, 'client_id')}>
                    <input
                      id={`oauth-${index}-cid`}
                      className="input mono"
                      value={p.client_id}
                      onChange={(e) => update(index, { client_id: e.target.value })}
                      autoComplete="off"
                    />
                  </Field>

                  <Field
                    label="Client Secret"
                    htmlFor={`oauth-${index}-secret`}
                    required
                    error={issuesFor(issues, index, 'client_secret')}
                    hint={p.has_secret ? '已配置，留空保持不变' : undefined}
                  >
                    <input
                      id={`oauth-${index}-secret`}
                      className="input"
                      type="password"
                      value={p.client_secret}
                      onChange={(e) => update(index, { client_secret: e.target.value, has_secret: p.has_secret })}
                      placeholder={p.has_secret ? '********（已配置）' : ''}
                      autoComplete="new-password"
                    />
                  </Field>

                  {!isGithub && (
                    <Field
                      label="发现端点（OIDC）"
                      htmlFor={`oauth-${index}-discovery`}
                      required
                      error={issuesFor(issues, index, 'discovery_url')}
                      hint="保存时会自动获取授权、令牌与用户信息端点，无需手工填写"
                    >
                      <input
                        id={`oauth-${index}-discovery`}
                        className="input mono"
                        value={p.discovery_url}
                        onChange={(e) => update(index, { discovery_url: e.target.value })}
                        placeholder="https://sso.example.com/application/o/app/.well-known/openid-configuration"
                      />
                    </Field>
                  )}

                  <Field
                    label="回调地址"
                    hint={
                      isGithub
                        ? '在 GitHub OAuth App 的 Authorization callback URL 里原样登记'
                        : '在第三方应用（Authentik / Keycloak 等）的 Redirect URI 里原样登记'
                    }
                  >
                    <div className="oauth-callback-row">
                      <code className="oauth-callback">{callbackFor(p.id)}</code>
                      <CopyButton value={callbackFor(p.id)} showLabel={false} label="复制回调地址" />
                    </div>
                  </Field>
                </div>
              </div>
            )}
          </section>
        );
      })}

      <div className="oauth-add">
        <button type="button" className="btn" onClick={() => add('github')} disabled={hasGithub}>
          <Icon name="plus" className="icon-sm" /> 添加 GitHub 登录
        </button>
        <button type="button" className="btn" onClick={() => add('custom')} disabled={providers.length >= 20}>
          <Icon name="plus" className="icon-sm" /> 添加自定义提供方
        </button>
      </div>
      <p className="small muted">
        GitHub 登录只能添加一次；自定义提供方可添加多个。停用的提供方不会出现在登录页。
      </p>
    </div>
  );
}
