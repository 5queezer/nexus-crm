import { NextRequest, NextResponse } from "next/server";
import { safeCompare } from "@/lib/token";
import { requireAuth } from "@/lib/session";
import { scanAllInboxes, scanUserInbox } from "@/lib/email/scanner";

/**
 * POST /api/email/scan
 *
 * Two modes:
 * 1. Scheduled scan (all users): Authenticated via EMAIL_SCAN_SECRET header
 * 2. Manual scan (single user): Authenticated via session/bearer token
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // Check for scheduled scan secret
  const scanSecret = req.headers.get("x-scan-secret");
  const expectedSecret = process.env.EMAIL_SCAN_SECRET;

  if (scanSecret && expectedSecret && safeCompare(scanSecret, expectedSecret)) {
    // Scheduled scan: process all enabled users
    const results = await scanAllInboxes();
    return NextResponse.json({ results });
  }

  // Manual scan: authenticate as user
  const auth = await requireAuth();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await scanUserInbox(auth.userId);
  return NextResponse.json({ result });
}
