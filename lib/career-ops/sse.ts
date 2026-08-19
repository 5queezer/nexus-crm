import { redactUpstreamError } from "./config";

/**
 * Hermes `/v1/runs/{id}/events` framing.
 *
 * Verified against the upstream server: every frame is `data: <json>` with no
 * `event:` line, so the discriminator lives in the JSON `event` field. Comment
 * frames (`: keepalive`, `: stream closed`) carry no payload.
 */

const APPROVAL_CHOICES = ["once", "session", "always", "deny"] as const;
export type CareerOpsApprovalChoice = (typeof APPROVAL_CHOICES)[number];

export type CareerOpsEvent =
  | { type: "delta"; text: string }
  | { type: "tool_started"; tool: string }
  | { type: "tool_completed"; tool: string; durationMs: number | null; failed: boolean }
  | {
      type: "approval_required";
      operation: string;
      summary: string;
      details: string;
      choices: CareerOpsApprovalChoice[];
    }
  | { type: "approval_resolved"; choice: string }
  | { type: "completed"; output: string }
  | { type: "failed"; message: string }
  | { type: "cancelled" }
  | { type: "status"; status: string }
  | { type: "error"; message: string };

/** Incremental SSE frame reader. Feed it decoded text chunks in arrival order. */
export class SseFrameParser {
  private buffer = "";

  push(chunk: string): string[] {
    this.buffer += chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const frames: string[] = [];
    let separator = this.buffer.indexOf("\n\n");
    while (separator !== -1) {
      const raw = this.buffer.slice(0, separator);
      this.buffer = this.buffer.slice(separator + 2);
      const payload = readDataLines(raw);
      if (payload !== null) frames.push(payload);
      separator = this.buffer.indexOf("\n\n");
    }
    return frames;
  }

  /** Emit a final frame that the upstream closed without a blank line. */
  flush(): string[] {
    const remainder = this.buffer;
    this.buffer = "";
    if (!remainder.trim()) return [];
    const payload = readDataLines(remainder);
    return payload === null ? [] : [payload];
  }
}

function readDataLines(frame: string): string | null {
  const data: string[] = [];
  for (const line of frame.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    if (!line.startsWith("data:")) continue;
    data.push(line.slice(5).replace(/^ /, ""));
  }
  if (data.length === 0) return null;
  return data.join("\n");
}

function asString(value: unknown, maximum: number): string {
  if (typeof value !== "string") return "";
  return value.slice(0, maximum);
}

/**
 * Map one raw Hermes frame onto the closed set of events the browser sees.
 * Anything unknown, noisy, or unparseable yields `null` so a hostile or newer
 * Hermes cannot push arbitrary shapes into the client.
 */
export function normalizeHermesEvent(payload: string): CareerOpsEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const event = parsed as Record<string, unknown>;
  const name = typeof event.event === "string" ? event.event : null;
  if (!name) return null;

  switch (name) {
    case "message.delta": {
      const text = asString(event.delta, 16_000);
      return text ? { type: "delta", text } : null;
    }
    case "tool.started": {
      const tool = asString(event.tool, 120);
      return tool ? { type: "tool_started", tool } : null;
    }
    case "tool.completed": {
      const tool = asString(event.tool, 120);
      if (!tool) return null;
      const duration = typeof event.duration === "number" && Number.isFinite(event.duration)
        ? Math.max(0, Math.round(event.duration * 1000))
        : null;
      return {
        type: "tool_completed",
        tool,
        durationMs: duration,
        failed: event.error === true,
      };
    }
    case "approval.request": {
      const rawChoices = Array.isArray(event.choices) ? event.choices : [];
      const choices = APPROVAL_CHOICES.filter((choice) => rawChoices.includes(choice));
      return {
        type: "approval_required",
        operation: asString(event.pattern_key, 120),
        summary: redactUpstreamError(asString(event.description, 400)),
        details: redactUpstreamError(asString(event.command, 400)),
        choices: choices.length > 0 ? choices : ["once", "deny"],
      };
    }
    case "approval.responded": {
      const choice = asString(event.choice, 32);
      return choice ? { type: "approval_resolved", choice } : null;
    }
    case "run.completed":
      return { type: "completed", output: asString(event.output, 200_000) };
    case "run.failed":
      return {
        type: "failed",
        message: redactUpstreamError(asString(event.error, 400)) || "run_failed",
      };
    case "run.cancelled":
      return { type: "cancelled" };
    default:
      // reasoning.available, subagent.*, run.steered and any future event are
      // deliberately dropped rather than forwarded.
      return null;
  }
}

/** Serialize one Nexus-facing event as a single SSE data frame. */
export function serializeCareerOpsEvent(event: CareerOpsEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
