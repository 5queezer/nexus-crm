import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { downloadFile, fileExists } from "@/lib/storage";
import { sanitizeDocumentAssociations } from "@/lib/documents/provenance";

const MACHINE_DEMO_READ = { demoVisibility: "exclude" } as const;

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
    const lang = request.nextUrl.searchParams.get("lang");
    const langParam = lang === "en" ? "&lang=en" : "";
    const base = process.env.BETTER_AUTH_URL || request.url;
    const url = new URL(`/share?code=${encodeURIComponent(code)}${langParam}`, base);
    return NextResponse.redirect(url);
  }

  if (link.targetType === "document" && link.targetId) {
    const doc = await db.getDocument(link.targetId, link.userId);
    const visible = doc && doc.userId === link.userId && await sanitizeDocumentAssociations(
      doc,
      (applicationId) => db.getApplication(applicationId, link.userId, MACHINE_DEMO_READ),
    );
    if (!visible || !(await fileExists(doc.filename))) {
      return NOT_FOUND;
    }

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

  return NOT_FOUND;
}
