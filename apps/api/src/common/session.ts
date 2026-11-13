import { PrismaService } from '../prisma/prisma.service';
import { verifySession } from './crypto';

export const SESSION_COOKIE = 'np_session';
export const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;

/** Authenticated user attached to the request by SessionGuard. */
export interface AuthedUser {
  id: number;
  username: string;
  displayName: string;
  role: 'user' | 'admin' | 'root';
  status: 'active' | 'disabled';
  email: string | null;
  defaultChannel: string | null;
  allowSendEmailToOthers: boolean;
  allowSaveMessage: boolean;
  mustChangePassword: boolean;
}

export async function resolveUserFromRequest(
  req: { headers: Record<string, string | string[] | undefined>; cookies?: Record<string, string | undefined> },
  prisma: PrismaService,
): Promise<AuthedUser | null> {
  let userId: number | null = null;
  let sessionExp: number | null = null;

  const cookie = req.cookies?.[SESSION_COOKIE];
  const session = verifySession(cookie ?? undefined);
  if (session) {
    userId = session.userId;
    sessionExp = session.exp;
  }
  if (userId === null) {
    const header = req.headers.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      const token = header.slice(7).trim();
      if (token.length === 32) userId = await findUserByGlobalToken(token, prisma);
    }
  }
  if (userId === null) return null;

  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null, status: 'active' },
  });
  if (!user) return null;
  if (
    sessionExp !== null &&
    user.sessionsRevokedAt &&
    sessionExp - SESSION_TTL_MS < user.sessionsRevokedAt.getTime()
  ) {
    return null; // session issued before revocation
  }
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role as AuthedUser['role'],
    status: user.status as AuthedUser['status'],
    email: user.email,
    defaultChannel: user.defaultChannel,
    allowSendEmailToOthers: user.allowSendEmailToOthers,
    allowSaveMessage: user.allowSaveMessage,
    mustChangePassword: user.mustChangePassword,
  };
}

async function findUserByGlobalToken(
  token: string,
  prisma: PrismaService,
): Promise<number | null> {
  const users = await prisma.user.findMany({
    where: { deletedAt: null, accessToken: { not: null } },
    select: { id: true, accessToken: true },
  });
  // Tokens are stored encrypted; compare after decryption (small user table).
  const { decrypt } = await import('./crypto');
  for (const u of users) {
    const plain = u.accessToken ? decrypt(u.accessToken) : null;
    if (plain === token) return u.id;
  }
  return null;
}
