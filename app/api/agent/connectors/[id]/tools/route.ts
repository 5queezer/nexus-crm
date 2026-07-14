import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import {
  getConnectorSecret,
  prismaConnectorRepository,
} from "@/lib/agent/connectors";
import { discoverMcpTools } from "@/lib/agent/mcp-client";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireAuth({ allowDevBypass: false });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const connector = await getConnectorSecret(prismaConnectorRepository, session.userId, id);
  if (!connector) return NextResponse.json({ error: "Connector not found" }, { status: 404 });
  try {
    const tools = await discoverMcpTools(connector);
    return NextResponse.json({ tools });
  } catch {
    return NextResponse.json({ error: "Connector discovery failed" }, { status: 502 });
  }
}
