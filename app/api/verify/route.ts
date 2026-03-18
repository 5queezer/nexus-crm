import { NextRequest, NextResponse } from "next/server";
import { verifyTurnstile, createChallengeToken } from "@/lib/cloudflare";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const token = body?.token;
  if (typeof token !== "string" || !token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const ip =
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  const ok = await verifyTurnstile(token, ip);
  if (!ok) {
    return NextResponse.json({ error: "Challenge failed" }, { status: 403 });
  }

  const challengeCookie = createChallengeToken(ip);
  const res = NextResponse.json({ ok: true });
  res.cookies.set("cf_challenge", challengeCookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 3600, // 1 hour, matches token TTL
  });
  return res;
}
