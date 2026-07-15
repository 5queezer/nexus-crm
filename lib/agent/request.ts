export const AGENT_JSON_REQUEST_LIMIT = 64 * 1024;

export class AgentRequestBodyError extends Error {
  constructor(
    readonly status: 400 | 413,
    message: string,
  ) {
    super(message);
    this.name = "AgentRequestBodyError";
  }
}

export async function readBoundedJson(
  request: Request,
  maximumBytes = AGENT_JSON_REQUEST_LIMIT,
): Promise<unknown> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const bytes = Number(declaredLength);
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      throw new AgentRequestBodyError(400, "Invalid request body");
    }
    if (bytes > maximumBytes) {
      throw new AgentRequestBodyError(413, "Request body too large");
    }
  }

  if (!request.body) {
    throw new AgentRequestBodyError(400, "Invalid request body");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new AgentRequestBodyError(413, "Request body too large");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof AgentRequestBodyError) throw error;
    throw new AgentRequestBodyError(400, "Invalid request body");
  }

  const body = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    throw new AgentRequestBodyError(400, "Invalid request body");
  }
}

export function agentRequestErrorResponse(error: unknown): Response | null {
  if (!(error instanceof AgentRequestBodyError)) return null;
  return new Response(JSON.stringify({ error: error.message }), {
    status: error.status,
    headers: { "Content-Type": "application/json" },
  });
}
