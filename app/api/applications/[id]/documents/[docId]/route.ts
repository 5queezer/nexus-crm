import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAuth } from "@/lib/session";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  const auth = await requireAuth();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: applicationId, docId } = await params;
  const db = getDb();

  if (!(await db.verifyApplicationOwner(applicationId, auth.userId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const doc = await db.getDocument(docId, auth.userId);
  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  // Remove this application from the document's linked applications
  const remainingIds = (doc.applications ?? [])
    .map((a) => a.id)
    .filter((id) => id !== applicationId);

  await db.updateDocumentLinks(docId, auth.userId, remainingIds);

  return new NextResponse(null, { status: 204 });
}
