import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from './errors';
import { AuthedUser, resolveUserFromRequest } from './session';

export const ROLES_KEY = 'np:roles';

const ROLE_RANK: Record<string, number> = { user: 1, admin: 2, root: 3 };

/** Route decorator: minimum role allowed (user < admin < root). */
export const Roles = (...roles: Array<'user' | 'admin' | 'root'>) =>
  SetMetadata(ROLES_KEY, roles);

/** Session cookie or Bearer global-token guard for /api/** routes. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const user = await requireSessionUser(req, this.prisma);
    const roles =
      this.reflector.getAllAndOverride<Array<'user' | 'admin' | 'root'>>(
        ROLES_KEY,
        [ctx.getHandler(), ctx.getClass()],
      ) ?? ['user'];
    const minRank = Math.min(...roles.map((r) => ROLE_RANK[r] ?? 1));
    if ((ROLE_RANK[user.role] ?? 1) < minRank) {
      throw new ApiError('FORBIDDEN', '无权执行该操作');
    }
    req.user = user as AuthedUser;
    return true;
  }
}

/**
 * Request shape accepted by the session helpers (FastifyRequest satisfies it).
 */
export interface SessionRequest {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string | undefined>;
}

/**
 * Resolve and validate the session user, enforcing mustChangePassword (D-02).
 * Shared by SessionGuard and the merged message detail/public route, so the
 * numeric-id branch of GET /api/messages/:uuid behaves exactly like a guarded
 * route. Throws ApiError on any failure.
 */
export async function requireSessionUser(
  req: SessionRequest,
  prisma: PrismaService,
): Promise<AuthedUser> {
  const user = await resolveUserFromRequest(req, prisma);
  if (!user) {
    throw new ApiError('UNAUTHORIZED', '未登录或会话已过期');
  }
  if (user.status === 'disabled') {
    throw new ApiError('USER_DISABLED', '用户已被封禁');
  }
  if (user.mustChangePassword && !isPasswordChangeRoute(req)) {
    throw new ApiError('PASSWORD_CHANGE_REQUIRED', '请先修改密码');
  }
  return user;
}

/**
 * Routes a mustChangePassword session may still call (D-02): the self-service
 * password change and logout. Everything else under /api/** is blocked until
 * the password is changed.
 */
function isPasswordChangeRoute(req: { method?: string; url?: string }): boolean {
  const path = (req.url ?? '').split('?')[0];
  if (req.method === 'PATCH' && path === '/api/me') return true;
  if (req.method === 'POST' && path === '/api/auth/logout') return true;
  return false;
}

export type { AuthedUser };
export { UnauthorizedException };
