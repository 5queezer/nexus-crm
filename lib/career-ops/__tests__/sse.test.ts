import { describe, expect, it } from "vitest";
import {
  SseFrameParser,
  SseStreamTooLargeError,
  normalizeHermesEvent,
  serializeCareerOpsEvent,
} from "../sse";

function collect(chunks: string[]): string[] {
  const parser = new SseFrameParser();
  const out: string[] = [];
  for (const chunk of chunks) out.push(...parser.push(chunk));
  out.push(...parser.flush());
  return out;
}

describe("SseFrameParser", () => {
  it("parses data-only frames", () => {
    expect(collect(['data: {"event":"run.completed"}\n\n'])).toEqual([
      '{"event":"run.completed"}',
    ]);
  });

  it("joins multi-line data payloads with newlines", () => {
    expect(collect(["data: {\ndata: \"a\": 1}\n\n"])).toEqual(['{\n"a": 1}']);
  });

  it("reassembles frames split across chunk boundaries", () => {
    expect(collect(['data: {"eve', 'nt":"run.comp', 'leted"}\n', "\n"])).toEqual([
      '{"event":"run.completed"}',
    ]);
  });

  it("ignores comment and keepalive frames", () => {
    expect(collect([": keepalive\n\n: stream closed\n\n"])).toEqual([]);
  });

  it("ignores an SSE event: line, since Hermes discriminates inside the payload", () => {
    expect(collect(['event: ignored\ndata: {"event":"run.failed"}\n\n'])).toEqual([
      '{"event":"run.failed"}',
    ]);
  });

  it("tolerates CRLF line endings", () => {
    expect(collect(['data: {"event":"run.cancelled"}\r\n\r\n'])).toEqual([
      '{"event":"run.cancelled"}',
    ]);
  });

  it("emits a trailing frame that was never terminated", () => {
    expect(collect(['data: {"event":"run.completed"}'])).toEqual([
      '{"event":"run.completed"}',
    ]);
  });
});

describe("normalizeHermesEvent", () => {
  it("maps assistant deltas", () => {
    expect(normalizeHermesEvent('{"event":"message.delta","delta":"hel"}')).toEqual({
      type: "delta",
      text: "hel",
    });
  });

  it("maps tool lifecycle events without exposing raw payloads", () => {
    expect(
      normalizeHermesEvent(
        '{"event":"tool.started","tool":"list_applications","preview":"scan","extra":"x"}',
      ),
    ).toEqual({ type: "tool_started", tool: "list_applications" });
    expect(
      normalizeHermesEvent(
        '{"event":"tool.completed","tool":"list_applications","duration":1.5,"error":true}',
      ),
    ).toEqual({
      type: "tool_completed",
      tool: "list_applications",
      durationMs: 1500,
      failed: true,
    });
  });

  it("maps approval requests with sanitized fields and a bounded choice set", () => {
    const event = normalizeHermesEvent(
      JSON.stringify({
        event: "approval.request",
        command: "rm -rf /tmp/x",
        description: "Delete a temporary folder",
        pattern_key: "shell:rm",
        allow_permanent: true,
        allow_session: true,
        choices: ["once", "session", "always", "deny", "bogus"],
      }),
    );
    expect(event).toEqual({
      type: "approval_required",
      operation: "shell:rm",
      summary: "Delete a temporary folder",
      details: "rm -rf /tmp/x",
      // Nexus grants single use only: session-wide and permanent grants would
      // authorize operations the user never sees.
      choices: ["once", "deny"],
      truncated: false,
    });
  });

  it("offers denial only when the gate advertises no usable choice", () => {
    // Inventing `once` here would mint a signed challenge for a permission the
    // gate never advertised.
    for (const choices of [undefined, [], ["bogus"], ["session", "always"]]) {
      const event = normalizeHermesEvent(
        JSON.stringify({
          event: "approval.request",
          pattern_key: "shell",
          description: "Run a command",
          command: "nexus update 42",
          ...(choices === undefined ? {} : { choices }),
        }),
      );
      expect(event).toMatchObject({ type: "approval_required", choices: ["deny"] });
    }
  });

  it("redacts secret-bearing approval details", () => {
    const event = normalizeHermesEvent(
      JSON.stringify({
        event: "approval.request",
        command: 'curl -H "Authorization: Bearer sk-abcdef0123456789abcdef"',
        description: "Call an API",
      }),
    );
    expect(event?.type).toBe("approval_required");
    if (event?.type !== "approval_required") throw new Error("unreachable");
    expect(event.details).not.toContain("sk-abcdef0123456789abcdef");
  });

  it("maps terminal events", () => {
    expect(normalizeHermesEvent('{"event":"run.completed","output":"done"}')).toEqual({
      type: "completed",
      output: "done",
    });
    expect(
      normalizeHermesEvent('{"event":"run.failed","error":"Bearer sk-abcdefgh12345678 leaked"}'),
    ).toEqual({ type: "failed", message: expect.not.stringContaining("sk-abcdefgh12345678") });
    expect(normalizeHermesEvent('{"event":"run.cancelled"}')).toEqual({ type: "cancelled" });
    expect(normalizeHermesEvent('{"event":"approval.responded","choice":"deny"}')).toEqual({
      type: "approval_resolved",
      choice: "deny",
    });
  });

  it("ignores unknown, noisy and malformed events", () => {
    expect(normalizeHermesEvent('{"event":"reasoning.available","text":"secret thoughts"}')).toBeNull();
    expect(normalizeHermesEvent('{"event":"subagent.start"}')).toBeNull();
    expect(normalizeHermesEvent('{"event":"totally.unknown"}')).toBeNull();
    expect(normalizeHermesEvent("not json at all")).toBeNull();
    expect(normalizeHermesEvent("[1,2,3]")).toBeNull();
    expect(normalizeHermesEvent('{"noEventField":true}')).toBeNull();
  });

  it("ignores an empty assistant delta", () => {
    expect(normalizeHermesEvent('{"event":"message.delta","delta":""}')).toBeNull();
  });
});

