import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireSessionAuth } from "@/lib/session";
import { CAREER_OPS_JSON_BODY_LIMIT } from "./config";
import { CareerOpsServiceError, type CareerOpsSession } from "./service";

/**
 * Shared plumbing for the Career Ops BFF.
 *
 * Every response body is authored here. Upstream text never reaches the client:
 * `CareerOpsServiceError` carries only Nexus-controlled messages, and anything
 * else collapses to a generic failure.
 */

const STATUS_BY_CODE: Record<string, number> = {
  unavailable: 503,
  not_found: 404,
  invalid_request: 400,
  conflict: 409,
  rate_limited: 429,
  upstream_error: 502,
};

export class CareerOpsBodyError extends Error {
  constructor(readonly status: 400 | 413) {
    super(status === 413 ? "Request body too large" : "Invalid request body");
  }
}

export function careerOpsErrorResponse(reason: unknown): NextResponse {
  if (reason instanceof CareerOpsBodyError) {
    return NextResponse.json({ error: reason.message }, { status: reason.status });
  }
  if (reason instanceof CareerOpsServiceError) {
    const status = STATUS_BY_CODE[reason.code] ?? 502;
    const headers =
      reason.retryAfterSeconds !== null
        ? { "Retry-After": String(reason.retryAfterSeconds) }
        : undefined;
    return NextResponse.json({ error: reason.code, message: reason.message }, { status, headers });
  }
  return NextResponse.json({ error: "upstream_error", message: "Career Ops failed" }, { status: 502 });
}

/**
 * Career Ops is a browser feature: API tokens and MCP OAuth credentials must
 * not be able to drive a privileged remote agent on a user's behalf.
 */
export async function requireCareerOpsSession(): Promise<CareerOpsSession | null> {
  const session = await requireSessionAuth({ allowDevBypass: false });
  if (!session) return null;
  return { userId: session.userId, user: { isAdmin: session.user.isAdmin } };
}

export function unauthorized(): NextResponse {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

/**
 * Per-user limiting. Keying on the authenticated user rather than the source
 * address avoids pooling every client behind one shared proxy address into a
 * single bucket that any one of them could exhaust.
 */
export function enforceCareerOpsRateLimit(session: CareerOpsSession): NextResponse | null {
  const limit = checkRateLimit(`career-ops:${session.userId}`, "general");
  if (limit.allowed) return null;
  const retryAfter = Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000));
  return NextResponse.json(
    { error: "rate_limited", message: "Too many Career Ops requests" },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}

export async function readCareerOpsBody(request: Request): Promise<Record<string, unknown>> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const bytes = Number(declared);
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new CareerOpsBodyError(400);
    if (bytes > CAREER_OPS_JSON_BODY_LIMIT) throw new CareerOpsBodyError(413);
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    throw new CareerOpsBodyError(400);
  }
  if (raw.length > CAREER_OPS_JSON_BODY_LIMIT) throw new CareerOpsBodyError(413);
  if (!raw.trim()) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CareerOpsBodyError(400);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CareerOpsBodyError(400);
  }
  return parsed as Record<string, unknown>;
}

export function optionalString(value: unknown, maximum: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new CareerOpsBodyError(400);
  return value.slice(0, maximum);
}
