import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { downloadFile, fileExists } from "@/lib/storage";

const NOT_FOUND = NextResponse.json({ error: "Not found" }, { status: 404 });

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const db = getDb();
  const link = await db.getShareLinkByCode(code);

  if (!link) {
    return NOT_FOUND;
  }

  if (link.targetType === "share_page") {
    const token = process.env.PUBLIC_READ_TOKEN;
    if (!token) {
      return NOT_FOUND;
    }
    const lang = request.nextUrl.searchParams.get("lang");
    const langParam = lang === "en" ? "&lang=en" : "";
    const url = new URL(`/share?token=${token}${langParam}`, request.url);
    return NextResponse.redirect(url);
  }

  if (link.targetType === "document" && link.targetId) {
    const doc = await db.getDocument(link.targetId, null);
    if (!doc || !(await fileExists(doc.filename))) {
      return NOT_FOUND;
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

  return NOT_FOUND;
}
