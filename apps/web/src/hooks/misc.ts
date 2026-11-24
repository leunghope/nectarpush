import { useEffect, useState } from 'react';
import { useBranding } from './branding';

export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function useDocumentTitle(title?: string): void {
  const brand = useBranding();
  useEffect(() => {
    const prev = document.title;
    // 站点名称是标题的默认值：没有页面标题时，整条标题就是站点名称。
    document.title = title ? `${title} · ${brand.site_name}` : brand.site_name;
    return () => {
      document.title = prev;
    };
  }, [title, brand.site_name]);
}
