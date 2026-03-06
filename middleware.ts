import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  const ip = getClientIp(req);

  const group =
    pathname.startsWith("/api/auth") ? "auth"
    : pathname.startsWith("/api/applications") ? "applications"
    : null;

  if (group) {
    const result = checkRateLimit(ip, group);

    if (!result.allowed) {
      return new NextResponse(
        JSON.stringify({ error: "Too Many Requests" }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(Math.ceil((result.resetAt - Date.now()) / 1000)),
            "X-RateLimit-Limit": group === "auth" ? "10" : "60",
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
          },
        }
      );
    }

    const response = NextResponse.next();
    response.headers.set("X-RateLimit-Limit", group === "auth" ? "10" : "60");
    response.headers.set("X-RateLimit-Remaining", String(result.remaining));
    response.headers.set("X-RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)));
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/auth/:path*", "/api/applications/:path*"],
};
