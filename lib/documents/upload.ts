import crypto from "crypto";
import { getDb } from "@/lib/db";
import { uploadFile } from "@/lib/storage";
import type { DocumentRecord } from "@/lib/db/types";

export const MAX_DOCUMENT_UPLOAD_SIZE = 10 * 1024 * 1024; // 10 MB
export const ALLOWED_DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

const MIME_TO_EXT: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

export type DocumentUploadErrorCode =
  | "invalid_base64"
  | "too_large"
  | "unsupported_type";

export class DocumentUploadError extends Error {
  constructor(
    readonly code: DocumentUploadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DocumentUploadError";
  }
}

export type UploadDocumentInput = {
  userId: string;
  originalName: string;
  mimeType: string;
  buffer: Buffer;
  applicationIds?: string[];
};

export type McpToolResponse = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

export function decodeBase64Content(contentBase64: string): Buffer {
  const normalized = contentBase64.replace(/\s/g, "");
  if (!normalized || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new DocumentUploadError("invalid_base64", "Invalid base64 content");
  }

  const decoded = Buffer.from(normalized, "base64");
  const encoded = decoded.toString("base64");
  if (encoded.replace(/=+$/, "") !== normalized.replace(/=+$/, "")) {
    throw new DocumentUploadError("invalid_base64", "Invalid base64 content");
  }

  return decoded;
}

export async function uploadDocument({
  userId,
  originalName,
  mimeType,
  buffer,
  applicationIds = [],
}: UploadDocumentInput): Promise<DocumentRecord> {
  if (buffer.length > MAX_DOCUMENT_UPLOAD_SIZE) {
    throw new DocumentUploadError("too_large", "File too large (max 10 MB)");
  }

  if (!ALLOWED_DOCUMENT_MIME_TYPES.includes(mimeType as (typeof ALLOWED_DOCUMENT_MIME_TYPES)[number])) {
    throw new DocumentUploadError(
      "unsupported_type",
      "Unsupported file type. Allowed: PDF, JPEG, PNG, WEBP",
    );
  }

  const ext = MIME_TO_EXT[mimeType] || ".pdf";
  const storedFilename = `${crypto.randomUUID()}${ext}`;
  await uploadFile(storedFilename, buffer, mimeType);

  return getDb().createDocument(userId, {
    filename: storedFilename,
    originalName: originalName.slice(0, 255),
    size: buffer.length,
    mimeType,
    applicationIds,
  });
}

export async function uploadDocumentContent(
  args: {
    filename: string;
    mimeType: string;
    contentBase64: string;
    applicationIds?: string[];
  },
  userId: string,
): Promise<McpToolResponse> {
  try {
    const doc = await uploadDocument({
      userId,
      originalName: args.filename,
      mimeType: args.mimeType,
      buffer: decodeBase64Content(args.contentBase64),
      applicationIds: args.applicationIds,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(doc, null, 2) }],
    };
  } catch (err) {
    if (err instanceof DocumentUploadError) {
      return {
        content: [{ type: "text", text: err.message }],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: "Failed to upload document" }],
      isError: true,
    };
  }
}
