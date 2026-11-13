import { Injectable, PipeTransform } from '@nestjs/common';
import { ApiError, ErrorCode } from './errors';

/**
 * Q-06: numeric route params and pagination params used to flow into Prisma
 * unchecked. `ParseIntPipe` accepts values beyond Number.MAX_SAFE_INTEGER and
 * `Number('abc')` yields NaN, which Prisma rejects with a 500. Both must be
 * client errors instead.
 */

/** Returns a positive safe integer, or null for anything else. */
export function safeId(raw: string | undefined): number | null {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id >= 1 ? id : null;
}

const DEFAULT_ID_MESSAGES: Record<string, string> = {
  NOT_FOUND: '资源不存在',
  USER_NOT_FOUND: '用户不存在',
  CHANNEL_NOT_FOUND: '渠道不存在',
  WEBHOOK_NOT_FOUND: 'Webhook 不存在',
};

/** Route-param pipe that maps malformed / out-of-range ids to 404, never 500. */
@Injectable()
export class ParseIdPipe implements PipeTransform<string, number> {
  constructor(
    private readonly code: ErrorCode = 'NOT_FOUND',
    private readonly message: string = DEFAULT_ID_MESSAGES[code] ?? '资源不存在',
  ) {}

  transform(value: string): number {
    const id = safeId(value);
    if (id === null) throw new ApiError(this.code, this.message);
    return id;
  }
}

export function parsePageParam(raw: string | undefined, field = 'page'): number {
  if (raw === undefined || raw === '') return 1;
  if (!/^\d+$/.test(raw)) {
    throw new ApiError('VALIDATION_FAILED', `参数校验失败：${field} 必须是大于 0 的整数`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ApiError('VALIDATION_FAILED', `参数校验失败：${field} 必须是大于 0 的整数`);
  }
  return value;
}

export function parsePageSizeParam(raw: string | undefined, field = 'page_size', fallback = 20): number {
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new ApiError('VALIDATION_FAILED', `参数校验失败：${field} 必须是 1 到 100 之间的整数`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
    throw new ApiError('VALIDATION_FAILED', `参数校验失败：${field} 必须是 1 到 100 之间的整数`);
  }
  return value;
}

/** Parses an optional date query param; unparseable values are a 400, not a 500. */
export function parseDateParam(raw: string | undefined, field: string): string | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (Number.isNaN(new Date(raw).getTime())) {
    throw new ApiError('VALIDATION_FAILED', `参数校验失败：${field} 不是有效的时间`);
  }
  return raw;
}