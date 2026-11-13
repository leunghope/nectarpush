import { create } from 'zustand';

export type Theme = 'light' | 'dark';
const STORAGE_KEY = 'np-theme';

function readInitial(): Theme {
  const v = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
  return v === 'light' || v === 'dark' ? v : 'dark';
}

function apply(theme: Theme): void {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

type ThemeStore = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
};

export const useThemeStore = create<ThemeStore>((set, get) => ({
  theme: readInitial(),
  setTheme: (theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore quota / private mode */
    }
    apply(theme);
    set({ theme });
  },
  toggle: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
}));

/** Apply the persisted theme as early as possible (index.html also does this inline). */
export function initTheme(): void {
  apply(readInitial());
}
