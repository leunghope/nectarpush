import { useState } from 'react';
import { toast } from '@/stores/ui';
import { Icon } from './Icon';

/** Compact clipboard button with inline success feedback. */
export function CopyButton({
  value,
  label = '复制',
  className = 'btn btn-sm btn-ghost',
  showLabel = true,
}: {
  value: string;
  label?: string;
  className?: string;
  showLabel?: boolean;
}) {
  const [done, setDone] = useState(false);

  async function copy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const el = document.createElement('textarea');
        el.value = value;
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
      }
      setDone(true);
      window.setTimeout(() => setDone(false), 1600);
    } catch {
      toast.error('复制失败，请手动选择文本复制');
    }
  }

  const classes = ['copy-btn', className, showLabel ? '' : 'copy-btn-icon', done ? 'is-done' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <>
      <button type="button" className={classes} onClick={copy} aria-label={showLabel ? undefined : label}>
        <Icon name={done ? 'check' : 'copy'} className="icon icon-sm" />
        {showLabel && (done ? '已复制' : label)}
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {done ? '已复制' : ''}
      </span>
    </>
  );
}