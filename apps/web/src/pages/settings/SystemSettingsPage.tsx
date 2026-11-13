import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, call } from '@/api/client';
import { errMessage } from '@/lib/errors';
import { useDocumentTitle } from '@/hooks/misc';
import { toast } from '@/stores/ui';
import type { Option, OptionListData } from '@nectarpush/shared';
import { PageHead, Alert, SkeletonRows } from '@/components/ui/Feedback';
import { Switch } from '@/components/ui/Field';
import { SettingsLayout, SettingsSection, SettingRow, type SettingsNavItem } from '@/components/layout/SettingsLayout';
import { OAuthProvidersForm } from './OAuthProvidersForm';
import { parseProviderDrafts, validateProviderDrafts } from './oauthProviders';

const LABELS: Record<string, string> = {
  SystemName: '站点名称',
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
  SystemName: '显示在页面标题与品牌处',
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
  { id: 'general', title: '通用', description: '站点名称、服务器地址与外部链接。', keys: ['SystemName', 'ServerAddress'] },
  { id: 'auth', title: '注册与登录', description: '控制账户注册与登录方式。', keys: ['RegisterEnabled', 'PasswordLoginEnabled', 'EmailVerificationEnabled'] },
  { id: 'smtp', title: '邮件 SMTP', description: '用于发送验证码与重置密码邮件。', keys: ['SMTPServer', 'SMTPAccount', 'SMTPPort', 'SMTPToken'] },
  { id: 'oauth', title: 'OAuth2', description: '配置第三方授权登录提供方。', keys: ['OAuth2Providers'] },
  { id: 'turnstile', title: 'Turnstile', description: 'Cloudflare Turnstile 校验配置。', keys: ['TurnstileCheckEnabled', 'TurnstileSiteKey', 'TurnstileSecretKey'] },
  { id: 'render', title: '消息与渲染', description: '控制消息持久化与公开渲染页。', keys: ['MessagePersistenceEnabled', 'MessageRenderEnabled'] },
];

const SECTIONS: SettingsNavItem[] = GROUPS.map((g) => ({ id: g.id, label: g.title }));

export function SystemSettingsPage() {
  useDocumentTitle('系统设置');
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const optionsQ = useQuery({
    queryKey: ['options'],
    queryFn: () => call<OptionListData>(api.GET('/api/options')),
  });

  useEffect(() => {
    if (optionsQ.data) {
      const d: Record<string, string> = {};
      for (const o of optionsQ.data.items) d[o.key] = o.value ?? '';
      setDraft(d);
      setDirty(new Set());
    }
  }, [optionsQ.data]);

  const map = useMemo(() => {
    const m: Record<string, Option> = {};
    for (const o of optionsQ.data?.items ?? []) m[o.key] = o;
    return m;
  }, [optionsQ.data]);

  // Stage 9 (design §5.2): live-validate the OAuth2 provider form so an invalid
  // config disables "save all" instead of hitting the API's 422.
  const oauthInvalid = useMemo(
    () => validateProviderDrafts(parseProviderDrafts(draft['OAuth2Providers'] ?? '[]')).length > 0,
    [draft],
  );

  function change(key: string, value: string) {
    setDraft((d) => ({ ...d, [key]: value }));
    setDirty((prev) => new Set(prev).add(key));
  }

  async function saveAll() {
    setError('');
    if (dirty.has('OAuth2Providers')) {
      const issues = validateProviderDrafts(parseProviderDrafts(draft['OAuth2Providers'] ?? '[]'));
      if (issues.length > 0) {
        setError('OAuth2 提供方配置未通过校验，请先修正表单中的错误');
        return;
      }
    }
    setSaving(true);
    try {
      for (const key of Array.from(dirty)) {
        const opt = map[key];
        if (!opt) continue;
        const value = draft[key] ?? '';
        if (opt.sensitive && opt.configured && value.trim() === '') continue;
        await call(api.PATCH('/api/options', { body: { key, value } }));
      }
      toast.success('全部设置已保存');
      setDirty(new Set());
      qc.invalidateQueries({ queryKey: ['options'] });
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
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
      <SettingsLayout sections={SECTIONS}>
        {optionsQ.isError ? (
          <Alert tone="error">加载失败：{errMessage(optionsQ.error)}</Alert>
        ) : optionsQ.isLoading ? (
          <div className="panel"><div className="panel-body"><SkeletonRows rows={10} /></div></div>
        ) : (
          <>
            {error && <Alert tone="error">{error}</Alert>}
            {GROUPS.map((g) => (
              <SettingsSection key={g.id} id={g.id} title={g.title} description={g.description}>
                {g.id === 'oauth' ? (
                  <OAuthProvidersForm
                    value={draft['OAuth2Providers'] ?? '[]'}
                    onChange={(v) => change('OAuth2Providers', v)}
                  />
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
            ))}
            <div className="section-actions">
              <button className="btn btn-primary" onClick={saveAll} disabled={saving || dirty.size === 0 || oauthInvalid}>
                {saving ? '保存中…' : '保存全部设置'}
              </button>
              <span className="saved-note">{dirty.size > 0 ? `${dirty.size} 项未保存` : '所有更改将记录审计日志'}</span>
            </div>
          </>
        )}
      </SettingsLayout>
    </>
  );
}
