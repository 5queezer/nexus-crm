import { NextResponse } from "next/server";
import { requireBulkSession } from "@/lib/agent/bulk/http";
import { prismaBulkCommandRepository } from "@/lib/agent/bulk/prisma-repository";
import { toBulkCommandSnapshot } from "@/lib/agent/bulk/snapshot";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireBulkSession();
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const command = await prismaBulkCommandRepository.findCommand(auth.session.userId, id);
  if (!command) return NextResponse.json({ error: "Bulk command not found" }, { status: 404 });
  return NextResponse.json({ command: toBulkCommandSnapshot(command) });
}
