import { headers } from "next/headers";
import { auth } from "./auth";
import { NextRequest } from "next/server";

export async function getSession() {
  return auth.api.getSession({
    headers: await headers(),
  });
}

export async function requireAuth() {
  const session = await getSession();

  if (!session) {
    return null;
  }

  const allowedEmail = process.env.ALLOWED_EMAIL || "christian.pojoni@gmail.com";
  if (session.user.email !== allowedEmail) {
    return null;
  }

  return session;
}

/**
 * Accepts either a valid Google OAuth session or a valid ADMIN_API_TOKEN
 * bearer token. Returns a truthy value on success, null on failure.
 */
export async function requireAuthOrToken(request: NextRequest): Promise<object | null> {
  // 1. Check Bearer token first (fast path for API clients)
  const authHeader = request.headers.get("authorization") ?? "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const adminToken = process.env.ADMIN_API_TOKEN;
    if (adminToken && token === adminToken) {
      return { type: "api_token" };
    }
  }

  // 2. Fall back to session-based auth
  return requireAuth();
}
