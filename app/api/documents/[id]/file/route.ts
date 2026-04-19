import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import { safeCompare } from "@/lib/token";
import { downloadFile } from "@/lib/storage";
import { loadOwnedDocument } from "@/lib/documents/fetch";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Allow access via session/Bearer auth OR via PUBLIC_READ_TOKEN query param
  // (used for shared document links).
  let readScopeUserId: string | null;

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
  const result = await loadOwnedDocument(id, readScopeUserId);
  if (!result.ok) {
    const message = result.reason === "not_found" ? "Not found" : "File not found on disk";
    return NextResponse.json({ error: message }, { status: 404 });
  }

  const { doc } = result;
  const buffer = await downloadFile(doc.filename);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(doc.originalName)}"`,
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, no-cache",
      "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
    },
  });
}
