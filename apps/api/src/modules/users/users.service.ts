import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiError } from '../../common/errors';
import { hashPassword } from '../../common/crypto';
import { isUniqueViolation } from '../../common/prisma-errors';

const ROLE_RANK: Record<string, number> = { user: 1, admin: 2, root: 3 };

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  toView(u: {
    id: number; username: string; displayName: string; role: string; status: string;
    email: string | null; defaultChannel: string | null; allowSendEmailToOthers: boolean;
    allowSaveMessage: boolean; createdAt: Date; mustChangePassword: boolean;
    deletedAt?: Date | null;
  }) {
    return {
      id: u.id,
      username: u.username,
      display_name: u.displayName,
      role: u.role,
      status: u.status,
      email: u.email,
      default_channel: u.defaultChannel,
      permissions: {
        send_email_to_others: u.allowSendEmailToOthers,
        save_message: u.allowSaveMessage,
      },
      must_change_password: u.mustChangePassword,
      deleted_at: u.deletedAt ? u.deletedAt.toISOString() : null,
      created_at: u.createdAt.toISOString(),
    };
  }

  async list(keyword?: string, page = 1, pageSize = 10, includeDeleted = false) {
    const where = {
      ...(includeDeleted ? {} : { deletedAt: null }),
      ...(keyword
        ? {
            OR: [
              { username: { contains: keyword } },
              { displayName: { contains: keyword } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { id: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      items: rows.map((u) => this.toView(u)),
      page: { page, page_size: pageSize, total, total_pages: Math.ceil(total / pageSize) },
    };
  }

  async create(
    actorRole: string,
    input: { username: string; password: string; display_name?: string; role?: string },
  ) {
    const role = input.role ?? 'user';
    if ((ROLE_RANK[role] ?? 1) >= ROLE_RANK[actorRole]) {
      throw new ApiError('FORBIDDEN', '不能创建权限不低于自己的用户');
    }
    const dup = await this.prisma.user.findFirst({ where: { username: input.username, deletedAt: null } });
    if (dup) throw new ApiError('DUPLICATE_NAME', '用户名已存在');
    try {
      const row = await this.prisma.user.create({
        data: {
          username: input.username,
          displayName: input.display_name ?? input.username,
          passwordHash: hashPassword(input.password),
          role,
        },
      });
      return this.toView(row);
    } catch (e) {
      // Q-06 (contract run 4): soft-deleted users still occupy the unique index.
      if (isUniqueViolation(e)) throw new ApiError('DUPLICATE_NAME', '用户名已存在（含已删除账号）');
      throw e;
    }
  }

  async get(actorRole: string, id: number) {
    const row = await this.prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new ApiError('USER_NOT_FOUND', '用户不存在');
    this.assertLowerRole(actorRole, row.role);
    return this.toView(row);
  }

  async update(actorRole: string, id: number, input: { username?: string; display_name?: string; password?: string }) {
    const row = await this.prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new ApiError('USER_NOT_FOUND', '用户不存在');
    this.assertLowerRole(actorRole, row.role);
    const data: Record<string, unknown> = {};
    if (input.username && input.username !== row.username) {
      const dup = await this.prisma.user.findFirst({ where: { username: input.username, deletedAt: null } });
      if (dup) throw new ApiError('DUPLICATE_NAME', '用户名已存在');
      data.username = input.username;
    }
    if (input.display_name !== undefined) data.displayName = input.display_name;
    if (input.password) {
      data.passwordHash = hashPassword(input.password);
      data.mustChangePassword = true; // admin reset forces change on next login
      data.sessionsRevokedAt = new Date();
    }
    const updated = await this.prisma.user.update({ where: { id }, data });
    return this.toView(updated);
  }

  async remove(actorRole: string, id: number) {
    const row = await this.prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new ApiError('USER_NOT_FOUND', '用户不存在');
    if (row.role === 'root') throw new ApiError('FORBIDDEN', '不能删除 root 用户');
    this.assertLowerRole(actorRole, row.role);
    // Soft delete + anonymization (D-UX-05).
    await this.prisma.user.update({
      where: { id },
      data: {
        username: `deleted_${row.id}`,
        email: null,
        passwordHash: null,
        accessToken: null,
        displayName: `已注销用户${row.id}`,
        status: 'disabled',
        deletedAt: new Date(),
      },
    });
    // D-03：软删不走 FK 级联，显式清空 OAuth 绑定，释放身份供他人绑定。
    await this.prisma.oAuthBinding.deleteMany({ where: { userId: id } });
    await this.prisma.channel.deleteMany({ where: { ownerId: id } });
    await this.prisma.webhook.deleteMany({ where: { ownerId: id } });
    return { deleted: id };
  }

  /** POST /api/users/:id/restore — undo a soft delete (D-06). */
  async restore(actorRole: string, id: number, input: { username?: string } = {}) {
    const row = await this.prisma.user.findFirst({ where: { id, deletedAt: { not: null } } });
    if (!row) throw new ApiError('USER_NOT_FOUND', '用户不存在');
    this.assertLowerRole(actorRole, row.role);
    let username = input.username?.trim() || row.username;
    const taken = async (name: string) =>
      this.prisma.user.findFirst({ where: { username: name, deletedAt: null, NOT: { id } } });
    if (input.username) {
      if (await taken(username)) throw new ApiError('DUPLICATE_NAME', '用户名已存在');
    } else if (await taken(username)) {
      // The anonymized deleted_<id> name was registered by someone else in
      // the meantime — generate a fresh unique username instead (D-06).
      let n = 1;
      for (;;) {
        const candidate = `restored_${id}_${n}`;
        if (!(await taken(candidate))) {
          username = candidate;
          break;
        }
        n += 1;
      }
    }
    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        username,
        status: 'active',
        deletedAt: null,
        // Invalidate any session cookie issued before the deletion.
        sessionsRevokedAt: new Date(),
      },
    });
    return this.toView(updated);
  }

  async manage(
    actorRole: string,
    actorId: number,
    id: number,
    action: string,
  ) {
    const row = await this.prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new ApiError('USER_NOT_FOUND', '用户不存在');
    if ((ROLE_RANK[row.role] ?? 1) >= ROLE_RANK[actorRole] && row.id !== actorId) {
      throw new ApiError('FORBIDDEN', '不能操作权限不低于自己的用户');
    }
    const data: Record<string, unknown> = {};
    switch (action) {
      case 'enable':
        data.status = 'active';
        break;
      case 'disable':
        if (row.role === 'root') throw new ApiError('FORBIDDEN', '不能禁用 root 用户');
        data.status = 'disabled';
        break;
      case 'promote':
        if (row.role !== 'user') throw new ApiError('VALIDATION_FAILED', '仅普通用户可提升为管理员');
        if (ROLE_RANK['admin'] >= ROLE_RANK[actorRole]) throw new ApiError('FORBIDDEN', '无权提升用户');
        data.role = 'admin';
        break;
      case 'demote':
        if (row.role !== 'admin') throw new ApiError('VALIDATION_FAILED', '仅管理员可降级为普通用户');
        data.role = 'user';
        break;
      case 'allow_send_email_to_others':
        data.allowSendEmailToOthers = true;
        break;
      case 'disallow_send_email_to_others':
        data.allowSendEmailToOthers = false;
        break;
      case 'allow_save_message':
        data.allowSaveMessage = true;
        break;
      case 'disallow_save_message':
        data.allowSaveMessage = false;
        break;
      default:
        throw new ApiError('VALIDATION_FAILED', `未知操作：${action}`);
    }
    const updated = await this.prisma.user.update({ where: { id }, data });
    return this.toView(updated);
  }

  /** Only users strictly below the actor's own rank may be inspected or mutated. */
  private assertLowerRole(actorRole: string, targetRole: string) {
    if ((ROLE_RANK[targetRole] ?? 1) >= ROLE_RANK[actorRole]) {
      throw new ApiError('FORBIDDEN', '不能操作权限不低于自己的用户');
    }
  }
}
