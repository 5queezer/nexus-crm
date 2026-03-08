import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAuthOrToken } from "@/lib/session";
import { requireUserId } from "@/lib/tenant";
import { uploadFile } from "@/lib/storage";
import crypto from "crypto";
import path from "path";

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

export async function GET(request: NextRequest) {
  const auth = await requireAuthOrToken(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const documents = await getDb().listDocuments(auth.userId);
  return NextResponse.json(documents);
}

export async function POST(request: NextRequest) {
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

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const applicationIdsRaw = formData.get("applicationIds") as string | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "File too large (max 10 MB)" }, { status: 413 });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: "Unsupported file type. Allowed: PDF, JPEG, PNG, WEBP" },
      { status: 415 }
    );
  }

  const ext = path.extname(file.name) || ".pdf";
  const storedFilename = `${crypto.randomUUID()}${ext}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  await uploadFile(storedFilename, buffer, file.type);

  // Parse optional application IDs to link
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

  const document = await getDb().createDocument(userId, {
    filename: storedFilename,
    originalName: file.name.slice(0, 255),
    size: file.size,
    mimeType: file.type,
    applicationIds,
  });

  return NextResponse.json(document, { status: 201 });
}
