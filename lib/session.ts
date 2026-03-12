import { headers } from "next/headers";
import { auth } from "./auth";
import { prisma } from "./prisma";
import { getDb } from "./db";
import { hashApiToken } from "./token";

export type SessionUser = {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  isAdmin: boolean;
};

export type SessionAuthResult = {
  userId: string;
  /** Use for read-only list/get operations. Null means global read access. */
  readScopeUserId: string | null;
  user: SessionUser;
};

function parseAllowedEmails(): string[] {
  return (process.env.ALLOWED_EMAIL ?? "")
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);
}

async function maybeBootstrapFirstAdmin(userId: string, email: string): Promise<boolean> {
  const allowedEmails = parseAllowedEmails();
  if (!allowedEmails.includes(email)) {
    return false;
  }

  // Use a serializable transaction to prevent race condition where two
  // concurrent first-login requests both see zero admins and both get promoted.
  return prisma.$transaction(async (tx) => {
    const adminCount = await tx.user.count({ where: { isAdmin: true } });
    if (adminCount > 0) {
      return false;
    }

    await tx.user.update({
      where: { id: userId },
      data: { isAdmin: true },
    });

    return true;
  });
}

export async function getSession() {
  return auth.api.getSession({
    headers: await headers(),
  });
}

/**
 * Requires a valid session or Bearer token. If ALLOWED_EMAIL is set
 * (comma-separated list), only those emails are permitted for session auth.
 * The first allowed user is bootstrapped as admin if no admin exists yet.
 */
export async function requireAuth(): Promise<SessionAuthResult | null> {
  // 1. Check Bearer token
  const headerList = await headers();
  const authHeader = headerList.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authenticateBearer(authHeader.slice(7));
  }

  // 2. Fall back to session cookie
  return authenticateSession();
}

async function authenticateBearer(raw: string): Promise<SessionAuthResult | null> {
  const hash = hashApiToken(raw);
  const token = await getDb().getApiTokenByHash(hash);
  if (!token) return null;

  const user = await prisma.user.findUnique({
    where: { id: token.userId },
    select: { id: true, name: true, email: true, image: true, isAdmin: true },
  });
  if (!user) return null;

  // Fire-and-forget: update lastUsedAt
  getDb().touchApiTokenLastUsed(token.id).catch(() => {});

  return {
    userId: user.id,
    readScopeUserId: user.isAdmin ? null : user.id,
    user: {
      id: user.id,
      name: user.name ?? null,
      email: user.email,
      image: user.image ?? null,
      isAdmin: user.isAdmin,
    },
  };
}

async function authenticateSession(): Promise<SessionAuthResult | null> {
  const session = await getSession();
  if (!session) return null;

  const allowedEmails = parseAllowedEmails();
  if (allowedEmails.length > 0 && !allowedEmails.includes(session.user.email)) {
    return null;
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isAdmin: true },
  });

  let isAdmin = dbUser?.isAdmin ?? false;
  if (!isAdmin) {
    isAdmin = await maybeBootstrapFirstAdmin(session.user.id, session.user.email);
  }

  return {
    userId: session.user.id,
    readScopeUserId: isAdmin ? null : session.user.id,
    user: {
      id: session.user.id,
      name: session.user.name ?? null,
      email: session.user.email,
      image: (session.user as { image?: string | null }).image ?? null,
      isAdmin,
    },
  };
}

export async function requireAdmin(): Promise<SessionAuthResult | null> {
  const session = await requireAuth();
  if (!session || !session.user.isAdmin) {
    return null;
  }

  return session;
}
