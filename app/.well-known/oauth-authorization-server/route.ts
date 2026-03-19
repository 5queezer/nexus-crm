import { NextRequest, NextResponse } from "next/server";
import { getOAuthMetadata } from "@/lib/mcp-oauth";

export async function GET(req: NextRequest) {
  const baseUrl = `${req.nextUrl.protocol}//${req.nextUrl.host}`;
  return NextResponse.json(getOAuthMetadata(baseUrl), {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
