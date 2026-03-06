import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuthOrToken } from "@/lib/session";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

function getUploadDir(): string {
  return process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads");
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Allow access via PUBLIC_READ_TOKEN query param (share page / readonly links)
  const queryToken = request.nextUrl.searchParams.get("token");
  const publicToken = process.env.PUBLIC_READ_TOKEN;
  const isPublicShare = publicToken && queryToken === publicToken;

  if (!isPublicShare) {
    const session = await requireAuthOrToken(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const { id } = await params;
  const docId = parseInt(id, 10);
  if (isNaN(docId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const document = await prisma.document.findUnique({ where: { id: docId } });
  if (!document) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const filePath = path.join(getUploadDir(), document.filename);
  if (!existsSync(filePath)) {
    return NextResponse.json({ error: "File not found on disk" }, { status: 404 });
  }

  const buffer = await readFile(filePath);

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": document.mimeType,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(document.originalName)}"`,
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, no-cache",
    },
  });
}
