import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/session";
import {
  listConnectorMetadata,
  prismaConnectorRepository,
  saveConnector,
} from "@/lib/agent/connectors";

const schema = z.object({
  name: z.string().trim().min(1).max(80),
  url: z.string().url().max(2_000),
  authorization: z.string().max(2_000).nullable().optional(),
  enabled: z.boolean().optional(),
});

export async function GET() {
  const session = await requireAuth({ allowDevBypass: false });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const connectors = await listConnectorMetadata(prismaConnectorRepository, session.userId);
  return NextResponse.json({ connectors });
}

export async function POST(request: Request) {
  const session = await requireAuth({ allowDevBypass: false });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid connector" }, { status: 400 });
  try {
    const connector = await saveConnector(prismaConnectorRepository, session.userId, parsed.data);
    return NextResponse.json({ connector }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error && error.message === "Unsafe MCP destination"
      ? error.message
      : "Connector could not be saved";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
