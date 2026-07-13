import { deleteFile } from "@/lib/storage";
import type { DatabaseAdapter } from "@/lib/db/adapter";
import type { DocumentRecord } from "@/lib/db/types";

/**
 * Shared deletion path for REST and MCP. Database metadata is removed first so
 * callers cannot access a document that is being deleted; storage deletion is
 * idempotent and uses ignoreNotFound semantics.
 */
export async function deleteDocumentWithContent(
  db: DatabaseAdapter,
  id: string,
  userId: string,
): Promise<DocumentRecord | null> {
  const document = await db.deleteDocument(id, userId);
  if (!document) return null;
  await deleteFile(document.filename);
  return document;
}
