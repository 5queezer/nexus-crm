import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireSessionAuth } from "@/lib/session";
import { AgentRequestBodyError, readBoundedJson } from "@/lib/agent/request";

const BULK_JSON_REQUEST_LIMIT = 512 * 1024;

export async function requireBulkSession() {
  const session = await requireSessionAuth({ allowDevBypass: false });
  if (!session) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  const limit = checkRateLimit(`bulk:${session.userId}`, "applications");
  if (!limit.allowed) {
    return { response: NextResponse.json({ error: "Too many bulk requests" }, { status: 429 }) } as const;
  }
  return { session } as const;
}

export function bulkErrorResponse(error: unknown) {
  if (error instanceof AgentRequestBodyError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Bulk operation failed";
  // Prisma/driver diagnostics can contain SQL, input values and connection details.
  // Only short domain errors are suitable for the review interface.
  if (message.length > 240 || /[\r\n]/.test(message) || (error instanceof Error && /Prisma|Database|Driver/.test(error.name))) {
    return NextResponse.json({ error: "Bulk operation failed" }, { status: 500 });
  }
  if (message.includes("unavailable") || message.includes("not found")) {
    return NextResponse.json({ error: message }, { status: 404 });
  }
  if (
    message.includes("changed") ||
    message.includes("approval") ||
    message.includes("cannot be") ||
    message.includes("idempotency")
  ) {
    return NextResponse.json({ error: message }, { status: 409 });
  }
  if (
    message.includes("required") ||
    message.includes("Invalid") ||
    message.includes("unknown target") ||
    message.includes("time zone") ||
    message.includes("valid timestamp") ||
    message.includes("applicable targets") ||
    message.includes("scope") ||
    message.includes("duplicate") ||
    message.includes("target budget")
  ) {
    return NextResponse.json({ error: message }, { status: 400 });
  }
  return NextResponse.json({ error: "Bulk operation failed" }, { status: 500 });
}

export async function readJson(request: Request): Promise<unknown> {
  return readBoundedJson(request, BULK_JSON_REQUEST_LIMIT);
}
