import { downloadFile, getSignedDownloadUrl, isGcsBacked } from "@/lib/storage";
import { loadOwnedDocument } from "./fetch";

export const INLINE_DOWNLOAD_LIMIT = 1024 * 1024; // 1 MB

export type McpToolResponse = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

/**
 * Tool logic for the MCP download_document_content tool, extracted so it can
 * be unit-tested without spinning up the MCP transport.
 */
export async function downloadDocumentContent(
  id: string,
  readScopeUserId: string | null,
): Promise<McpToolResponse> {
  const result = await loadOwnedDocument(id, readScopeUserId);
  if (!result.ok) {
    const text =
      result.reason === "not_found"
        ? "Document not found or access denied"
        : "Document file is missing from storage";
    return { content: [{ type: "text", text }], isError: true };
  }

  const { doc } = result;

  if (doc.size > INLINE_DOWNLOAD_LIMIT && isGcsBacked()) {
    const signedUrl = await getSignedDownloadUrl(doc.filename);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              id: doc.id,
              filename: doc.originalName,
              mimeType: doc.mimeType,
              size: doc.size,
              signedUrl,
              expiresInSeconds: 300,
              note: "File exceeds 1MB inline limit; use the signed URL to download the binary directly.",
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  const buffer = await downloadFile(doc.filename);
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            id: doc.id,
            filename: doc.originalName,
            mimeType: doc.mimeType,
            size: doc.size,
            contentBase64: buffer.toString("base64"),
          },
          null,
          2,
        ),
      },
    ],
  };
}
