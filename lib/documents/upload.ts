import crypto from "crypto";
import { getDb } from "@/lib/db";
import { deleteFile, uploadFile } from "@/lib/storage";
import type { DocumentRecord } from "@/lib/db/types";

export const MAX_DOCUMENT_UPLOAD_SIZE = 10 * 1024 * 1024;
export const MAX_DOCUMENT_BASE64_SIZE = Math.ceil(MAX_DOCUMENT_UPLOAD_SIZE / 3) * 4 + 4;
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
  if (normalized.length > MAX_DOCUMENT_BASE64_SIZE) {
    throw new DocumentUploadError("too_large", "File too large (max 10 MB)");
  }
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

function matchesMimeSignature(buffer: Buffer, mimeType: string): boolean {
  if (mimeType === "application/pdf") return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  if (mimeType === "image/jpeg") {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimeType === "image/png") {
    return buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  }
  if (mimeType === "image/webp") {
    return buffer.subarray(0, 4).toString("ascii") === "RIFF"
      && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  }
  return false;
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
  if (!matchesMimeSignature(buffer, mimeType)) {
    throw new DocumentUploadError("unsupported_type", "File bytes do not match the declared MIME type");
  }

  const ext = MIME_TO_EXT[mimeType] || ".pdf";
  const storedFilename = `${crypto.randomUUID()}${ext}`;
  await uploadFile(storedFilename, buffer, mimeType);
  try {
    return await getDb().createDocument(userId, {
      filename: storedFilename,
      originalName: originalName.slice(0, 255),
      size: buffer.length,
      mimeType,
      applicationIds,
      documentType: "other",
      state: "current",
      version: 1,
      contentHash: crypto.createHash("sha256").update(buffer).digest("hex"),
      source: "upload",
    });
  } catch (error) {
    await deleteFile(storedFilename).catch(() => {});
    throw error;
  }
}

export async function uploadDocumentContent(
  args: {
    filename: string;
    mimeType: string;
    contentBase64: string;
    applicationIds?: string[];
  },
  userId: string,
  sanitizeDocument?: (document: DocumentRecord) => Promise<DocumentRecord | null>,
): Promise<McpToolResponse> {
  try {
    const doc = await uploadDocument({
      userId,
      originalName: args.filename,
      mimeType: args.mimeType,
      buffer: decodeBase64Content(args.contentBase64),
      applicationIds: args.applicationIds,
    });
    const visible = sanitizeDocument ? await sanitizeDocument(doc) : doc;
    if (!visible) {
      return { content: [{ type: "text", text: "Application not found or access denied" }], isError: true };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(visible, null, 2) }],
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
