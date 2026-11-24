import { create } from 'zustand';

export type ToastKind = 'success' | 'error' | 'info' | 'warning';
export type ToastItem = { id: number; kind: ToastKind; message: string };

type UIStore = {
  toasts: ToastItem[];
  push: (kind: ToastKind, message: string) => void;
  remove: (id: number) => void;
};

let seq = 1;

export const useUIStore = create<UIStore>((set) => ({
  toasts: [],
  push: (kind, message) => {
    const id = seq++;
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3800);
  },
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Imperative toast helper callable from anywhere. */
export const toast = {
  success: (message: string) => useUIStore.getState().push('success', message),
  error: (message: string) => useUIStore.getState().push('error', message),
  info: (message: string) => useUIStore.getState().push('info', message),
  warning: (message: string) => useUIStore.getState().push('warning', message),
};
