import { NextResponse } from "next/server";
import { bulkErrorResponse, readJson, requireBulkSession } from "@/lib/agent/bulk/http";
import { prismaBulkCommandRepository } from "@/lib/agent/bulk/prisma-repository";
import { createBulkPreview } from "@/lib/agent/bulk/service";
import { toBulkCommandSnapshot } from "@/lib/agent/bulk/snapshot";
import { bulkPreviewRequestSchema } from "@/lib/agent/bulk/validation";

export async function POST(request: Request) {
  const auth = await requireBulkSession();
  if ("response" in auth) return auth.response;
  try {
    const parsed = bulkPreviewRequestSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid bulk preview", issues: parsed.error.issues }, { status: 400 });
    }
    const headerKey = request.headers.get("idempotency-key") ?? undefined;
    const command = await createBulkPreview({
      repository: prismaBulkCommandRepository,
      userId: auth.session.userId,
      ...parsed.data,
      idempotencyKey: parsed.data.idempotencyKey ?? headerKey,
    });
    return NextResponse.json({ command: toBulkCommandSnapshot(command) }, { status: 201 });
  } catch (error) {
    return bulkErrorResponse(error);
  }
}
