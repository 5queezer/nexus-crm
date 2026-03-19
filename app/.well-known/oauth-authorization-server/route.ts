import { NextRequest, NextResponse } from "next/server";
import { getOAuthMetadata, getPublicBaseUrl } from "@/lib/mcp-oauth";

export async function GET(req: NextRequest) {
  const baseUrl = getPublicBaseUrl(req);
  return NextResponse.json(getOAuthMetadata(baseUrl), {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
