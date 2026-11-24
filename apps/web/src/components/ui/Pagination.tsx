import { Icon } from './Icon';

function pageWindow(page: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | '…')[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(total - 1, page + 1);
  if (start > 2) out.push('…');
  for (let p = start; p <= end; p++) out.push(p);
  if (end < total - 1) out.push('…');
  out.push(total);
  return out;
}

export function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  const items = pageWindow(page, totalPages);
  return (
    <div className="pager">
      <button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="上一页">
        <Icon name="chevron-left" className="icon icon-sm" />
      </button>
      {items.map((it, idx) =>
        it === '…' ? (
          <span key={`gap-${idx}`} style={{ padding: '0 4px', color: 'var(--ink-3)' }}>
            …
          </span>
        ) : (
          <button
            key={it}
            type="button"
            className={it === page ? 'active' : ''}
            aria-current={it === page ? 'page' : undefined}
            onClick={() => onChange(it)}
          >
            {it}
          </button>
        ),
      )}
      <button type="button" disabled={page >= totalPages} onClick={() => onChange(page + 1)} aria-label="下一页">
        <Icon name="chevron-right" className="icon icon-sm" />
      </button>
    </div>
  );
}

/** Shared table footer: count summary on the left, pager on the right. */
export function TableFoot({
  total,
  page,
  totalPages,
  onChange,
  unit = '条',
}: {
  total: number;
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
  unit?: string;
}) {
  return (
    <div className="table-foot">
      <span>
        共 {total} {unit} · 第 {page} 页
      </span>
      <Pagination page={page} totalPages={totalPages} onChange={onChange} />
    </div>
  );
}
