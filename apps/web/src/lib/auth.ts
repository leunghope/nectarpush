import { api, call } from '@/api/client';
import { ApiError, type User } from '@nectarpush/shared';
import { useAuthStore } from '@/stores/auth';

/**
 * Resolve the initial auth state once per app load.
 * GET /api/me returns 403 PASSWORD_CHANGE_REQUIRED while a forced change is
 * pending, which puts the whole app into the hard-block screen.
 */
export async function bootstrapAuth(): Promise<void> {
  try {
    const me = await call<User>(api.GET('/api/me'));
    useAuthStore.getState().setAuthenticated(me);
  } catch (err) {
    if (err instanceof ApiError && err.code === 'PASSWORD_CHANGE_REQUIRED') {
      useAuthStore.getState().markPasswordChangeRequired();
    } else {
      useAuthStore.getState().markAnonymous();
    }
  }
}
