import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, callVoid } from '@/api/client';
import { queryClient } from '@/api/queryClient';
import { useAuthStore } from '@/stores/auth';
import { avatarInitial, USER_ROLE_LABEL } from '@/lib/format';
import { Icon } from '@/components/ui/Icon';

/** Topbar / mobile account dropdown with profile shortcuts and logout. */
export function AccountMenu({ variant = 'topbar' }: { variant?: 'topbar' | 'compact' }) {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function logout() {
    setBusy(true);
    try {
      await callVoid(api.POST('/api/auth/logout'));
    } catch {
      /* even if it fails, drop local session */
    } finally {
      queryClient.clear();
      useAuthStore.getState().markAnonymous();
      setBusy(false);
      setOpen(false);
      navigate('/login', { replace: true });
    }
  }

  return (
    <div className="account-menu-wrap" ref={wrapRef}>
      <button
        type="button"
        className="account-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="avatar" aria-hidden="true">
          {avatarInitial(user?.display_name || user?.username)}
        </span>
        {variant === 'topbar' && <span className="account-name">{user?.display_name || user?.username}</span>}
        {variant === 'topbar' && (
          <span className="account-caret">
            <Icon name="chevron-right" />
          </span>
        )}
      </button>
      <div className="account-menu" role="menu" hidden={!open}>
        <div style={{ padding: '8px 10px 6px' }}>
          <div className="user-name">{user?.display_name || user?.username}</div>
          <div className="user-role">{user ? USER_ROLE_LABEL[user.role] : ''} · @{user?.username}</div>
        </div>
        <div className="account-menu-sep" />
        <button type="button" className="account-menu-item" role="menuitem" onClick={() => { setOpen(false); navigate('/me'); }}>
          <Icon name="user" /> 个人设置
        </button>
        <button type="button" className="account-menu-item" role="menuitem" onClick={() => { setOpen(false); navigate('/me/push'); }}>
          <Icon name="send" /> 推送设置
        </button>
        <div className="account-menu-sep" />
        <button type="button" className="account-menu-item danger" role="menuitem" onClick={logout} disabled={busy}>
          <Icon name="logout" /> {busy ? '正在退出…' : '退出登录'}
        </button>
      </div>
    </div>
  );
}
