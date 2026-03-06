import { headers } from "next/headers";
import { auth } from "./auth";
import { NextRequest } from "next/server";

export type SessionUser = {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
};

/** Result from requireAuth() — always has a real user */
export type SessionAuthResult = {
  userId: string;
  user: SessionUser;
};

/** Result from requireAuthOrToken() — may be admin token (no user) */
export type AuthResult = SessionAuthResult | { userId: null };

export async function getSession() {
  return auth.api.getSession({
    headers: await headers(),
  });
}

/**
 * Requires a valid session. If ALLOWED_EMAIL is set (comma-separated list),
 * only those emails are permitted. If unset, any Google-authenticated user is allowed.
 *
 * Returns { userId, user } on success, null on failure.
 */
export async function requireAuth(): Promise<SessionAuthResult | null> {
  const session = await getSession();
  if (!session) return null;

  const allowedEmails = process.env.ALLOWED_EMAIL;
  if (allowedEmails) {
    const list = allowedEmails.split(",").map((e) => e.trim());
    if (!list.includes(session.user.email)) {
      return null;
    }
  }

  return {
    userId: session.user.id,
    user: {
      id: session.user.id,
      name: session.user.name ?? null,
      email: session.user.email,
      image: (session.user as { image?: string | null }).image ?? null,
    },
  };
}

/**
 * Accepts either a valid session or a valid ADMIN_API_TOKEN bearer token.
 * - Session: returns { userId: string, user: SessionUser }
 * - API token: returns { userId: null } (admin, no user scoping)
 * - Neither: returns null (unauthorized)
 */
export async function requireAuthOrToken(
  request: NextRequest
): Promise<AuthResult | null> {
  // 1. Check Bearer token first (fast path for API clients)
  const authHeader = request.headers.get("authorization") ?? "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const adminToken = process.env.ADMIN_API_TOKEN;
    if (adminToken && token === adminToken) {
      return { userId: null };
    }
  }

  // 2. Fall back to session-based auth
  return requireAuth();
}
