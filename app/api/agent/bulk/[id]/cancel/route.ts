import { bulkErrorResponse, requireBulkSession } from "@/lib/agent/bulk/http";
import { prismaBulkCommandRepository } from "@/lib/agent/bulk/prisma-repository";
import { requestBulkCancel } from "@/lib/agent/bulk/service";
import { toBulkCommandSnapshot } from "@/lib/agent/bulk/snapshot";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireBulkSession();
  if ("response" in auth) return auth.response;
  try {
    const { id } = await context.params;
    const command = await requestBulkCancel(prismaBulkCommandRepository, auth.session.userId, id);
    return Response.json({ command: toBulkCommandSnapshot(command) });
  } catch (error) {
    return bulkErrorResponse(error);
  }
}
