import { HttpException, HttpStatus } from '@nestjs/common';

/** Business error codes aligned with docs/openapi.yaml ErrorCode enum. */
export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'TOKEN_REQUIRED'
  | 'INVALID_TOKEN'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'USER_NOT_FOUND'
  | 'USER_DISABLED'
  | 'PASSWORD_CHANGE_REQUIRED'
  | 'CHANNEL_NOT_FOUND'
  | 'CHANNEL_DISABLED'
  | 'CHANNEL_NAME_RESERVED'
  | 'DUPLICATE_NAME'
  | 'WEBHOOK_NOT_FOUND'
  | 'WEBHOOK_DISABLED'
  | 'VALIDATION_FAILED'
  | 'ASYNC_NOT_ALLOWED'
  | 'SMTP_NOT_CONFIGURED'
  | 'CLIENT_NOT_CONNECTED'
  | 'OAUTH_PROVIDER_NOT_CONFIGURED'
  | 'OAUTH_ALREADY_BOUND'
  | 'OAUTH_DISCOVERY_FAILED'
  | 'DEPENDENCY_MISSING'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

const STATUS_BY_CODE: Record<ErrorCode, HttpStatus> = {
  UNAUTHORIZED: HttpStatus.UNAUTHORIZED,
  TOKEN_REQUIRED: HttpStatus.UNAUTHORIZED,
  INVALID_TOKEN: HttpStatus.UNAUTHORIZED,
  FORBIDDEN: HttpStatus.FORBIDDEN,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  USER_NOT_FOUND: HttpStatus.NOT_FOUND,
  USER_DISABLED: HttpStatus.FORBIDDEN,
  PASSWORD_CHANGE_REQUIRED: HttpStatus.FORBIDDEN,
  CHANNEL_NOT_FOUND: HttpStatus.NOT_FOUND,
  CHANNEL_DISABLED: HttpStatus.FORBIDDEN,
  CHANNEL_NAME_RESERVED: HttpStatus.UNPROCESSABLE_ENTITY,
  DUPLICATE_NAME: HttpStatus.UNPROCESSABLE_ENTITY,
  WEBHOOK_NOT_FOUND: HttpStatus.NOT_FOUND,
  WEBHOOK_DISABLED: HttpStatus.FORBIDDEN,
  VALIDATION_FAILED: HttpStatus.UNPROCESSABLE_ENTITY,
  ASYNC_NOT_ALLOWED: HttpStatus.UNPROCESSABLE_ENTITY,
  SMTP_NOT_CONFIGURED: HttpStatus.UNPROCESSABLE_ENTITY,
  CLIENT_NOT_CONNECTED: HttpStatus.UNPROCESSABLE_ENTITY,
  OAUTH_PROVIDER_NOT_CONFIGURED: HttpStatus.FORBIDDEN,
  OAUTH_ALREADY_BOUND: HttpStatus.CONFLICT,
  OAUTH_DISCOVERY_FAILED: HttpStatus.BAD_GATEWAY,
  DEPENDENCY_MISSING: HttpStatus.UNPROCESSABLE_ENTITY,
  RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  INTERNAL_ERROR: HttpStatus.INTERNAL_SERVER_ERROR,
};

/** Thrown anywhere in the app; rendered by the global exception filter. */
export class ApiError extends HttpException {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super({ code, message, details }, STATUS_BY_CODE[code]);
    this.code = code;
    this.details = details;
  }
}
