import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import { getDb } from "@/lib/db";
import { generateAndStoreCv } from "@/lib/cv/generate";

export async function POST(req: NextRequest) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const applicationId = body.applicationId as string;
  if (!applicationId) {
    return NextResponse.json({ error: "applicationId required" }, { status: 400 });
  }

  const db = getDb();

  const app = await db.getApplication(applicationId, session.readScopeUserId);
  if (!app) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }

  const profile = await db.getCvProfile(session.userId);
  if (!profile) {
    return NextResponse.json({ error: "No CV profile found. Create one via MCP first." }, { status: 404 });
  }

  const patch = await db.getCvPatch(applicationId, session.userId);
  if (!patch) {
    return NextResponse.json({ error: "No CV patch found for this application. Generate one via MCP first." }, { status: 404 });
  }

  const { doc } = await generateAndStoreCv({
    db,
    userId: session.userId,
    applicationId,
    company: app.company,
    role: app.role,
    profile,
    patch,
  });

  return NextResponse.json({
    documentId: doc.id,
    originalName: doc.originalName,
  });
}
