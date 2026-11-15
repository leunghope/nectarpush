import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, call } from '@/api/client';
import type { TextContentData } from '@nectarpush/shared';
import { Brand, ThemeToggle } from '@/components/ui/Brand';
import { useBranding } from '@/hooks/branding';
import { Icon } from '@/components/ui/Icon';

/** Centered card shell used by login / register / reset screens. */
export function AuthShell({
  kicker,
  title,
  lede,
  children,
  footer,
}: {
  kicker?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const brand = useBranding();
  return (
    <div className="auth-shell">
      <div className="auth-top">
        <Brand />
        <ThemeToggle />
      </div>
      <div className="auth-main">
        <div className="auth-wrap">
          {kicker && <p className="eyebrow auth-kicker">{kicker}</p>}
          <h1 className="auth-title">{title}</h1>
          {lede && <p className="auth-lede">{lede}</p>}
          <div className="auth-form">{children}</div>
          {footer && <div className="auth-foot">{footer}</div>}
          <p className="auth-note">
            {brand.site_name_en} · {brand.site_name} · Quiet Precision
          </p>
        </div>
      </div>
    </div>
  );
}

function PublicFooter() {
  const { data } = useQuery({
    queryKey: ['public-footer'],
    queryFn: () => call<TextContentData>(api.GET('/api/public/footer')),
    staleTime: 5 * 60_000,
  });
  const brand = useBranding();
  const content = data?.content?.trim();
  return (
    <footer className="public-foot">
      <span>{content || `${brand.site_name_en} · ${brand.site_name}`}</span>
      <span className="mono">self-hosted message relay</span>
    </footer>
  );
}

/** Wide shell used by the anonymous public message page and about page. */
export function PublicShell({ children, card = true }: { children: ReactNode; card?: boolean }) {
  return (
    <div className="public-shell">
      <div className="public-top">
        <Brand />
        <span style={{ marginLeft: 'auto' }}>
          <ThemeToggle />
        </span>
      </div>
      <div className="public-main">{card ? <div className="public-card">{children}</div> : <div style={{ width: 'min(860px, 100%)' }}>{children}</div>}</div>
      <PublicFooter />
    </div>
  );
}

export function PublicTopBar() {
  return (
    <div className="public-top">
      <Brand />
      <ThemeToggle />
    </div>
  );
}

export { Icon };
