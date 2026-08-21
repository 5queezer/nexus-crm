import {
  CREDENTIAL_CANDIDATES,
  CREDENTIAL_TOKEN_CHAR,
  REDACTED_ERROR_LIMIT,
  configuredSecrets,
  redactSecrets,
} from "./config";

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
      /**
       * True when the disclosed action did not fit the display bound, so the
       * human cannot have seen all of what they would be authorizing. Such a
       * prompt is denial-only.
       */
      truncated: boolean;
      /** Set by the event route: proof this exact prompt was disclosed. */
      challenge?: string;
    }
  | { type: "approval_resolved"; choice: string }
  | { type: "completed"; output: string }
  | { type: "failed"; message: string }
  | { type: "cancelled" }
  | { type: "status"; status: string }
  | { type: "error"; message: string };

/**
 * Largest incomplete frame the parser will hold before giving up.
 *
 * A broken or hostile upstream can send an endless frame that never reaches a
 * blank-line delimiter; without a cap the buffer grows until the process dies.
 */
export const MAX_SSE_FRAME_BYTES = 256 * 1024;

/** Largest total payload accepted from one run stream. */
export const MAX_SSE_STREAM_BYTES = 8 * 1024 * 1024;

export class SseStreamTooLargeError extends Error {
  constructor(readonly bound: "frame" | "stream") {
    super(`career_ops_sse_${bound}_limit_exceeded`);
    this.name = "SseStreamTooLargeError";
  }
}

/** Smallest tail held back, even when no exact secret is configured. */
const MIN_BOUNDARY_WINDOW = 32;

/**
 * Largest tail withheld before a credential-shaped run is cut off outright.
 *
 * Holding until a token run ends is what keeps a credential intact for
 * matching, but an upstream streaming an endless token would grow the carry
 * without limit. Nothing legitimate is this long.
 */
const MAX_BOUNDARY_CARRY = 4096;

/**
 * Strips secrets from a stream of text where a secret may straddle two chunks.
 *
 * Redacting each delta in isolation cannot see a credential whose first half
 * arrived in one frame and whose second half arrives in the next, so a tail is
 * held back until enough following text exists to match across the seam.
 *
 * Two distinct hazards decide where the buffer may be cut:
 *
 *  - an **exact configured secret** straddling the boundary, and
 *  - a **generic credential shape** straddling it. This one is easy to miss:
 *    `SECRET_PATTERNS` needs eight token characters after the keyword, so a cut
 *    a few characters into the token emits a prefix that matches nothing and
 *    retains a suffix that no longer carries `Bearer` — the credential reaches
 *    the browser in two innocuous-looking halves. It applies to any
 *    credential-shaped text, not only this deployment's own keys, so the tail
 *    is held even when no secret is configured at all.
 */
export class SecretBoundaryRedactor {
  private carry = "";
  private readonly window: number;
  /** True while dropping the continuation of a run already cut off above. */
  private suppressing = false;

  constructor(window = (configuredSecrets()[0]?.length ?? 1) - 1) {
    this.window = Math.min(Math.max(window, MIN_BOUNDARY_WINDOW), 512);
  }

  push(text: string): string {
    // The carry is kept RAW. Holding the redacted tail instead destroys the
    // seam this class exists to inspect: once a leading fragment has been
    // replaced by a placeholder — the generic `Bearer <prefix>` rule does
    // exactly that — the reassembled text no longer contains the secret and its
    // remainder is emitted intact.
    let combined = this.carry + text;

    if (this.suppressing) {
      let i = 0;
      while (i < combined.length && CREDENTIAL_TOKEN_CHAR.test(combined[i])) i++;
      combined = combined.slice(i);
      if (combined.length === 0) {
        this.carry = "";
        return "";
      }
      this.suppressing = false;
    }

    if (combined.length <= this.window) {
      this.carry = combined;
      return "";
    }

    // Moving the cut earlier can bring it inside a region that did not straddle
    // the previous position, so settle rather than pass once.
    let cut = combined.length - this.window;
    for (let pass = 0; pass < 8; pass++) {
      const moved = safeCut(combined, cut);
      if (moved === cut) break;
      cut = moved;
    }

    if (combined.length - cut > MAX_BOUNDARY_CARRY) {
      // A credential-shaped run longer than any real credential. Refuse to hold
      // it: the region is redacted as a unit and its continuation is dropped,
      // because emitting any part of it is what leaks.
      this.carry = "";
      this.suppressing = true;
      return `${redactSecrets(combined.slice(0, cut))}[redacted]`;
    }

    this.carry = combined.slice(cut);
    return redactSecrets(combined.slice(0, cut));
  }

