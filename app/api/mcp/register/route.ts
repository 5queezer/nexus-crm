import { NextRequest, NextResponse } from "next/server";
import { registerClient } from "@/lib/mcp-oauth";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body.redirect_uris || !Array.isArray(body.redirect_uris) || body.redirect_uris.length === 0) {
      return NextResponse.json(
        { error: "invalid_client_metadata", error_description: "redirect_uris is required" },
        { status: 400 }
      );
    }

    // Validate redirect URIs
    for (const uri of body.redirect_uris) {
      try {
        new URL(uri);
      } catch {
        return NextResponse.json(
          { error: "invalid_client_metadata", error_description: `Invalid redirect URI: ${uri}` },
          { status: 400 }
        );
      }
    }

    const result = await registerClient(body);
    return NextResponse.json(result, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "server_error", error_description: "Failed to register client" },
      { status: 500 }
    );
  }
}
