import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireAuth } from "@/lib/session";
import { getDb } from "@/lib/db";
import { mergeCvData, generateCvPdf } from "@/lib/cv/generate";
import { uploadFile, deleteFile, fileExists } from "@/lib/storage";

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

  // Verify application ownership
  const app = await db.getApplication(applicationId, session.readScopeUserId);
  if (!app) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }

  // Get CV profile
  const profile = await db.getCvProfile(session.userId);
  if (!profile) {
    return NextResponse.json({ error: "No CV profile found. Create one via MCP first." }, { status: 404 });
  }

  // Get existing patch (must exist — created via MCP)
  const patch = await db.getCvPatch(applicationId);
  if (!patch) {
    return NextResponse.json({ error: "No CV patch found for this application. Generate one via MCP first." }, { status: 404 });
  }

  // Merge and generate PDF
  const merged = mergeCvData(profile, patch);
  const pdfBuffer = await generateCvPdf(merged);

  // Store PDF
  const filename = `${randomUUID()}.pdf`;
  const originalName = `CV - ${app.company} - ${app.role}.pdf`;
  await uploadFile(filename, Buffer.from(pdfBuffer), "application/pdf");

  // Replace existing CV document if present
  const existingDocs = await db.listDocumentsByApplication(applicationId, session.userId);
  const existingCv = existingDocs.find((d) => d.originalName.startsWith("CV - ") && d.mimeType === "application/pdf");
  if (existingCv) {
    if (await fileExists(existingCv.filename)) {
      await deleteFile(existingCv.filename);
    }
    await db.deleteDocument(existingCv.id, session.userId);
  }

  const doc = await db.createDocument(session.userId, {
    filename,
    originalName,
    size: pdfBuffer.length,
    mimeType: "application/pdf",
    applicationIds: [applicationId],
  });

  return NextResponse.json({
    documentId: doc.id,
    originalName: doc.originalName,
  });
}
