import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAuth } from "@/lib/session";
import { safeCompare } from "@/lib/token";
import { downloadFile, fileExists } from "@/lib/storage";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Allow access via session/Bearer auth OR via PUBLIC_READ_TOKEN query param
  // (used for shared document links).
  let readScopeUserId: string | null | undefined;

  const auth = await requireAuth();
  if (auth) {
    readScopeUserId = auth.readScopeUserId;
  } else {
    const token = request.nextUrl.searchParams.get("token");
    const expectedToken = process.env.PUBLIC_READ_TOKEN;
    if (!token || !expectedToken || !safeCompare(token, expectedToken)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // Valid public token — allow access to any document (null = no user scope)
    readScopeUserId = null;
  }

  const { id } = await params;
  const document = await getDb().getDocument(id, readScopeUserId ?? null);
  if (!document) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!(await fileExists(document.filename))) {
    return NextResponse.json({ error: "File not found on disk" }, { status: 404 });
  }

  const buffer = await downloadFile(document.filename);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": document.mimeType,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(document.originalName)}"`,
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, no-cache",
      "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
    },
  });
}
