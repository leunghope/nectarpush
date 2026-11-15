import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth';
import { ROLE_RANK } from '@/lib/format';
import { Icon } from '@/components/ui/Icon';

export type SettingsSection = { id: string; label: string };
/** Alias for the nav item shape, avoids clashing with the SettingsSection component. */
export type SettingsNavItem = SettingsSection;

const LINKS: Array<{ to: string; label: string; minRank: number }> = [
  { to: '/me', label: '个人设置', minRank: 1 },
  { to: '/me/push', label: '推送设置', minRank: 1 },
  { to: '/settings', label: '系统设置', minRank: 3 },
  { to: '/settings/other', label: '其他设置', minRank: 3 },
];

/**
 * Settings shell with two modes:
 *  - `sections` provided → in-page anchor navigation with scroll-spy (P14/P18/P19).
 *  - no `sections` → route links across the settings pages (legacy pages).
 */
export function SettingsLayout({
  children,
  sections,
  onNavigate,
}: {
  children: ReactNode;
  sections?: SettingsSection[];
  /** Anchor click hook — lets a page expand a collapsed section before scrolling. */
  onNavigate?: (id: string) => void;
}) {
  const user = useAuthStore((s) => s.user);
  const rank = user ? ROLE_RANK[user.role] : 0;
  const [active, setActive] = useState(sections?.[0]?.id ?? '');
  const navRef = useRef<HTMLElement | null>(null);

  const ids = useMemo(() => (sections ?? []).map((s) => s.id), [sections]);

  useEffect(() => {
    if (ids.length === 0) return;
    const targets = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => Boolean(el));
    if (targets.length === 0) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-20% 0px -60% 0px', threshold: [0, 1] },
    );
    targets.forEach((t) => obs.observe(t));
    return () => obs.disconnect();
  }, [ids]);

  if (sections && sections.length > 0) {
    return (
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="设置分区" ref={navRef}>
          {sections.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              data-settings-link={s.id}
              aria-current={active === s.id ? 'true' : undefined}
              className={`settings-link${active === s.id ? ' active' : ''}`}
              onClick={() => {
                setActive(s.id);
                onNavigate?.(s.id);
              }}
            >
              {s.label}
            </a>
          ))}
        </nav>
        <div className="settings-main settings-panel">{children}</div>
      </div>
    );
  }

  return (
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="设置导航">
        {LINKS.filter((l) => rank >= l.minRank).map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end
            className={({ isActive }) => `settings-link${isActive ? ' active' : ''}`}
          >
            {l.label}
          </NavLink>
        ))}
      </nav>
      <div className="settings-main settings-panel">{children}</div>
    </div>
  );
}

/** Settings section wrapper matching prototype `.settings-section`. */
export function SettingsSection({
  id,
  title,
  description,
  children,
  actions,
  collapsible = false,
  open = true,
  onToggle,
  badge,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  /** Render the head as a toggle that collapses the body (system settings). */
  collapsible?: boolean;
  open?: boolean;
  onToggle?: () => void;
  /** Small marker next to the title, e.g. an unsaved-changes dot. */
  badge?: ReactNode;
}) {
  const collapsed = collapsible && !open;
  return (
    <section className={`settings-section${collapsed ? ' is-collapsed' : ''}`} id={id} data-settings-section={id}>
      {collapsible ? (
        <button
          type="button"
          className="section-head section-head-toggle"
          aria-expanded={open}
          aria-controls={`${id}-body`}
          data-testid={`settings-toggle-${id}`}
          onClick={onToggle}
        >
          <span className="section-head-copy">
            <span className="section-head-title">
              {title}
              {badge}
            </span>
            {description && <span className="section-head-desc">{description}</span>}
          </span>
          <Icon name="chevron-right" className={`icon-sm section-chevron${open ? ' is-open' : ''}`} />
        </button>
      ) : (
        <div className="section-head">
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
      )}
      {!collapsed &&
        (collapsible ? (
          <div className="section-body" id={`${id}-body`}>
            {children}
          </div>
        ) : (
          children
        ))}
      {!collapsed && actions && <div className="section-actions">{actions}</div>}
    </section>
  );
}

/** One label/description + control row matching prototype `.setting-row`. */
export function SettingRow({
  label,
  description,
  children,
}: {
  label: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="setting-row">
      <div className="setting-label">
        <h3>{label}</h3>
        {description && <p>{description}</p>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}
