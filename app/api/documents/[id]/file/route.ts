import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAuth } from "@/lib/session";
import { downloadFile, fileExists } from "@/lib/storage";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Document file downloads always require proper authentication.
  // The PUBLIC_READ_TOKEN is intentionally NOT accepted here — it is
  // only meant for the read-only share page, not for downloading files.
  const auth = await requireAuth();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const document = await getDb().getDocument(id, auth.readScopeUserId);
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
    },
  });
}
