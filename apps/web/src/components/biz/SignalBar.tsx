import type { ReactNode } from 'react';

export type Signal = { tone?: 'live' | 'warning'; content: ReactNode };

/**
 * Workbench "今日概览" signal bar (prototype `.signal-bar`).
 * Mirrors P05 exactly: dot + label pairs, values wrapped in <strong>.
 */
export function SignalBar({ signals, loading }: { signals: Signal[]; loading?: boolean }) {
  if (loading) {
    return (
      <div className="signal-bar" aria-label="今日概览" aria-busy="true">
        {[86, 70, 76].map((w, i) => (
          <span className="signal-item" key={i}>
            <span className="skeleton skeleton-line" style={{ width: w, height: 11, margin: 0 }} />
          </span>
        ))}
      </div>
    );
  }
  return (
    <div className="signal-bar" aria-label="今日概览">
      {signals.map((s, i) => (
        <span className="signal-item" key={i}>
          {s.tone && <span className={`dot dot-${s.tone}`} />}
          {s.content}
        </span>
      ))}
    </div>
  );
}
