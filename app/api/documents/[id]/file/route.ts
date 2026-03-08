import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAuthOrToken } from "@/lib/session";
import { downloadFile, fileExists } from "@/lib/storage";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Allow access via PUBLIC_READ_TOKEN query param (share page / readonly links)
  const queryToken = request.nextUrl.searchParams.get("token");
  const publicToken = process.env.PUBLIC_READ_TOKEN;
  const isPublicShare = publicToken && queryToken === publicToken;

  let userId: string | null = null;

  if (!isPublicShare) {
    const auth = await requireAuthOrToken(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    userId = auth.userId;
  }

  const { id } = await params;

  const document = await getDb().getDocument(id, userId);
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
