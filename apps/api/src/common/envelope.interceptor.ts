import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { map, Observable } from 'rxjs';

/** Successful responses -> { success: true, message?, data? } envelope. */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((data) => {
        // Controller already returned a full envelope (push endpoints).
        if (
          data &&
          typeof data === 'object' &&
          'success' in (data as Record<string, unknown>)
        ) {
          return data;
        }
        // Message-only result -> SuccessEnvelope without data payload.
        if (
          data &&
          typeof data === 'object' &&
          Object.keys(data).length === 1 &&
          typeof (data as Record<string, unknown>).message === 'string'
        ) {
          return { success: true, message: (data as { message: string }).message };
        }
        return { success: true, message: '', data: data ?? null };
      }),
    );
  }
}
