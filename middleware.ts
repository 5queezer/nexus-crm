import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { verifyChallengeToken } from "@/lib/cloudflare";

/**
 * Resolve the real client IP. When behind Cloudflare, the CF-Connecting-IP
 * header is set by the edge and cannot be spoofed by the client (unlike
 * X-Forwarded-For which any upstream proxy — or the client — can forge).
 */
function getClientIp(req: NextRequest): string {
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

/**
 * Public routes that require a Turnstile challenge before access.
 * The challenge cookie is set by /api/verify after the user passes Turnstile.
 */
function requiresTurnstile(pathname: string): boolean {
  if (!process.env.TURNSTILE_SECRET_KEY) return false;
  return pathname.startsWith("/s/") || pathname === "/share";
}

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  const ip = getClientIp(req);

  // --- Turnstile challenge gate for public routes ---
  if (requiresTurnstile(pathname)) {
    const cookie = req.cookies.get("cf_challenge")?.value;
    if (!cookie || !verifyChallengeToken(cookie, ip)) {
      const verifyUrl = req.nextUrl.clone();
      verifyUrl.pathname = "/verify";
      verifyUrl.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
      return NextResponse.redirect(verifyUrl);
    }
  }

  // --- Rate limiting ---
  const group =
    pathname.startsWith("/api/auth") ? "auth"
    : pathname.startsWith("/api/admin") ? "admin"
    : pathname.startsWith("/api/applications") ? "applications"
    : pathname.startsWith("/api/documents") ? "documents"
    : pathname.startsWith("/api/email") ? "email"
    : pathname.startsWith("/s/") ? "general"
    : pathname.startsWith("/api/") ? "general"
    : null;

  if (group) {
    const result = checkRateLimit(ip, group);
    const limit = group === "auth" ? "10" : group === "admin" ? "20" : group === "applications" ? "60" : group === "email" ? "20" : "30";

    if (!result.allowed) {
      return new NextResponse(
        JSON.stringify({ error: "Too Many Requests" }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(Math.ceil((result.resetAt - Date.now()) / 1000)),
            "X-RateLimit-Limit": limit,
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
          },
        }
      );
    }

    const response = NextResponse.next();
    response.headers.set("X-RateLimit-Limit", limit);
    response.headers.set("X-RateLimit-Remaining", String(result.remaining));
    response.headers.set("X-RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)));
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*", "/s/:path*", "/share", "/verify"],
};
