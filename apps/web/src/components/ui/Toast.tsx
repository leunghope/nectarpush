import { useUIStore } from '@/stores/ui';
import { Icon } from './Icon';
import type { IconName } from './Icon';

const ICONS: Record<string, IconName> = {
  success: 'check',
  error: 'warning',
  info: 'info',
  warning: 'warning',
};

export function ToastStack() {
  const toasts = useUIStore((s) => s.toasts);
  const remove = useUIStore((s) => s.remove);
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind} show`}>
          <span className="dot" />
          <Icon name={ICONS[t.kind] ?? 'info'} className="icon icon-sm" style={{ display: 'none' }} />
          <span>{t.message}</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ minHeight: 20, padding: '0 4px', marginLeft: 4 }}
            aria-label="关闭提示"
            onClick={() => remove(t.id)}
          >
            <Icon name="x" className="icon icon-sm" />
          </button>
        </div>
      ))}
    </div>
  );
}
