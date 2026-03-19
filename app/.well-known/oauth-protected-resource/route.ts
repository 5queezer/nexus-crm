import { NextRequest, NextResponse } from "next/server";
import { getProtectedResourceMetadata } from "@/lib/mcp-oauth";

export async function GET(req: NextRequest) {
  const baseUrl = `${req.nextUrl.protocol}//${req.nextUrl.host}`;
  return NextResponse.json(getProtectedResourceMetadata(baseUrl), {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
