import { PipeTransform } from '@nestjs/common';
import { ZodType } from 'zod';
import { ApiError } from './errors';

/** Zod validation pipe -> VALIDATION_FAILED with per-field details. */
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodType) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        field: i.path.join('.') || '(body)',
        message: i.message,
      }));
      throw new ApiError(
        'VALIDATION_FAILED',
        `参数校验失败：${details.map((d) => `${d.field} ${d.message}`).join('；')}`,
        details,
      );
    }
    return result.data;
  }
}
