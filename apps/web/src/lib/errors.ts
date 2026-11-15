import { ApiError } from '@nectarpush/shared';

/** Human-readable message from any thrown value (ApiError carries backend text). */
export function errMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return '操作失败，请稍后重试';
}

export function errCode(err: unknown): string | undefined {
  return err instanceof ApiError ? err.code : undefined;
}
