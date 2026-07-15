import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAuth } from "@/lib/session";
import {
  DocumentUploadError,
  MAX_DOCUMENT_UPLOAD_SIZE,
  uploadDocument,
} from "@/lib/documents/upload";

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const rawPage = params.has("page") ? Number(params.get("page")) : undefined;
  const rawPageSize = params.has("pageSize") ? Number(params.get("pageSize")) : undefined;
  if (
    (rawPage !== undefined && (!Number.isInteger(rawPage) || rawPage < 1)) ||
    (rawPageSize !== undefined && (!Number.isInteger(rawPageSize) || rawPageSize < 1 || rawPageSize > 200))
  ) {
    return NextResponse.json({ error: "Invalid pagination parameters" }, { status: 400 });
  }
  const documents = await getDb().listDocumentsFiltered(auth.readScopeUserId, {
    applicationId: params.get("applicationId") ?? undefined,
    documentType: params.get("documentType") ?? undefined,
    state: params.get("state") ?? undefined,
    submissionId: params.get("submissionId") ?? undefined,
    orphaned: params.has("orphaned") ? params.get("orphaned") === "true" : undefined,
    fields: params.get("fields")?.split(",").map((field) => field.trim()).filter(Boolean),
    page: rawPage,
    pageSize: rawPageSize,
  });
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
