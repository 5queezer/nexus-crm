import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSessionAuth } from "@/lib/session";
import {
  deleteConnector,
  prismaConnectorRepository,
  saveConnector,
} from "@/lib/agent/connectors";

const schema = z.object({
  name: z.string().trim().min(1).max(80),
  url: z.string().url().max(2_000),
  authorization: z.string().max(2_000).nullable().optional(),
  enabled: z.boolean().optional(),
});

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireSessionAuth({ allowDevBypass: false });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid connector" }, { status: 400 });
  const { id } = await context.params;
  try {
    const connector = await saveConnector(prismaConnectorRepository, session.userId, {
      id,
      ...parsed.data,
    });
    return NextResponse.json({ connector });
  } catch (error) {
    const errorCode = error instanceof Error ? error.name.slice(0, 100) : "ConnectorSaveError";
    console.error("Failed to save connector", { connectorId: id, errorCode });
    const message = error instanceof Error ? error.message : "Connector could not be saved";
    return NextResponse.json(
      { error: message === "Connector not found" ? message : "Connector could not be saved" },
      { status: message === "Connector not found" ? 404 : 400 },
    );
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireSessionAuth({ allowDevBypass: false });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const deleted = await deleteConnector(prismaConnectorRepository, session.userId, id);
  if (!deleted) return NextResponse.json({ error: "Connector not found" }, { status: 404 });
  return new Response(null, { status: 204 });
}
