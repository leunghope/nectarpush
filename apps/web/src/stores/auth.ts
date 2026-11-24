import { create } from 'zustand';
import type { User } from '@nectarpush/shared';

export type AuthStatus = 'loading' | 'authenticated' | 'must_change_password' | 'anonymous';

type AuthStore = {
  status: AuthStatus;
  user: User | null;
  setAuthenticated: (user: User) => void;
  patchUser: (user: User) => void;
  markPasswordChangeRequired: () => void;
  markAnonymous: () => void;
  setLoading: () => void;
};

export const useAuthStore = create<AuthStore>((set) => ({
  status: 'loading',
  user: null,
  setAuthenticated: (user) => set({ status: 'authenticated', user }),
  patchUser: (user) => set({ user }),
  markPasswordChangeRequired: () => set({ status: 'must_change_password' }),
  markAnonymous: () => set({ status: 'anonymous', user: null }),
  setLoading: () => set({ status: 'loading' }),
}));
