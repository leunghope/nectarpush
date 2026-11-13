import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, call } from '@/api/client';
import { errMessage } from '@/lib/errors';
import { useDocumentTitle } from '@/hooks/misc';
import { toast } from '@/stores/ui';
import type { Option, OptionListData, VersionData } from '@nectarpush/shared';
import { PageHead, Alert, SkeletonRows } from '@/components/ui/Feedback';
import { SettingsLayout, SettingsSection, type SettingsNavItem } from '@/components/layout/SettingsLayout';

const LABELS: Record<string, string> = {
  Notice: '公告内容',
  About: '关于内容',
  Footer: '页脚',
  HomePageLink: '首页链接',
};

const HINTS: Record<string, string> = {
  Notice: '显示在工作台顶部公告条，留空则不显示；支持 Markdown',
  About: '「关于」页面正文，支持 Markdown；留空则显示空态',
  Footer: '公共页脚文本，支持 Markdown',
  HomePageLink: '页脚「关于」与导航链接的跳转地址',
};

const SECTIONS: SettingsNavItem[] = [
  { id: 'announcement', label: '站点公告' },
  { id: 'about', label: '关于页面' },
  { id: 'footer', label: '页脚' },
  { id: 'home', label: '首页链接' },
];

export function OtherSettingsPage() {
  useDocumentTitle('其他设置');
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const optionsQ = useQuery({
    queryKey: ['options'],
    queryFn: () => call<OptionListData>(api.GET('/api/options')),
  });
  const versionQ = useQuery({
    queryKey: ['version'],
    queryFn: () => call<VersionData>(api.GET('/api/version')),
    staleTime: 5 * 60_000,
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

  function change(key: string, value: string) {
    setDraft((d) => ({ ...d, [key]: value }));
    setDirty((prev) => new Set(prev).add(key));
  }

  async function saveAll() {
    setError('');
    setSaving(true);
    try {
      for (const key of Array.from(dirty)) {
        await call(api.PATCH('/api/options', { body: { key, value: draft[key] ?? '' } }));
      }
      toast.success('其他设置已保存');
      setDirty(new Set());
      qc.invalidateQueries({ queryKey: ['options'] });
      qc.invalidateQueries({ queryKey: ['public-about'] });
      qc.invalidateQueries({ queryKey: ['public-announcement'] });
      qc.invalidateQueries({ queryKey: ['public-footer'] });
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function textarea(key: string, rows = 4, placeholder = '') {
    const opt = map[key];
    if (!opt) return null;
    return (
      <>
        <div className="row-gap" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
          <span className="field-label">{LABELS[key]}</span>
          <span className="badge badge-neutral">{opt.value ? '已填写' : '空'}</span>
        </div>
        <textarea className="textarea" rows={rows} value={draft[key] ?? ''} onChange={(e) => change(key, e.target.value)} placeholder={placeholder} />
        <p className="field-help">{HINTS[key]}</p>
      </>
    );
  }

  return (
    <>
      <PageHead eyebrow="Admin / Other" title="其他设置" description="公告、关于、页脚与首页链接" />
      <SettingsLayout sections={SECTIONS}>
        {optionsQ.isError ? (
          <Alert tone="error">加载失败：{errMessage(optionsQ.error)}</Alert>
        ) : optionsQ.isLoading ? (
          <div className="panel"><div className="panel-body"><SkeletonRows rows={6} /></div></div>
        ) : (
          <>
            {error && <Alert tone="error">{error}</Alert>}

            <SettingsSection id="announcement" title="站点公告" description="显示在工作台顶部，留空则不显示">
              {textarea('Notice', 3, '例如：本周日 02:00–04:00 进行系统维护。')}
            </SettingsSection>

            <SettingsSection id="about" title="关于页面" description="公开 /about 页面的正文内容">
              <div className="kv" style={{ marginBottom: 12 }}>
                <div className="kv-row"><dt>版本</dt><dd className="mono">{versionQ.data?.version ?? '—'}</dd></div>
                <div className="kv-row"><dt>关于页</dt><dd><a className="text-link" href="/about">/about</a></dd></div>
              </div>
              {textarea('About', 6, '介绍这个站点的用途与设计原则。')}
            </SettingsSection>

            <SettingsSection id="footer" title="页脚" description="公共页面底部的版权与备案信息">
              {textarea('Footer', 3, '例如：© 2026 NectarPush · 保留所有权利。')}
            </SettingsSection>

            <SettingsSection id="home" title="首页链接" description="站点首页与外部入口">
              {map.HomePageLink && (
                <>
                  <div className="field-label" style={{ display: 'block', marginBottom: 6 }}>{LABELS.HomePageLink}</div>
                  <input
                    className="input"
                    value={draft.HomePageLink ?? ''}
                    onChange={(e) => change('HomePageLink', e.target.value)}
                    placeholder="https://example.com"
                  />
                  <p className="field-help">{HINTS.HomePageLink}</p>
                </>
              )}
              <div className="kv" style={{ marginTop: 12 }}>
                <div className="kv-row"><dt>API 文档</dt><dd><a className="text-link" href="/docs" target="_blank" rel="noreferrer">/docs</a></dd></div>
                <div className="kv-row"><dt>健康检查</dt><dd className="mono">/api/health</dd></div>
              </div>
            </SettingsSection>

            <div className="section-actions">
              <button className="btn btn-primary" onClick={saveAll} disabled={saving || dirty.size === 0}>
                {saving ? '保存中…' : '保存其他设置'}
              </button>
              <span className="saved-note">{dirty.size > 0 ? `${dirty.size} 项未保存` : '更改即时生效'}</span>
            </div>
          </>
        )}
      </SettingsLayout>
    </>
  );
}