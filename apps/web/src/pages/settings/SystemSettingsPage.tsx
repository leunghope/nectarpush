import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, call } from '@/api/client';
import { errMessage } from '@/lib/errors';
import { useDocumentTitle } from '@/hooks/misc';
import { toast } from '@/stores/ui';
import type { OAuth2CallbackBaseData, Option, OptionListData, UpdateCheckData, VersionData } from '@nectarpush/shared';
import { PageHead, Alert, SkeletonRows } from '@/components/ui/Feedback';
import { Switch } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { SettingsLayout, SettingsSection, SettingRow, type SettingsNavItem } from '@/components/layout/SettingsLayout';
import { OAuthProvidersForm } from './OAuthProvidersForm';
import { parseProviderDrafts, readIconFile, validateProviderDrafts } from './oauthProviders';

const LABELS: Record<string, string> = {
  SystemName: '站点名称',
  SiteEnglishName: '站点英文名',
  SiteIcon: '站点图标',
  ServerAddress: '服务器地址',
  HomePageLink: '主页链接',
  RegisterEnabled: '开放注册',
  PasswordLoginEnabled: '密码登录',
  EmailVerificationEnabled: '邮箱验证',
  SMTPServer: 'SMTP 服务器',
  SMTPAccount: 'SMTP 账号',
  SMTPPort: 'SMTP 端口',
  SMTPToken: 'SMTP 令牌',
  OAuth2Providers: 'OAuth2 提供方',
  TurnstileCheckEnabled: '人机验证',
  TurnstileSiteKey: 'Turnstile Site Key',
  TurnstileSecretKey: 'Turnstile Secret Key',
  MessagePersistenceEnabled: '消息持久化',
  MessageRenderEnabled: '消息渲染页',
};

const HINTS: Record<string, string> = {
  SystemName: '显示在页面标题、品牌与登录页',
  SiteEnglishName: '品牌字标与页脚使用的英文名',
  SiteIcon: '上传后替换品牌图标与浏览器标签页图标',
  ServerAddress: '用于生成邮件链接与推送地址',
  HomePageLink: '页脚「关于」跳转地址',
  RegisterEnabled: '关闭后注册接口返回 403',
  PasswordLoginEnabled: '关闭后仅允许 OAuth 登录',
  EmailVerificationEnabled: '仅控制注册验证码；配置 SMTP 后修改邮箱仍需验证码',
  SMTPPort: '常用 465 / 587',
  SMTPToken: '敏感项，留空保持不变',
  OAuth2Providers: '卡片式管理第三方登录提供方；client_secret 不回显，留空保持不变',
  TurnstileCheckEnabled: '开启需先填写 Site Key 与 Secret Key',
  TurnstileSiteKey: '来自 Cloudflare Turnstile 控制台',
  TurnstileSecretKey: '敏感项，留空保持不变',
  MessagePersistenceEnabled: '关闭后消息不落库',
  MessageRenderEnabled: '允许公开正文页访问',
};

const BOOLEAN_KEYS = new Set([
  'RegisterEnabled',
  'PasswordLoginEnabled',
  'EmailVerificationEnabled',
  'TurnstileCheckEnabled',
  'MessagePersistenceEnabled',
  'MessageRenderEnabled',
]);
const TEXTAREA_KEYS = new Set(['OAuth2Providers']);
const NUMBER_KEYS = new Set(['SMTPPort']);

type Group = { id: string; title: string; description: string; keys: string[] };

const GROUPS: Group[] = [
  { id: 'general', title: '通用', description: '站点名称、英文名、图标、服务器地址与外部链接。', keys: ['SystemName', 'SiteEnglishName', 'SiteIcon', 'ServerAddress'] },
  { id: 'auth', title: '注册与登录', description: '控制账户注册与登录方式。', keys: ['RegisterEnabled', 'PasswordLoginEnabled', 'EmailVerificationEnabled'] },
  { id: 'smtp', title: '邮件 SMTP', description: '用于发送验证码与重置密码邮件。', keys: ['SMTPServer', 'SMTPAccount', 'SMTPPort', 'SMTPToken'] },
  { id: 'oauth', title: 'OAuth2', description: '配置第三方授权登录提供方。', keys: ['OAuth2Providers'] },
  { id: 'turnstile', title: 'Turnstile', description: 'Cloudflare Turnstile 校验配置。', keys: ['TurnstileCheckEnabled', 'TurnstileSiteKey', 'TurnstileSecretKey'] },
  { id: 'render', title: '消息与渲染', description: '控制消息持久化与公开渲染页。', keys: ['MessagePersistenceEnabled', 'MessageRenderEnabled'] },
  { id: 'update', title: '版本更新', description: '手动检查是否有新版本可用。', keys: [] },
];

const SECTIONS: SettingsNavItem[] = GROUPS.map((g) => ({ id: g.id, label: g.title }));

