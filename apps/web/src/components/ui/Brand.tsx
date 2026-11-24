import { Icon } from './Icon';
import { useBranding } from '@/hooks/branding';

/** Wordmark lockup used in rails, auth and public shells. */
export function Brand({ subtitle = true }: { subtitle?: boolean }) {
  const brand = useBranding();
  return (
    <span className="brand-lockup">
      <span className="brand-mark" aria-hidden="true">
        {brand.icon ? <img className="brand-icon" src={brand.icon} alt="" /> : '蜂'}
      </span>
      <span className="brand-copy">
        <span className="brand-name">{brand.site_name_en || 'NectarPush'}</span>
        {subtitle && <span className="brand-tag">{brand.site_name}</span>}
      </span>
    </span>
  );
}

export function ThemeToggle({ className = 'icon-btn theme-btn' }: { className?: string }) {
  return <ThemeToggleInner className={className} />;
}

import { useThemeStore } from '@/stores/theme';

function ThemeToggleInner({ className }: { className: string }) {
  const theme = useThemeStore((s) => s.theme);
  const toggle = useThemeStore((s) => s.toggle);
  const label = theme === 'dark' ? '切换到明亮主题' : '切换到暗色主题';
  return (
    <button type="button" className={className} onClick={toggle} aria-label={label} title={label}>
      <Icon name="moon" className="icon theme-moon" />
      <Icon name="sun" className="icon theme-sun" />
    </button>
  );
}
