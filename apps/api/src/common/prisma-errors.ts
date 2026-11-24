/**
 * Prisma unique-constraint helpers (Q-06 follow-up, found by contract run 4).
 *
 * `User.username` / `User.email` carry DB-level `@unique` constraints that also
 * cover soft-deleted rows (`deletedAt != null`). Services pre-check duplicates
 * with `deletedAt: null`, so a soft-deleted name passes the check and then the
 * insert throws P2002 — previously surfacing as a 500 `INTERNAL_ERROR`.
 */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';
}