export function SystemSettingsPage() {
  useDocumentTitle('系统设置');
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [baseline, setBaseline] = useState<Record<string, string>>({});
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set(GROUPS.map((g) => g.id)));
  const [savingId, setSavingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Baseline is mirrored in a ref so the refresh effect can tell "untouched" from
  // "edited but not saved yet" without depending on its own state.
  const baselineRef = useRef<Record<string, string>>({});

  const optionsQ = useQuery({
    queryKey: ['options'],
    queryFn: () => call<OptionListData>(api.GET('/api/options')),
  });

  // 回调基址以服务端为准（服务器地址优先），前端不自行拼 window.location.origin。
  const callbackBaseQ = useQuery({
    queryKey: ['options', 'oauth2-callback'],
    queryFn: () => call<OAuth2CallbackBaseData>(api.GET('/api/options/oauth2/callback')),
  });

  // 服务端数据刷新时，只同步「未被改动」的键：保存 A 模块不会冲掉 B 模块未保存的编辑。
  useEffect(() => {
    if (!optionsQ.data) return;
    const server: Record<string, string> = {};
    for (const o of optionsQ.data.items) server[o.key] = o.value ?? '';
    const prevBaseline = baselineRef.current;
    baselineRef.current = server;
    setBaseline(server);
    setDraft((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(server)) {
        const touched = prev[key] !== undefined && prev[key] !== (prevBaseline[key] ?? '');
        if (!touched) next[key] = server[key];
      }
      return next;
    });
  }, [optionsQ.data]);

  const map = useMemo(() => {
    const m: Record<string, Option> = {};
    for (const o of optionsQ.data?.items ?? []) m[o.key] = o;
    return m;
  }, [optionsQ.data]);

  // Stage 9 (design §5.2): live-validate the OAuth2 provider form so an invalid
  // config blocks saving that module instead of hitting the API's 422.
  const oauthIssues = useMemo(
    () => validateProviderDrafts(parseProviderDrafts(draft['OAuth2Providers'] ?? '[]')),
    [draft],
  );

  const changedKeys = (g: Group) => g.keys.filter((k) => (draft[k] ?? '') !== (baseline[k] ?? ''));
  const isDirty = (g: Group) => changedKeys(g).length > 0;

  function change(key: string, value: string) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function toggleSection(id: string) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function saveModule(g: Group) {
    setErrors((e) => ({ ...e, [g.id]: '' }));
    if (g.id === 'oauth' && oauthIssues.length > 0) {
      setErrors((e) => ({ ...e, oauth: 'OAuth2 提供方配置未通过校验，请先修正表单中的错误' }));
      setOpenIds((prev) => new Set(prev).add('oauth'));
      return;
    }
    const keys = changedKeys(g);
    if (keys.length === 0) return;
    setSavingId(g.id);
    try {
      for (const key of keys) {
        const opt = map[key];
        if (!opt) continue;
        const value = draft[key] ?? '';
        if (opt.sensitive && opt.configured && value.trim() === '') continue;
        await call(api.PATCH('/api/options', { body: { key, value } }));
      }
      // 立即推进基线，避免刷新窗口期内按钮仍然可点
      const committed: Record<string, string> = {};
      for (const key of keys) committed[key] = draft[key] ?? '';
      baselineRef.current = { ...baselineRef.current, ...committed };
      setBaseline((b) => ({ ...b, ...committed }));
      toast.success(`已保存：${g.title}`);
      qc.invalidateQueries({ queryKey: ['options'] });
      qc.invalidateQueries({ queryKey: ['public-branding'] });
    } catch (err) {
      setErrors((e) => ({ ...e, [g.id]: errMessage(err) }));
    } finally {
      setSavingId(null);
    }
  }

  function control(o: Option) {
    const key = o.key;
    const value = draft[key] ?? '';
    if (BOOLEAN_KEYS.has(key)) {
      // AC-068: a masked/empty value must never be rendered as "off". The API
      // echoes booleans verbatim since Q-05; this branch keeps older/masked
      // payloads honest instead of showing a false "关闭".
      const masked = o.sensitive && o.configured && value === '';
      return (
        <Switch
          checked={value === 'true'}
          disabled={masked}
          onChange={(b) => change(key, b ? 'true' : 'false')}
          label={masked ? '已配置（未回显）' : value === 'true' ? '开启' : '关闭'}
        />
      );
    }
    if (key === 'SiteIcon') {
      return (
        <div className="site-icon-control">
          <span className="site-icon-preview" aria-hidden="true">
            {value ? <img src={value} alt="" /> : <Icon name="grid" className="icon" />}
          </span>
          <label className="btn btn-sm">
            {value ? '更换图标' : '上传图标'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                void readIconFile(file)
                  .then((url) => change('SiteIcon', url))
                  .catch((err) => toast.error(errMessage(err)));
              }}
            />
          </label>
          {value && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => change('SiteIcon', '')}>
              移除
            </button>
          )}
        </div>
      );
    }
    if (TEXTAREA_KEYS.has(key)) {
      return <textarea className="textarea" rows={3} value={value} onChange={(e) => change(key, e.target.value)} placeholder={o.sensitive && o.configured ? '已配置（留空保持不变）' : ''} />;
    }
    if (o.sensitive) {
      return <input type="password" className="input" value={value} onChange={(e) => change(key, e.target.value)} placeholder={o.configured ? '已配置（留空保持不变）' : ''} autoComplete="new-password" />;
    }
    if (NUMBER_KEYS.has(key)) {
      return <input type="number" className="input" value={value} onChange={(e) => change(key, e.target.value)} />;
    }
    return <input className="input" value={value} onChange={(e) => change(key, e.target.value)} />;
  }

  return (
    <>
      <PageHead eyebrow="Admin / System" title="系统设置" description="站点、注册、邮件、OAuth2 与渲染策略" />
      <SettingsLayout
        sections={SECTIONS}
        onNavigate={(id) => setOpenIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))}
      >
        {optionsQ.isError ? (
          <Alert tone="error">加载失败：{errMessage(optionsQ.error)}</Alert>
        ) : optionsQ.isLoading ? (
          <div className="panel"><div className="panel-body"><SkeletonRows rows={10} /></div></div>
        ) : (
          GROUPS.map((g) => {
            const dirty = isDirty(g);
            const count = changedKeys(g).length;
            const saving = savingId === g.id;
            const canSave = g.keys.length > 0;
            return (
              <SettingsSection
                key={g.id}
                id={g.id}
                title={g.title}
                description={g.description}
                collapsible
                open={openIds.has(g.id)}
                onToggle={() => toggleSection(g.id)}
                badge={dirty ? <span className="section-dirty-dot" aria-label="有未保存的改动" /> : undefined}
                actions={
                  canSave ? (
                    <>
                      <span className="section-status">{dirty ? `${count} 项未保存` : '当前已是最新'}</span>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        data-testid={`settings-save-${g.id}`}
                        onClick={() => void saveModule(g)}
                        disabled={!dirty || saving}
                      >
                        {saving ? '保存中…' : '保存本模块'}
                      </button>
                    </>
                  ) : undefined
                }
              >
                {errors[g.id] ? <div className="section-error">{errors[g.id]}</div> : null}
                {g.id === 'oauth' ? (
                  <OAuthProvidersForm
                    value={draft['OAuth2Providers'] ?? '[]'}
                    onChange={(v) => change('OAuth2Providers', v)}
                    callbackBase={callbackBaseQ.data}
                  />
                ) : g.id === 'update' ? (
                  <UpdateSection />
                ) : (
                  g.keys.map((key) => {
                    const opt = map[key];
                    if (!opt) return null;
                    return (
                      <SettingRow
                        key={key}
                        label={
                          <>
                            {LABELS[key] ?? key}
                            {opt.sensitive && (
                              <span className={`badge ${opt.configured ? 'badge-success' : 'badge-neutral'}`} style={{ marginLeft: 8 }}>
                                {opt.configured ? '已配置' : '未配置'}
                              </span>
                            )}
                          </>
                        }
                        description={HINTS[key]}
                      >
                        {control(opt)}
                      </SettingRow>
                    );
                  })
                )}
              </SettingsSection>
            );
          })
        )}
      </SettingsLayout>
    </>
  );
}


