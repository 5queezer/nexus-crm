import { describe, expect, it } from "vitest";
import {
  APPROVAL_TEXT_LIMIT,
  SecretBoundaryRedactor,
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

  it("displays the whole action whenever it offers a grant", () => {
    // The bound that decides `truncated` and the bound the text is actually cut
    // at have to be the same one. When they diverge, a command between the two
    // is clipped while the prompt still offers `once`, and the human authorizes
    // a suffix they were never shown.
    for (const length of [350, APPROVAL_TEXT_LIMIT]) {
      const command = `nexus update ${"a".repeat(length - 21)} --force`;
      const description = `Run ${"b".repeat(length - 8)} now`;
      expect(command).toHaveLength(length);
      expect(description).toHaveLength(length);
      const event = normalizeHermesEvent(
        JSON.stringify({
          event: "approval.request",
          pattern_key: "shell",
          description,
          command,
          choices: ["once", "deny"],
        }),
      );
      expect(event).toEqual({
        type: "approval_required",
        operation: "shell",
        summary: description,
        details: command,
        choices: ["once", "deny"],
        truncated: false,
      });
    }
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

describe("credential stripping in assistant output", () => {
  const KEY = "hermes-secret-key-0123456789";

  beforeEach(() => {
    process.env.HERMES_CAREER_OPS_API_KEY = KEY;
  });
  afterEach(() => {
    delete process.env.HERMES_CAREER_OPS_API_KEY;
  });

  it("strips the configured key from a streamed delta once reassembled", () => {
    // Delta frames are raw at the normalizer, by design: redacting each frame
    // first would destroy the seam the boundary redactor inspects. The
    // guarantee is on the reassembled output.
    const event = normalizeHermesEvent(
      JSON.stringify({ event: "message.delta", delta: `here it is: ${KEY} ok` }),
    );
    expect(event).toMatchObject({ type: "delta" });

    const redactor = new SecretBoundaryRedactor();
    const out = redactor.push((event as { text: string }).text) + redactor.flush();
    expect(out).not.toContain(KEY);
  });

  it("catches a key whose first half matches the bearer pattern on its own", () => {
    // The case that made per-frame redaction wrong: the leading fragment
    // matches the generic `Bearer <prefix>` rule by itself. Redacted in
    // isolation it becomes "[redacted]", the reassembled text no longer holds
    // the secret, and the trailing half would be emitted verbatim.
    const redactor = new SecretBoundaryRedactor();
    const half = Math.floor(KEY.length / 2);
    // The filler matters: without it the first chunk is shorter than the
    // hold-back window and would be retained whole regardless, so the test
    // would pass against a redactor that mishandles the seam.
    let out = redactor.push(`${"filler ".repeat(20)}Bearer ${KEY.slice(0, half)}`);
    out += redactor.push(`${KEY.slice(half)} trailing`);
    out += redactor.flush();

    expect(out).not.toContain(KEY);
    expect(out).not.toContain(KEY.slice(half));
  });

  it("strips the configured key from completed output", () => {
    const event = normalizeHermesEvent(
      JSON.stringify({ event: "run.completed", output: `done, key=${KEY}` }),
    );
    expect(JSON.stringify(event)).not.toContain(KEY);
  });

  it("catches a secret split across two deltas", () => {
    // Redacting each delta alone cannot see this; the boundary redactor holds
    // back a tail until enough following text exists to match across the seam.
    const redactor = new SecretBoundaryRedactor();
    const half = Math.floor(KEY.length / 2);
    let out = redactor.push(`start ${KEY.slice(0, half)}`);
    out += redactor.push(`${KEY.slice(half)} end`);
    out += redactor.flush();

    expect(out).not.toContain(KEY);
    expect(out).toContain("start");
    expect(out).toContain("end");
  });

  it("strips the key from every field of every event shape", () => {
    // A rule, not a per-field judgement: deciding case by case which upstream
    // text could carry a credential is exactly how assistant output was missed.
    const frames = [
      // message.delta is deliberately raw here and is covered separately: it
      // must pass through SecretBoundaryRedactor, which needs the seam intact.

      { event: "tool.started", tool: `tool ${KEY}` },
      { event: "tool.completed", tool: `tool ${KEY}`, duration: 1 },
      {
        event: "approval.request",
        pattern_key: `op ${KEY}`,
        description: `why ${KEY}`,
        command: `cmd ${KEY}`,
        choices: ["once", "deny"],
      },
      { event: "approval.responded", choice: `once ${KEY}` },
      { event: "run.completed", output: `done ${KEY}` },
      { event: "run.failed", error: `boom ${KEY}` },
    ];

    for (const frame of frames) {
      const event = normalizeHermesEvent(JSON.stringify(frame));
      expect(JSON.stringify(event ?? {}), `leaked in ${frame.event}`).not.toContain(KEY);
    }
  });

  it("keeps a generic credential intact across the cut when no secret is configured", () => {
    // The window is sized from the configured secrets, so with none configured
    // there was no hold-back at all and any credential split across two deltas
    // went straight through. It is not this deployment's key that leaks here —
    // it is a Nexus token the agent happened to print.
    delete process.env.HERMES_CAREER_OPS_API_KEY;
    // Deliberately low-entropy and self-describing: a random-looking literal
    // here trips secret scanners in CI, which is noise, not a finding.
    const token = `jt_${"not-a-real-token-".repeat(2)}`;
    const redactor = new SecretBoundaryRedactor();
    let out = redactor.push(`${"filler ".repeat(20)}Bearer ${token.slice(0, 4)}`);
    out += redactor.push(`${token.slice(4)} trailing`);
    out += redactor.flush();

    expect(out).not.toContain(token);
    expect(out).not.toContain(token.slice(4));
    expect(out).toContain("trailing");
  });

  it("keeps a generic credential intact when the cut lands mid-token", () => {
    // With a secret configured the window exists, but it was only ever moved
    // for that exact secret. A generic candidate straddling the boundary was
    // still cut: the prefix carried too few token characters to match, and the
    // suffix no longer carried the keyword.
    const token = "jt_" + "abcdefgh".repeat(12);
    const redactor = new SecretBoundaryRedactor();
    let out = redactor.push(`${"filler ".repeat(20)}Bearer ${token}`);
    out += redactor.push(" and then some ordinary words follow here");
    out += redactor.flush();

    expect(out).not.toContain(token);
    expect(out).not.toContain(token.slice(-24));
    expect(out).toContain("ordinary words");
  });

  it("cuts off a credential run too long to hold rather than emitting it", () => {
    // A hostile upstream can stream an endless token to make the hold-back grow
    // without limit. The run is redacted as a unit and its continuation dropped.
    const redactor = new SecretBoundaryRedactor();
    let out = redactor.push(`start Bearer ${"a".repeat(6000)}`);
    out += redactor.push(`${"a".repeat(6000)} end`);
    out += redactor.flush();

    expect(out).toContain("start");
    expect(out).toContain("[redacted]");
    expect(out).not.toContain("aaaaaaaaaaaaaaaa");
    expect(out).toContain("end");
  });

  it("redacts before bounding, so a secret at the limit cannot survive the cut", () => {
    // The leak this closes: slicing first severs a configured secret that
    // begins near the bound. Exact-secret matching then no longer recognizes
    // the remainder, and the prefix that survived the slice is emitted. Each
    // field is built so exactly 20 characters of the key sit inside the bound.
    const SURVIVING = KEY.slice(0, 20);
    for (const frame of [
      { event: "run.completed", output: `${"o".repeat(200_000 - 20)}${KEY}` },
      { event: "tool.started", tool: `${"t".repeat(120 - 20)}${KEY}` },
      { event: "approval.responded", choice: `${"c".repeat(32 - 20)}${KEY}` },
      { event: "run.failed", error: `${"e".repeat(300 - 20)}${KEY}` },
    ]) {
      const event = normalizeHermesEvent(JSON.stringify(frame));
      expect(event, `dropped ${frame.event}`).not.toBeNull();
      expect(JSON.stringify(event ?? {}), `leaked in ${frame.event}`).not.toContain(SURVIVING);
    }
  });

  it("measures the approval bound on the text it actually renders", () => {
    // Redaction shortens, so measuring the raw value overstates the length: a
    // command that only exceeds the bound because of the credentials being
    // stripped out of it displays in full, and denying the grant for it would
    // be wrong. The check and the cut have to be the same string.
    const command = Array.from({ length: 15 }, () => KEY).join(" ");
    expect(command.length).toBeGreaterThan(APPROVAL_TEXT_LIMIT);

    const event = normalizeHermesEvent(
      JSON.stringify({
        event: "approval.request",
        pattern_key: "shell",
        description: "Run a command",
        command,
        choices: ["once", "deny"],
      }),
    );
    expect(event?.type).toBe("approval_required");
    if (event?.type !== "approval_required") throw new Error("unreachable");

    expect(event.details).not.toContain(KEY);
    expect(event.details.length).toBeLessThanOrEqual(APPROVAL_TEXT_LIMIT);
    expect(event.truncated).toBe(false);
    expect(event.choices).toEqual(["once", "deny"]);
  });

  it("passes ordinary text through unchanged once flushed", () => {
    const redactor = new SecretBoundaryRedactor();
    const out = redactor.push("the quick brown fox") + redactor.flush();
    expect(out).toBe("the quick brown fox");
  });
});
