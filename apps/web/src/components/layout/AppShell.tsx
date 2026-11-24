import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, call } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { avatarInitial, ROLE_RANK, USER_ROLE_LABEL } from '@/lib/format';
import type { TextContentData, UserRole } from '@nectarpush/shared';
import { Brand, ThemeToggle } from '@/components/ui/Brand';
import { Icon, type IconName } from '@/components/ui/Icon';
import { AccountMenu } from './AccountMenu';
import { useSseContext } from './SseProvider';

type NavItem = { to: string; label: string; icon: IconName; end?: boolean; minRole?: UserRole };
type NavGroup = { label: string; items: NavItem[] };

const NAV: NavGroup[] = [
  {
    label: '工作',
    items: [
      { to: '/', label: '工作台', icon: 'grid', end: true },
      { to: '/messages', label: '消息', icon: 'list' },
    ],
  },
  {
    label: '连接',
    items: [
      { to: '/channels', label: '通道', icon: 'plug' },
      { to: '/webhooks', label: 'Webhook', icon: 'link' },
    ],
  },
  {
    label: '账户',
    items: [
      { to: '/me', label: '个人设置', icon: 'user', end: true },
      { to: '/me/push', label: '推送设置', icon: 'send' },
    ],
  },
  {
    label: '管理',
    items: [
      { to: '/users', label: '用户管理', icon: 'users', minRole: 'admin' },
      { to: '/settings', label: '系统设置', icon: 'settings', minRole: 'root', end: true },
      { to: '/settings/other', label: '其他设置', icon: 'inbox', minRole: 'admin' },
    ],
  },
];

const CRUMB_LABELS: Record<string, string> = {
  '': '工作台',
  messages: '消息',
  channels: '通道',
  webhooks: 'Webhook',
  users: '用户管理',
  settings: '系统设置',
  me: '个人设置',
  push: '推送设置',
  new: '新建',
  edit: '编辑',
  other: '其他设置',
};

function useCrumbs(pathname: string): { label: string; to?: string }[] {
  const segs = pathname.split('/').filter(Boolean);
  if (segs.length === 0) return [{ label: '工作台' }];
  const crumbs: { label: string; to?: string }[] = [];
  let acc = '';
  segs.forEach((seg, i) => {
    acc += `/${seg}`;
    if (i === segs.length - 1) {
      crumbs.push({ label: CRUMB_LABELS[seg] ?? '详情' });
    } else {
      crumbs.push({ label: CRUMB_LABELS[seg] ?? seg, to: acc });
    }
  });
  return crumbs;
}

const ANNOUNCEMENT_KEY = 'np-announcement-dismissed';

function readDismissedAnnouncement(): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(ANNOUNCEMENT_KEY) : null;
  } catch {
    return null;
  }
}

function useAnnouncement(): { content: string; dismiss: () => void } {
  const { data } = useQuery({
    queryKey: ['public-announcement'],
    queryFn: () => call<TextContentData>(api.GET('/api/public/announcement')),
    staleTime: 5 * 60_000,
  });
  const content = data?.content?.trim() ?? '';
  // State, not a render-time localStorage read: dismissing must hide the banner
  // immediately. The stored value is keyed by content so a new announcement
  // surfaces again.
  const [dismissedFor, setDismissedFor] = useState<string | null>(readDismissedAnnouncement);

  const dismiss = () => {
    try {
      localStorage.setItem(ANNOUNCEMENT_KEY, content);
    } catch {
      /* ignore */
    }
    setDismissedFor(content);
  };

  return { content: dismissedFor === content ? '' : content, dismiss };
}

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const { status: sseStatus } = useSseContext();
  const crumbs = useCrumbs(location.pathname);
  const announcement = useAnnouncement();

  const rank = user ? ROLE_RANK[user.role] : 0;
  const visibleNav = NAV.map((g) => ({
    ...g,
    items: g.items.filter((it) => !it.minRole || rank >= ROLE_RANK[it.minRole]),
  })).filter((g) => g.items.length > 0);

  useEffect(() => {
    // Close any transient state on route change could go here.
  }, [location.pathname]);

  const showReconnect = sseStatus !== 'open';

  return (
    <div className="app">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(e) => {
          // Q-11: move real keyboard focus into <main>, not just the scroll
          // position, so the next Tab continues inside the content region.
          const el = document.getElementById('main-content');
          if (!el) return;
          e.preventDefault();
          el.focus();
          el.scrollIntoView({ block: 'start' });
          history.replaceState(null, '', '#main-content');
        }}
      >
        跳到主要内容
      </a>
      <aside className="rail">
        <NavLink to="/" className="brand-link" aria-label="NectarPush 工作台">
          <Brand />
        </NavLink>
        <nav className="rail-nav" aria-label="主导航">
          {visibleNav.map((group) => (
            <div className="nav-group" key={group.label}>
              <p className="nav-label">{group.label}</p>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                >
                  <Icon name={item.icon} className="nav-icon" />
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="rail-mobile-tools">
          <ThemeToggle />
          <AccountMenu variant="compact" />
        </div>
        <div className="rail-foot">
          <span className="avatar" aria-hidden="true">
            {avatarInitial(user?.display_name || user?.username)}
          </span>
          <span className="user-copy">
            <span className="user-name">{user?.display_name || user?.username}</span>
            <span className="user-role">{user ? USER_ROLE_LABEL[user.role] : ''}</span>
          </span>
        </div>
      </aside>

      <div className="main">
        {showReconnect && (
          <div className="sse-banner" role="status">
            <span className="dot" />
            <Icon name="refresh" className="icon" />
            <span>实时连接已断开，正在自动重连…（恢复后将自动补拉最新消息）</span>
          </div>
        )}
        {announcement.content && (
          <div className="sse-banner" style={{ background: 'var(--accent-soft)', color: 'var(--accent-ink)' }} role="note">
            <Icon name="bell" className="icon" />
            <span style={{ flex: 1 }}>{announcement.content}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={announcement.dismiss} aria-label="关闭公告">
              <Icon name="x" className="icon icon-sm" />
            </button>
          </div>
        )}
        <header className="topbar">
          <div className="crumbs">
            {crumbs.map((c, i) => (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                {i > 0 && <span className="sep">/</span>}
                {c.to ? (
                  <NavLink to={c.to}>{c.label}</NavLink>
                ) : (
                  <strong>{c.label}</strong>
                )}
              </span>
            ))}
          </div>
          <div className="top-actions">
            <form
              className="top-search"
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                const value = (e.currentTarget.elements.namedItem('q') as HTMLInputElement)?.value.trim();
                navigate(value ? `/messages?keyword=${encodeURIComponent(value)}` : '/messages');
              }}
            >
              <Icon name="search" className="icon icon-sm" />
              <input name="q" placeholder="搜索消息标题…" aria-label="搜索消息" />
              <kbd>↵</kbd>
            </form>
            <ThemeToggle />
            <AccountMenu />
          </div>
        </header>
        <main id="main-content" className="page" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
