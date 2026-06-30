import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";

/**
 * Deprecated: global PUBLIC_READ_TOKEN based file/share access is disabled.
 * Share access must use per-user ShareLink codes (/s/[code]).
 */
export async function GET() {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(
    { error: "Public read tokens are disabled. Use per-link share URLs instead." },
    { status: 410 }
  );
}
