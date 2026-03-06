import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuthOrToken } from "@/lib/session";
import { userWhere, requireUserId } from "@/lib/tenant";
import { unlink } from "fs/promises";
import path from "path";

function getUploadDir(): string {
  return process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads");
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuthOrToken(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let userId: string;
  try {
    userId = requireUserId(auth.userId);
  } catch {
    return NextResponse.json({ error: "Session required" }, { status: 403 });
  }

  const { id } = await params;
  const docId = parseInt(id, 10);
  if (isNaN(docId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const document = await prisma.document.findFirst({
    where: { id: docId, userId },
  });
  if (!document) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Remove file from disk (best-effort)
  try {
    await unlink(path.join(getUploadDir(), document.filename));
  } catch {
    // file might already be gone — that's fine
  }

  await prisma.document.delete({ where: { id: docId, userId } });

  return new NextResponse(null, { status: 204 });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuthOrToken(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let userId: string;
  try {
    userId = requireUserId(auth.userId);
  } catch {
    return NextResponse.json({ error: "Session required" }, { status: 403 });
  }

  const { id } = await params;
  const docId = parseInt(id, 10);
  if (isNaN(docId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const body = await request.json();
  const { applicationIds } = body as { applicationIds?: number[] };

  if (!Array.isArray(applicationIds)) {
    return NextResponse.json({ error: "applicationIds must be an array" }, { status: 400 });
  }

  // Only allow linking applications that belong to this user
  const ownedApps = await prisma.application.findMany({
    where: { id: { in: applicationIds }, userId },
    select: { id: true },
  });
  const safeApplicationIds = ownedApps.map((a) => a.id);

  const document = await prisma.document.update({
    where: { id: docId, userId },
    data: {
      applications: {
        set: safeApplicationIds.map((aid) => ({ id: aid })),
      },
    },
    include: { applications: { select: { id: true, company: true, role: true } } },
  });

  return NextResponse.json(document);
}
