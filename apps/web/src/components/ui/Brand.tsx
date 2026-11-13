import { Icon } from './Icon';

/** Wordmark lockup used in rails, auth and public shells. */
export function Brand({ subtitle = true }: { subtitle?: boolean }) {
  return (
    <span className="brand-lockup">
      <span className="brand-mark" aria-hidden="true">
        蜂
      </span>
      <span className="brand-copy">
        <span className="brand-name">NectarPush</span>
        {subtitle && <span className="brand-tag">蜂鸟推送</span>}
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
