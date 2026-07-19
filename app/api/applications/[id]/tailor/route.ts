import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAuth } from "@/lib/session";
import { isConfigured, duplicateResume, getResumeEditUrl } from "@/lib/reactive-resume";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isConfigured()) {
    return NextResponse.json(
      { error: "Reactive Resume integration not configured" },
      { status: 501 }
    );
  }

  const { id } = await params;
  const db = getDb();
  const application = await db.getApplication(id, auth.userId);

  if (!application) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (application.resumeId) {
    return NextResponse.json({
      resumeId: application.resumeId,
      editUrl: getResumeEditUrl(application.resumeId),
    });
  }

  try {
    const name = `${application.company} — ${application.role}`;
    const resumeId = await duplicateResume(name);

    // Linking a resume advances the application's updatedAt; hand it back so
    // clients tracking an optimistic-concurrency baseline can refresh it.
    const updated = await db.updateApplication(id, auth.userId, { resumeId });

    return NextResponse.json({
      resumeId,
      editUrl: getResumeEditUrl(resumeId),
      updatedAt: updated.updatedAt.toISOString(),
    });
  } catch (err) {
    console.error("Failed to create tailored resume:", err);
    return NextResponse.json(
      { error: "Failed to create resume" },
      { status: 502 }
    );
  }
}
