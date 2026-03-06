import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";

/**
 * Returns the PUBLIC_READ_TOKEN so authenticated users can construct
 * shareable download URLs client-side without the token being baked
 * into the JavaScript bundle.
 */
export async function GET(request: NextRequest) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = process.env.PUBLIC_READ_TOKEN ?? "";
  return NextResponse.json({ token });
}
