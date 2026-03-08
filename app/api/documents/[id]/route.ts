import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAuthOrToken } from "@/lib/session";
import { requireUserId } from "@/lib/tenant";
import { deleteFile } from "@/lib/storage";

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

  const document = await getDb().deleteDocument(id, userId);
  if (!document) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Remove file from storage (best-effort)
  await deleteFile(document.filename);

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
  const body = await request.json();
  const { applicationIds } = body as { applicationIds?: string[] };

  if (!Array.isArray(applicationIds)) {
    return NextResponse.json({ error: "applicationIds must be an array" }, { status: 400 });
  }

  const document = await getDb().updateDocumentLinks(id, userId, applicationIds);
  return NextResponse.json(document);
}
