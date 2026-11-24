import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthedUser } from './session';

/** Injects the authenticated user resolved by SessionGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthedUser => {
    return ctx.switchToHttp().getRequest().user as AuthedUser;
  },
);
