import { NextResponse } from "next/server";
import { requireSessionAuth } from "@/lib/session";
import {
  getConnectorSecret,
  prismaConnectorRepository,
  recordConnectorHealth,
} from "@/lib/agent/connectors";
import { discoverMcpTools } from "@/lib/agent/mcp-client";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireSessionAuth({ allowDevBypass: false });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const connector = await getConnectorSecret(prismaConnectorRepository, session.userId, id);
  if (!connector) return NextResponse.json({ error: "Connector not found" }, { status: 404 });
  try {
    const tools = await discoverMcpTools(connector);
    const health = await recordConnectorHealth(prismaConnectorRepository, session.userId, id, "healthy");
    return NextResponse.json({ tools, health });
  } catch {
    const health = await recordConnectorHealth(prismaConnectorRepository, session.userId, id, "failed");
    console.error("Connector discovery failed", { connectorId: id, errorCode: health.lastErrorCode });
    return NextResponse.json({ error: "Connector discovery failed", health }, { status: 502 });
  }
}
