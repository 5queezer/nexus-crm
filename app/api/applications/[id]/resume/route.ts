import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getResumeEditUrl } from "@/lib/reactive-resume";
import { requireAuth } from "@/lib/session";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const application = await getDb().getApplication(id, auth.userId);
  if (!application?.resumeId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.redirect(getResumeEditUrl(application.resumeId));
}
