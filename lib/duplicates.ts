import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

/** Trigram similarity threshold – raise to be stricter, lower to catch more. */
export const DUPLICATE_SIMILARITY_THRESHOLD =
  Number(process.env.DUPLICATE_THRESHOLD) || 0.4;

export interface DuplicateMatch {
  id: string;
  company: string;
  role: string;
  similarity: number;
}

/**
 * Find existing applications that are similar to the given company+role
 * using PostgreSQL trigram similarity. Excludes archived applications.
 */
export async function findDuplicateApplications(
  company: string,
  role: string,
  userId: string,
): Promise<DuplicateMatch[]> {
  const needle = `${company} ${role}`.toLowerCase();

  const rows = await prisma.$queryRaw<
    { id: number; company: string; role: string; sim: number }[]
  >(
    Prisma.sql`
      SELECT id, company, role,
             similarity(lower(company || ' ' || role), lower(${needle})) AS sim
        FROM "Application"
       WHERE "userId" = ${userId}
         AND "archivedAt" IS NULL
         AND similarity(lower(company || ' ' || role), lower(${needle})) > ${DUPLICATE_SIMILARITY_THRESHOLD}
       ORDER BY sim DESC
       LIMIT 3
    `,
  );

  return rows.map((r) => ({
    id: String(r.id),
    company: r.company,
    role: r.role,
    similarity: Number(r.sim),
  }));
}