describe("serializeCareerOpsEvent", () => {
  it("emits a single data frame terminated by a blank line", () => {
    const frame = serializeCareerOpsEvent({ type: "delta", text: "hi" });
    expect(frame).toBe('data: {"type":"delta","text":"hi"}\n\n');
  });

  it("never emits a raw newline inside the data payload", () => {
    const frame = serializeCareerOpsEvent({ type: "delta", text: "a\nb" });
    expect(frame.split("\n\n")).toHaveLength(2);
    expect(frame.startsWith("data: ")).toBe(true);
  });
});

describe("approval prompts that do not fit the display bound", () => {
  it("offers denial only when the command is clipped", () => {
    // A consequential argument can sit past the bound, so approving what was
    // shown would authorize something the human never saw.
    const event = normalizeHermesEvent(
      JSON.stringify({
        event: "approval.request",
        pattern_key: "shell",
        description: "Run a command",
        command: "x".repeat(5_000),
        choices: ["once", "session", "always", "deny"],
      }),
    );
    expect(event).toMatchObject({ type: "approval_required", truncated: true, choices: ["deny"] });
  });

  it("keeps the offered choices when the whole action fits", () => {
    const event = normalizeHermesEvent(
      JSON.stringify({
        event: "approval.request",
        pattern_key: "shell",
        description: "Run a command",
        command: "nexus update 42",
        choices: ["once", "deny"],
      }),
    );
    expect(event).toMatchObject({
      type: "approval_required",
      truncated: false,
      choices: ["once", "deny"],
    });
  });
});

describe("stream size bounds", () => {
  it("gives up on an unterminated frame instead of growing memory", () => {
    // A hostile or broken upstream can stream forever without ever sending the
    // blank-line delimiter that would flush a frame.
    const parser = new SseFrameParser();
    expect(() => {
      for (let i = 0; i < 40; i += 1) parser.push("data: " + "x".repeat(16 * 1024) + "\n");
    }).toThrow(SseStreamTooLargeError);
  });

  it("gives up once one run stream exceeds its total budget", () => {
    const parser = new SseFrameParser();
    const frame = `data: {"event":"message.delta","delta":"${"x".repeat(200 * 1024)}"}\n\n`;
    expect(() => {
      for (let i = 0; i < 64; i += 1) parser.push(frame);
    }).toThrow(SseStreamTooLargeError);
  });

  it("accepts an ordinary stream well inside the bounds", () => {
    const parser = new SseFrameParser();
    const frames = parser.push('data: {"event":"message.delta","delta":"hi"}\n\n');
    expect(frames).toHaveLength(1);
  });
});
