import { useState } from 'react';
import { api, call } from '@/api/client';
import { errMessage } from '@/lib/errors';
import { toast } from '@/stores/ui';
import { useConfirm } from '@/components/ui/Modal';
import type { MeSecurityData } from '@nectarpush/shared';

/**
 * D-03 多绑：列出当前用户全部第三方绑定，可逐条解绑；尚未绑定的提供方仍可继续绑定。
 * The bind step is a full-page redirect into the OAuth authorization endpoint,
 * so it stays a plain <a>.
 */
export function OAuthBindingSection({
  data,
  onChanged,
}: {
  data?: MeSecurityData;
  onChanged: () => void;
}) {
  const confirm = useConfirm();
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState('');

  if (!data) return <p className="saved-note">正在读取绑定状态…</p>;

  const { bindings, providers } = data.oauth;
  const boundIds = new Set(bindings.map((b) => b.provider));
  const unbound = providers.filter((p) => !boundIds.has(p.id));
  const provider =
    selected && unbound.some((p) => p.id === selected) ? selected : unbound[0]?.id || '';

  async function unbind(providerId: string, displayName: string) {
    const ok = await confirm({
      title: '解绑第三方账号',
      message: `确定解绑 ${displayName} 吗？解绑后该第三方账号将无法用于登录。`,
      confirmText: '解绑',
      danger: true,
    });
    if (!ok) return;
    setBusy(providerId);
    try {
      await call(
        api.DELETE('/api/me/oauth/{provider}', { params: { path: { provider: providerId } } }),
      );
      toast.success('已解绑第三方账号');
      onChanged();
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy('');
    }
  }

  if (providers.length === 0 && bindings.length === 0) {
    return (
      <div className="setting-row">
        <div className="setting-label">
          <h3>尚未绑定</h3>
          <p>管理员尚未配置 OAuth2 提供方；配置后即可在此绑定第三方账号。</p>
        </div>
      </div>
    );
  }

  const rows = [];

  // 已绑定的提供方：逐条列出，可单独解绑。
  for (const b of bindings) {
    const name = providers.find((p) => p.id === b.provider)?.display_name ?? b.display_name;
    rows.push(
      <div className="setting-row" key={`bound-${b.provider}`}>
        <div className="setting-label">
          <h3>{name}</h3>
          <p>已绑定 · 标识 {b.oauth_id}</p>
          {!data.has_password && (
            <p className="field-help">当前账号尚未设置密码，请先在「设置密码」中设置后再解绑。</p>
          )}
        </div>
        <div className="setting-control oauth-bind-control">
          <span className="badge badge-success">
            <span className="dot" />
            已绑定
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy === b.provider || !data.has_password}
            title={data.has_password ? undefined : '请先设置登录密码'}
            onClick={() => unbind(b.provider, name)}
          >
            {busy === b.provider ? '解绑中…' : '解绑'}
          </button>
        </div>
      </div>,
    );
  }

  // 仍有未绑定的提供方 → 提供继续绑定入口。
  if (unbound.length > 0) {
    rows.push(
      <div className="setting-row" key="bind-new">
        <div className="setting-label">
          <h3>{bindings.length > 0 ? '绑定更多第三方账号' : '绑定第三方账号'}</h3>
          <p>绑定后可用该账号一键登录；不会改变现有邮箱与通道。</p>
        </div>
        <div className="setting-control oauth-bind-control">
          <select
            className="select"
            aria-label="选择 OAuth2 提供方"
            value={provider}
            onChange={(e) => setSelected(e.target.value)}
          >
            {unbound.map((p) => (
              <option key={p.id} value={p.id}>
                {p.display_name}
              </option>
            ))}
          </select>
          <a className="btn btn-primary btn-sm" href={`/api/me/oauth/${encodeURIComponent(provider)}/start`}>
            绑定
          </a>
        </div>
      </div>,
    );
  }

  return <>{rows}</>;
}
