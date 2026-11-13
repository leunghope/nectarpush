import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ApiError } from './errors';

interface ErrorBody {
  success: false;
  message: string;
  code: string;
  details?: unknown;
}

/** Renders every error as the unified envelope { success:false, message, code }. */
@Catch()
export class UnifiedExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    const body: ErrorBody = {
      success: false,
      message: '服务器内部错误',
      code: 'INTERNAL_ERROR',
    };

    if (exception instanceof ApiError) {
      status = exception.getStatus();
      body.code = exception.code;
      body.message = exception.message;
      if (exception.details !== undefined) body.details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const payload = exception.getResponse();
      if (typeof payload === 'string') {
        // Q-06: Nest wraps Fastify's body-parser errors as HttpException with a
        // plain string payload. A 400 here is client input, not a server fault.
        body.message = payload;
        if (status === HttpStatus.BAD_REQUEST) body.code = 'VALIDATION_FAILED';
      } else if (
        payload &&
        typeof payload === 'object' &&
        'message' in payload
      ) {
        const msg = (payload as Record<string, unknown>).message;
        body.message = Array.isArray(msg) ? msg.join('; ') : String(msg);
        body.code = 'VALIDATION_FAILED';
      }
    } else if (exception instanceof Error) {
      // Q-06: Fastify's content-type parser rejects malformed JSON with an
      // FST_ERR_CTP_* error carrying statusCode 400. It is a client error, not
      // an internal one, so keep the status and report a validation code.
      const raw = exception as Error & { statusCode?: number };
      const statusCode = Number(raw.statusCode);
      if (Number.isInteger(statusCode) && statusCode >= 400 && statusCode < 500) {
        status = statusCode;
        body.code = 'VALIDATION_FAILED';
        body.message = raw.message || '请求无效';
      } else {
        this.logger.error(exception.message, exception.stack);
      }
    }

    if (typeof res.status === 'function' && !res.sent) {
      res.status(status).send(body);
    }
  }
}
