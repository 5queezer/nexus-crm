import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAuth } from "@/lib/session";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: applicationId } = await params;
  const db = getDb();

  if (!(await db.verifyApplicationOwner(applicationId, auth.userId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const documents = await db.listDocumentsByApplication(applicationId, auth.userId);
  return NextResponse.json(documents);
}
