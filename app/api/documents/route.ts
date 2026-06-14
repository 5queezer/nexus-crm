import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAuth } from "@/lib/session";
import {
  DocumentUploadError,
  MAX_DOCUMENT_UPLOAD_SIZE,
  uploadDocument,
} from "@/lib/documents/upload";

export async function GET(_request: NextRequest) {
  const auth = await requireAuth();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const documents = await getDb().listDocuments(auth.readScopeUserId);
  return NextResponse.json(documents);
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const applicationIdsRaw = formData.get("applicationIds") as string | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (file.size > MAX_DOCUMENT_UPLOAD_SIZE) {
    return NextResponse.json({ error: "File too large (max 10 MB)" }, { status: 413 });
  }

  let applicationIds: string[] = [];
  if (applicationIdsRaw) {
    try {
      const parsed = JSON.parse(applicationIdsRaw);
      if (Array.isArray(parsed)) {
        applicationIds = parsed.map(String).filter(Boolean);
      }
    } catch {
      // ignore malformed input
    }
  }

  try {
    const document = await uploadDocument({
      userId: auth.userId,
      originalName: file.name,
      mimeType: file.type,
      buffer: Buffer.from(await file.arrayBuffer()),
      applicationIds,
    });
    return NextResponse.json(document, { status: 201 });
  } catch (err) {
    if (err instanceof DocumentUploadError) {
      const status = err.code === "too_large" ? 413 : 415;
      return NextResponse.json({ error: err.message }, { status });
    }
    throw err;
  }
}
