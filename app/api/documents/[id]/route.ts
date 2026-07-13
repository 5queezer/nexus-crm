import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAuth } from "@/lib/session";
import { deleteDocumentWithContent } from "@/lib/documents/service";

function documentMutationError(error: unknown) {
  const code = error instanceof Error ? error.message : "document_update_failed";
  if (code === "not_found") {
    return NextResponse.json({ error: code }, { status: 404 });
  }
  if (code === "submitted_document_immutable") {
    return NextResponse.json({ error: code }, { status: 409 });
  }
  if (code === "invalid_applications" || code === "submitted_state_reserved") {
    return NextResponse.json({ error: code }, { status: 400 });
  }
  return NextResponse.json({ error: "document_update_failed" }, { status: 500 });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const document = await deleteDocumentWithContent(getDb(), id, auth.userId);
    if (!document) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof Error && error.message === "submitted_document_immutable") {
      return NextResponse.json({ error: "Submitted and historical documents are immutable" }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to delete document" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const {
    applicationIds,
    originalName,
    documentType,
    state,
    version,
    contentHash,
    source,
    generatedAt,
    submittedAt,
  } = body as Record<string, unknown>;

  // Rename
  if (typeof originalName === "string") {
    const trimmed = originalName.trim();
    if (trimmed.length === 0 || trimmed.length > 255) {
      return NextResponse.json({ error: "originalName must be 1-255 characters" }, { status: 400 });
    }
    try {
      const document = await getDb().renameDocument(id, auth.userId, trimmed);
      if (!document) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      return NextResponse.json(document);
    } catch (error) {
      return documentMutationError(error);
    }
  }

  const metadataKeys = [
    "documentType", "state", "version", "contentHash", "source", "generatedAt", "submittedAt",
  ];
  if (metadataKeys.some((key) => body[key] !== undefined)) {
    const validStates = new Set(["draft", "current", "submitted", "superseded", "historical", "orphaned"]);
    if (state !== undefined && (typeof state !== "string" || !validStates.has(state))) {
      return NextResponse.json({ error: "Invalid document state" }, { status: 400 });
    }
    const parsedVersion = version === undefined ? undefined : Number(version);
    if (parsedVersion !== undefined && (!Number.isInteger(parsedVersion) || parsedVersion < 1)) {
      return NextResponse.json({ error: "version must be a positive integer" }, { status: 400 });
    }
    if (contentHash !== undefined && contentHash !== null && !/^[a-f0-9]{64}$/i.test(String(contentHash))) {
      return NextResponse.json({ error: "contentHash must be a 64-character hexadecimal SHA-256 hash" }, { status: 400 });
    }
    const parseDocumentDate = (value: unknown) =>
      value === undefined ? undefined : value === null ? null : new Date(String(value));
    const parsedGeneratedAt = parseDocumentDate(generatedAt);
    const parsedSubmittedAt = parseDocumentDate(submittedAt);
    if (
      (parsedGeneratedAt instanceof Date && Number.isNaN(parsedGeneratedAt.getTime()))
      || (parsedSubmittedAt instanceof Date && Number.isNaN(parsedSubmittedAt.getTime()))
    ) {
      return NextResponse.json({ error: "Document timestamps must be valid ISO 8601 dates" }, { status: 400 });
    }
    try {
      const document = await getDb().updateDocumentMetadata(id, auth.userId, {
        ...(documentType !== undefined && { documentType: String(documentType).slice(0, 100) }),
        ...(state !== undefined && { state: String(state) }),
        ...(parsedVersion !== undefined && { version: parsedVersion }),
        ...(contentHash !== undefined && {
          contentHash: contentHash ? String(contentHash) : null,
        }),
        ...(source !== undefined && { source: source ? String(source).slice(0, 100) : null }),
        ...(generatedAt !== undefined && {
          generatedAt: parsedGeneratedAt,
        }),
        ...(submittedAt !== undefined && {
          submittedAt: parsedSubmittedAt,
        }),
      });
      return NextResponse.json(document);
    } catch (error) {
      return documentMutationError(error);
    }
  }

  // Update application links
  if (!Array.isArray(applicationIds)) {
    return NextResponse.json({ error: "applicationIds must be an array or originalName must be a string" }, { status: 400 });
  }

  try {
    const document = await getDb().updateDocumentLinks(id, auth.userId, applicationIds);
    return NextResponse.json(document);
  } catch (error) {
    return documentMutationError(error);
  }
}
