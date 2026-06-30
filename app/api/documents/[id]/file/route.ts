import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import { downloadFile } from "@/lib/storage";
import { loadOwnedDocument } from "@/lib/documents/fetch";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const result = await loadOwnedDocument(id, auth.readScopeUserId);
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