  /** Emit whatever is still held back, once no more text can arrive. */
  flush(): string {
    const rest = this.suppressing ? "" : redactSecrets(this.carry);
    this.carry = "";
    this.suppressing = false;
    return rest;
  }
}

/**
 * The latest position at or before `cut` that does not split a secret or a
 * credential candidate, and does not emit a candidate that may still be
 * growing at the end of the buffer.
 */
function safeCut(combined: string, cut: number): number {
  let earliest = cut;

  for (const secret of configuredSecrets()) {
    let at = combined.indexOf(secret);
    while (at !== -1) {
      if (at < cut && at + secret.length > cut) earliest = Math.min(earliest, at);
      at = combined.indexOf(secret, at + 1);
    }
  }

  for (const pattern of CREDENTIAL_CANDIDATES) {
    pattern.lastIndex = 0;
    let match = pattern.exec(combined);
    while (match) {
      const start = match.index;
      const end = start + match[0].length;
      // `end === combined.length`: the token may continue in the next chunk, so
      // the candidate is not finished and cannot be judged yet.
      if (start < cut && (end > cut || end === combined.length)) {
        earliest = Math.min(earliest, start);
      }
      if (pattern.lastIndex === match.index) pattern.lastIndex += 1;
      match = pattern.exec(combined);
    }
  }

  return earliest;
}

/**
 * Size in bytes of the UTF-8 encoding, which is what the network actually
 * carried. `String.length` counts UTF-16 code units and undercounts every
 * non-ASCII character.
 */
const byteEncoder = new TextEncoder();
function byteLength(text: string): number {
  return byteEncoder.encode(text).length;
}

/** Incremental SSE frame reader. Feed it decoded text chunks in arrival order. */
export class SseFrameParser {
  private buffer = "";
  private consumed = 0;

  push(chunk: string): string[] {
    // Bytes, not code units. `length` counts UTF-16 code units, so a non-ASCII
    // stream could carry several times the documented network-byte limit before
    // either bound noticed.
    this.consumed += byteLength(chunk);
    if (this.consumed > MAX_SSE_STREAM_BYTES) {
      this.buffer = "";
      throw new SseStreamTooLargeError("stream");
    }
    this.buffer += chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const frames: string[] = [];
    let separator = this.buffer.indexOf("\n\n");
    while (separator !== -1) {
      // Check the delimited frame *before* slicing or parsing it. Bounding only
      // the leftover buffer let a single complete frame approach the whole
      // stream cap and be parsed in full, bypassing the frame bound entirely.
      if (byteLength(this.buffer.slice(0, separator)) > MAX_SSE_FRAME_BYTES) {
        this.buffer = "";
        throw new SseStreamTooLargeError("frame");
      }
      const raw = this.buffer.slice(0, separator);
      this.buffer = this.buffer.slice(separator + 2);
      const payload = readDataLines(raw);
      if (payload !== null) frames.push(payload);
      separator = this.buffer.indexOf("\n\n");
    }
    // Whatever is left is an unterminated frame. Bounding it here is what stops
    // an upstream that never sends a delimiter from growing memory without end.
    if (byteLength(this.buffer) > MAX_SSE_FRAME_BYTES) {
      this.buffer = "";
      throw new SseStreamTooLargeError("frame");
    }
    return frames;
  }

