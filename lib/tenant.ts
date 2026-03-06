/**
 * User-scoped Prisma query helpers for multi-tenant row-level security.
 *
 * When userId is provided (session auth), all queries are filtered to that user.
 * When userId is null (admin API token), no filtering is applied.
 */

/** Returns a userId filter for Prisma `where` clauses, or {} for admin access. */
export function userWhere(userId: string | null): { userId: string } | object {
  return userId ? { userId } : {};
}

/**
 * Asserts that userId is non-null (session required for writes).
 * Throws if called with a null userId (admin token).
 */
export function requireUserId(userId: string | null): string {
  if (!userId) {
    throw new Error("Session required: API token cannot perform mutations");
  }
  return userId;
}
