import { NextRequest, NextResponse } from "next/server";
import { getProtectedResourceMetadata, getPublicBaseUrl } from "@/lib/mcp-oauth";

// RFC 9728 §3.1: clients append the resource path to the well-known URI.
// E.g. resource https://host/api/mcp → discovery at /.well-known/oauth-protected-resource/api/mcp.
// Serve the same metadata on any sub-path so MCP clients that follow the
// spec strictly (ChatGPT) and lenient ones (Claude.ai) both succeed.
export async function GET(req: NextRequest) {
  const baseUrl = getPublicBaseUrl(req);
  return NextResponse.json(getProtectedResourceMetadata(baseUrl), {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