  /** Emit a final frame that the upstream closed without a blank line. */
  flush(): string[] {
    const remainder = this.buffer;
    this.buffer = "";
    if (!remainder.trim()) return [];
    // Defence in depth: `push` has already bounded this very buffer, so this
    // cannot fire today. It is here so that a future change to where `push`
    // checks cannot quietly make "never send a delimiter, then close" a way
    // around the frame limit.
    if (byteLength(remainder) > MAX_SSE_FRAME_BYTES) {
      throw new SseStreamTooLargeError("frame");
    }
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

/** Display bound for the human-readable parts of an approval prompt. */
export const APPROVAL_TEXT_LIMIT = 400;

/**
 * Strip credentials from a whole upstream field, then bound what is emitted.
 *
 * The order is the point. Slicing first can cut a configured secret that begins
 * near the limit: exact-secret matching then no longer recognizes the truncated
 * remainder, and the prefix that survived the slice is emitted verbatim. The
 * generic patterns fail the same way — a keyword whose token is cut short of
 * eight characters stops matching. Redaction has to see the complete value.
 *
 * Redacting the full field is bounded work: the frame it came from is already
 * capped while reading, so nothing here grows without limit.
 */
function redactedField(value: unknown, maximum: number): string {
  if (typeof value !== "string") return "";
  return redactSecrets(value).slice(0, maximum);
}

/** The same redaction, unbounded, for callers that must judge the length. */
function redactedWhole(value: unknown): string {
  return typeof value === "string" ? redactSecrets(value) : "";
}

/**
 * Map one raw Hermes frame onto the closed set of events the browser sees.
 *
 * Every string taken from the frame passes through secret stripping without
 * exception. Deciding field by field which upstream text "could" carry a
 * credential is how the assistant output was missed for eighteen review
 * rounds, so the rule here is unconditional.
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
      // Deliberately NOT redacted here. Redacting each frame first destroys the
      // seam the boundary redactor exists to inspect: if the first half of a key
      // independently matches the generic bearer pattern it becomes
      // "[redacted]", and the reassembled text no longer contains the secret to
      // match — so the second half is emitted verbatim.
      //
      // Delta text is therefore raw at this layer and MUST pass through
      // SecretBoundaryRedactor before it reaches a client. The run event route
      // is the only consumer and does exactly that.
      // Deliberately neither redacted nor sliced here. Redaction happens in
      // SecretBoundaryRedactor, which needs the seam between frames intact; a
      // slice would cut a secret and emit the surviving prefix, and the frame
      // this came from is already bounded while reading.
      const text = typeof event.delta === "string" ? event.delta : "";
      return text ? { type: "delta", text } : null;
    }
    case "tool.started": {
      const tool = redactedField(event.tool, 120);
      return tool ? { type: "tool_started", tool } : null;
    }
    case "tool.completed": {
      const tool = redactedField(event.tool, 120);
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
      // A consequential argument can sit past the display bound. Approving what
      // was shown would then authorize something else, so a clipped action is
      // offered for denial only rather than silently truncated.
      // Redact first, then measure. The bound that decides `truncated` and the
      // bound the text is actually cut at must be the same one, applied to the
      // same string — checking the raw value while emitting the redacted one
      // lets a field that grew under redaction be clipped with `once` still on
      // offer, which is the silent truncation this check exists to prevent.
      const operation = redactedWhole(event.pattern_key);
      const summary = redactedWhole(event.description);
      const details = redactedWhole(event.command);
      const truncated =
        operation.length > 120 ||
        summary.length > APPROVAL_TEXT_LIMIT ||
        details.length > APPROVAL_TEXT_LIMIT;
      // Nexus grants single use only. `session` and `always` would let one
      // decision authorize operations the user never sees, which is the thing
      // the approval gate exists to prevent, so they are dropped here rather
      // than rendered — and therefore never signed into a challenge either.
      //
      // No fabricated grant: defaulting to `once` when Hermes omits `choices`
      // or sends only unrecognized ones would mint a valid, signed challenge
      // for a permission the gate never advertised.
      const grantable = choices.filter((choice) => choice === "once");
      const offered: CareerOpsApprovalChoice[] =
        grantable.length > 0 ? [...grantable, "deny"] : ["deny"];
      return {
        type: "approval_required",
        operation: operation.slice(0, 120),
        summary: summary.slice(0, APPROVAL_TEXT_LIMIT),
        details: details.slice(0, APPROVAL_TEXT_LIMIT),
        choices: truncated ? ["deny"] : offered,
        truncated,
      };
    }
    case "approval.responded": {
      const choice = redactedField(event.choice, 32);
      return choice ? { type: "approval_resolved", choice } : null;
    }
    case "run.completed":
      return { type: "completed", output: redactedField(event.output, 200_000) };
    case "run.failed":
      return {
        type: "failed",
        message: redactedField(event.error, REDACTED_ERROR_LIMIT) || "run_failed",
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
