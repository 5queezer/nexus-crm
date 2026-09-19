import { NextResponse } from "next/server";
import { bulkErrorResponse, readJson, requireBulkSession } from "@/lib/agent/bulk/http";
import { prismaBulkCommandRepository } from "@/lib/agent/bulk/prisma-repository";
import { queueBulkCommand } from "@/lib/agent/bulk/service";
import { toBulkCommandSnapshot } from "@/lib/agent/bulk/snapshot";
import { bulkDigestRequestSchema } from "@/lib/agent/bulk/validation";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireBulkSession();
  if ("response" in auth) return auth.response;
  try {
    const parsed = bulkDigestRequestSchema.safeParse(await readJson(request));
    if (!parsed.success) return NextResponse.json({ error: "Invalid execution request" }, { status: 400 });
    const { id } = await context.params;
    const command = await queueBulkCommand(prismaBulkCommandRepository, auth.session.userId, id, parsed.data.digest);
    return NextResponse.json({ command: toBulkCommandSnapshot(command) }, { status: 202 });
  } catch (error) {
    return bulkErrorResponse(error);
  }
}
