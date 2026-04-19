import { getDb } from "@/lib/db";
import { fileExists } from "@/lib/storage";
import type { DocumentRecord } from "@/lib/db/types";

export type OwnedDocumentResult =
  | { ok: true; doc: DocumentRecord }
  | { ok: false; reason: "not_found" | "file_missing" };

/**
 * Resolve a document the caller is allowed to read and confirm the underlying
 * file still exists in storage. Shared by the /file HTTP route and the MCP
 * download_document_content tool so both enforce the same ownership + existence
 * checks.
 */
export async function loadOwnedDocument(
  id: string,
  readScopeUserId: string | null,
): Promise<OwnedDocumentResult> {
  const doc = await getDb().getDocument(id, readScopeUserId);
  if (!doc) return { ok: false, reason: "not_found" };
  if (!(await fileExists(doc.filename))) {
    return { ok: false, reason: "file_missing" };
  }
  return { ok: true, doc };
}
