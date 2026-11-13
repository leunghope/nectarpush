import { useEffect, useState } from 'react';

export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function useDocumentTitle(title?: string): void {
  useEffect(() => {
    if (!title) return;
    const prev = document.title;
    document.title = `${title} · NectarPush`;
    return () => {
      document.title = prev;
    };
  }, [title]);
}
