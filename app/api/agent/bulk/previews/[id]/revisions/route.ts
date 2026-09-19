import { NextResponse } from "next/server";
import { bulkErrorResponse, readJson, requireBulkSession } from "@/lib/agent/bulk/http";
import { prismaBulkCommandRepository } from "@/lib/agent/bulk/prisma-repository";
import { reviseBulkPreview } from "@/lib/agent/bulk/service";
import { toBulkCommandSnapshot } from "@/lib/agent/bulk/snapshot";
import { bulkRevisionRequestSchema } from "@/lib/agent/bulk/validation";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireBulkSession();
  if ("response" in auth) return auth.response;
  try {
    const parsed = bulkRevisionRequestSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid bulk revision", issues: parsed.error.issues }, { status: 400 });
    }
    const { id } = await context.params;
    const command = await reviseBulkPreview({
      repository: prismaBulkCommandRepository,
      userId: auth.session.userId,
      commandId: id,
      ...parsed.data,
      idempotencyKey: parsed.data.idempotencyKey ?? request.headers.get("idempotency-key") ?? undefined,
    });
    return NextResponse.json({ command: toBulkCommandSnapshot(command) }, { status: 201 });
  } catch (error) {
    return bulkErrorResponse(error);
  }
}
