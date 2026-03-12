import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { downloadFile, fileExists } from "@/lib/storage";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const db = getDb();
  const link = await db.getShareLinkByCode(code);

  if (!link) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (link.targetType === "share_page") {
    const lang = request.nextUrl.searchParams.get("lang");
    const langParam = lang === "en" ? "&lang=en" : "";
    const token = process.env.PUBLIC_READ_TOKEN;
    if (!token) {
      return NextResponse.json({ error: "Share not configured" }, { status: 500 });
    }
    const url = new URL(`/share?token=${token}${langParam}`, request.url);
    return NextResponse.redirect(url);
  }

  if (link.targetType === "document" && link.targetId) {
    const doc = await db.getDocument(link.targetId, null);
    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    if (!(await fileExists(doc.filename))) {
      return NextResponse.json({ error: "File not found on disk" }, { status: 404 });
    }

    const buffer = await downloadFile(doc.filename);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": doc.mimeType,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(doc.originalName)}"`,
        "Content-Length": String(buffer.length),
        "Cache-Control": "private, no-cache",
      },
    });
  }

  return NextResponse.json({ error: "Invalid link" }, { status: 400 });
}
