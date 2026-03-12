import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import { getDb } from "@/lib/db";
import { generateShortCode } from "@/lib/token";

export async function POST(request: NextRequest) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { targetType, targetId } = body;

  if (!targetType || !["share_page", "document"].includes(targetType)) {
    return NextResponse.json({ error: "Invalid targetType" }, { status: 400 });
  }

  const resolvedTargetId = targetType === "document" ? targetId : null;

  if (targetType === "document" && !targetId) {
    return NextResponse.json({ error: "targetId required for document links" }, { status: 400 });
  }

  const db = getDb();

  // For document links, verify the document exists and belongs to the user
  if (targetType === "document") {
    const doc = await db.getDocument(targetId, session.user.id);
    if (!doc) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }

  // Reuse existing link if one already exists for this target
  const existing = await db.findShareLink(session.user.id, targetType, resolvedTargetId);
  if (existing) {
    return NextResponse.json(existing);
  }

  // Retry with new code on collision (unique constraint violation)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const link = await db.createShareLink(session.user.id, {
        code: generateShortCode(),
        targetType,
        targetId: resolvedTargetId,
      });
      return NextResponse.json(link, { status: 201 });
    } catch (err) {
      const isCollision =
        err instanceof Error && "code" in err && (err as { code: string }).code === "P2002";
      if (!isCollision || attempt === 2) throw err;
    }
  }

  return NextResponse.json({ error: "Failed to create share link" }, { status: 500 });
}
