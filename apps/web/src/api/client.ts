import { createApiClient, ApiError } from '@nectarpush/shared';
import { useAuthStore } from '@/stores/auth';

/** Same-origin typed client: np_session cookie flows automatically. */
export const api = createApiClient('');

/** Shape openapi-fetch resolves to for every call. */
export type FetchResult<T = any> = {
  data?: T;
  error?: unknown;
  response: Response;
};

const STATUS_FALLBACK: Record<number, string> = {
  400: '请求参数有误',
  401: '登录已过期，请重新登录',
  403: '没有操作权限',
  404: '资源不存在',
  409: '资源冲突',
  422: '操作被拒绝',
  429: '请求过于频繁，请稍后再试',
  500: '服务器内部错误',
};

function toApiError(error: unknown, status: number): ApiError {
  const e = (error ?? {}) as { message?: string; code?: string };
  return new ApiError(e.message || STATUS_FALLBACK[status] || `请求失败（${status}）`, e.code, status);
}

/** Keep global auth state in sync with backend guard responses. */
function syncAuthState(err: ApiError): void {
  const store = useAuthStore.getState();
  if (err.code === 'PASSWORD_CHANGE_REQUIRED') store.markPasswordChangeRequired();
  else if (err.status === 401) store.markAnonymous();
}

/** Unwrap the `{success,data}` envelope; throw ApiError on failure. */
export async function call<T = unknown>(p: Promise<FetchResult>): Promise<T> {
  const { data, error, response } = await p;
  if (error !== undefined || !response.ok) {
    const err = toApiError(error, response.status);
    syncAuthState(err);
    throw err;
  }
  return (data as { data?: T } | undefined)?.data as T;
}

/** Like call() but for endpoints whose envelope carries no meaningful data. */
export async function callVoid(p: Promise<FetchResult>): Promise<void> {
  const { error, response } = await p;
  if (error !== undefined || !response.ok) {
    const err = toApiError(error, response.status);
    syncAuthState(err);
    throw err;
  }
}

export { ApiError };