/** 手动检查更新：只在点击时请求，避免每次打开设置都打 GitHub。 */
function UpdateSection() {
  const [result, setResult] = useState<UpdateCheckData | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const versionQ = useQuery({
    queryKey: ['version'],
    queryFn: () => call<VersionData>(api.GET('/api/version')),
    staleTime: 5 * 60_000,
  });

  async function check() {
    setBusy(true);
    setError('');
    try {
      const data = await call<UpdateCheckData>(api.GET('/api/update/check', { params: { query: { force: true } } }));
      setResult(data);
    } catch (err) {
      setError(errMessage(err));
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="update-card">
      <div className="update-current">
        <span className="small muted">当前版本</span>
        <strong className="mono">{versionQ.data?.version ? `v${versionQ.data.version}` : '—'}</strong>
        {versionQ.data?.commit && <span className="small muted mono">{versionQ.data.commit.slice(0, 7)}</span>}
        <span className="spacer" />
        <button type="button" className="btn" onClick={check} disabled={busy}>
          <Icon name="refresh" className="icon-sm" />
          {busy ? '检查中…' : '检查更新'}
        </button>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {result && !result.update_available && (
        <Alert tone="success">已是最新版本（v{result.current_version}）。</Alert>
      )}
      {result && result.update_available && (
        <Alert tone="info">
          <div>
            发现新版本 <strong>v{result.latest_version}</strong>（当前 v{result.current_version}）。
          </div>
          <div className="row-inline" style={{ marginTop: 8 }}>
            {result.release_url && (
              <a className="btn btn-primary btn-sm" href={result.release_url} target="_blank" rel="noreferrer">
                查看更新说明 <Icon name="external" className="icon-sm" />
              </a>
            )}
            <span className="small muted">
              升级方法：拉取新镜像后重启容器（docker compose pull &amp;&amp; docker compose up -d）。
            </span>
          </div>
        </Alert>
      )}
    </div>
  );
}
