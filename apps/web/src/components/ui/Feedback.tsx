import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export function Spinner({ label = '加载中' }: { label?: string }) {
  return (
    <div className="center-state">
      <span className="spinner" role="status" aria-label={label} />
      <span>{label}…</span>
    </div>
  );
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-hidden="true" style={{ padding: 16 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton skeleton-line" style={{ width: `${90 - (i % 3) * 12}%` }} />
      ))}
    </div>
  );
}

export function SkeletonCards({ count = 3 }: { count?: number }) {
  return (
    <div className="channel-grid" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton skeleton-card" />
      ))}
    </div>
  );
}

export function Empty({
  icon = 'inbox',
  title,
  description,
  children,
}: {
  icon?: IconName;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} />
      </div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {children && <div className="empty-actions">{children}</div>}
    </div>
  );
}

export function Alert({
  tone = 'info',
  children,
  actions,
}: {
  tone?: 'error' | 'warning' | 'info' | 'success';
  children: ReactNode;
  actions?: ReactNode;
}) {
  const iconName: IconName = tone === 'error' ? 'warning' : tone === 'success' ? 'check' : 'info';
  return (
    <div className={`alert alert-${tone}`} role={tone === 'error' ? 'alert' : undefined}>
      <Icon name={iconName} />
      <div className="alert-body">{children}</div>
      {actions && <div className="alert-actions">{actions}</div>}
    </div>
  );
}

export function PageHead({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div className="page-head-copy">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}
