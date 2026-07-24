import { describe, expect, it } from "vitest";
import {
  APPLICATION_EVENT_TYPES,
  decodeEventCursor,
  deriveEventProjection,
  encodeEventCursor,
  parseApplicationEventCommand,
  parseEventQuery,
  validateApplicationSummary,
} from "../events";

describe("application event taxonomy", () => {
  it("publishes the canonical lifecycle event types", () => {
    expect(APPLICATION_EVENT_TYPES).toEqual([
      "opportunity_discovered",
      "application_submitted",
      "recruiter_contacted",
      "stage_changed",
      "interview_invited",
      "interview_scheduled",
      "interview_completed",
      "feedback_received",
      "follow_up_scheduled",
      "offer_received",
      "application_rejected",
      "document_attached",
      "note_added",
    ]);
  });

  it("rejects unknown event types without accepting arbitrary metadata", () => {
    expect(() => parseApplicationEventCommand({
      type: "whatever",
      occurredAt: "2026-07-24T09:00:00Z",
      metadata: {},
    })).toThrow("event_type_invalid");
    expect(() => parseApplicationEventCommand({
      type: "stage_changed",
      occurredAt: "2026-07-24T09:00:00Z",
      metadata: { toStage: "technical", injected: true },
    })).toThrow("event_metadata_invalid");
  });
});

describe("parseApplicationEventCommand", () => {
  it("rejects workflow-reserved submission events semantically", () => {
    expect(() => parseApplicationEventCommand({
      type: "application_submitted",
      occurredAt: "2026-07-24T09:00:00Z",
      metadata: {},
    })).toThrow("submission_event_requires_submission_workflow");
  });

  it("does not accept client-supplied previous status metadata", () => {
    expect(() => parseApplicationEventCommand({
      type: "stage_changed",
      occurredAt: "2026-07-24T09:00:00Z",
      metadata: { toStage: "technical", fromStatus: "offer" },
    })).toThrow("event_metadata_invalid");
  });

  it("normalizes an interview schedule and its indexed dimensions", () => {
    const command = parseApplicationEventCommand({
      type: "interview_scheduled",
      occurredAt: "2026-07-24T09:00:00+02:00",
      idempotencyKey: "schedule-123",
      expectedUpdatedAt: "2026-07-23T10:00:00Z",
      source: " mcp ",
      actor: " christian@example.com ",
      metadata: {
        interviewType: " practical_coding ",
        scheduledAt: "2026-07-28T12:30:00+02:00",
        durationMinutes: 60,
        contactId: " 42 ",
        nextAction: " Prepare repository ",
      },
    });

    expect(command).toMatchObject({
      type: "interview_scheduled",
      idempotencyKey: "schedule-123",
      source: "mcp",
      actor: "christian@example.com",
      contactId: "42",
      outcome: null,
    });
    expect(command.occurredAt.toISOString()).toBe("2026-07-24T07:00:00.000Z");
    expect(command.expectedUpdatedAt?.toISOString()).toBe("2026-07-23T10:00:00.000Z");
    expect(command.metadata).toEqual({
      interviewType: "practical_coding",
      scheduledAt: "2026-07-28T10:30:00.000Z",
      durationMinutes: 60,
      contactId: "42",
      nextAction: "Prepare repository",
    });
  });

  it.each([
    ["follow_up_scheduled", {}, "event_metadata_invalid"],
    ["interview_scheduled", { interviewType: "technical" }, "event_metadata_invalid"],
    ["stage_changed", { toStage: "" }, "event_metadata_invalid"],
    ["document_attached", {}, "event_metadata_invalid"],
  ])("rejects missing required metadata for %s", (type, metadata, code) => {
    expect(() => parseApplicationEventCommand({
      type,
      occurredAt: "2026-07-24T09:00:00Z",
      metadata,
    })).toThrow(code);
  });

  it("requires stable occurrence time for idempotent commands", () => {
    expect(() => parseApplicationEventCommand({
      type: "note_added",
      idempotencyKey: "note-key-1",
      metadata: { note: "hello" },
    })).toThrow("occurred_at_required_for_idempotency");
  });

  it("enforces aggregate metadata limits", () => {
    expect(() => parseApplicationEventCommand({
      type: "note_added",
      occurredAt: "2026-07-24T09:00:00Z",
      metadata: { note: "x".repeat(32_001) },
    })).toThrow(/event_metadata_(invalid|too_large)/);
  });
});

describe("deriveEventProjection", () => {
  const application = {
    status: "applied",
    currentStage: "recruiter_screen" as string | null,
    followUpAt: new Date("2026-07-25T10:00:00Z") as Date | null,
  };

  it("derives interview projection state and trustworthy before values", () => {
    const command = parseApplicationEventCommand({
      type: "interview_scheduled",
      occurredAt: "2026-07-24T09:00:00Z",
      metadata: {
        interviewType: "technical",
        scheduledAt: "2026-07-28T12:30:00Z",
      },
    });
    const result = deriveEventProjection(command, application);
    expect(result.patch).toEqual({
      status: "interview",
      currentStage: "interview_scheduled",
      lastContact: new Date("2026-07-24T09:00:00Z"),
      followUpAt: new Date("2026-07-28T12:30:00Z"),
    });
    expect(result.metadata).toMatchObject({
      fromStage: "recruiter_screen",
      toStage: "interview_scheduled",
      fromStatus: "applied",
      toStatus: "interview",
    });
  });

  it("derives the previous status for stage-only changes", () => {
    const command = parseApplicationEventCommand({
      type: "stage_changed",
      occurredAt: "2026-07-24T09:00:00Z",
      metadata: { toStage: "technical" },
    });
    expect(deriveEventProjection(command, application).metadata).toMatchObject({
      fromStage: "recruiter_screen",
      fromStatus: "applied",
      toStage: "technical",
    });
  });

  it("rejects an application atomically and clears stale follow-up", () => {
    const command = parseApplicationEventCommand({
      type: "application_rejected",
      occurredAt: "2026-07-24T09:00:00Z",
      metadata: { outcome: "role_closed" },
    });
    const result = deriveEventProjection(command, application);
    expect(result.patch).toEqual({
      status: "rejected",
      currentStage: "rejected",
      lastContact: new Date("2026-07-24T09:00:00Z"),
      followUpAt: null,
    });
    expect(result.metadata).toMatchObject({ fromStage: "recruiter_screen", outcome: "role_closed" });
  });
});

describe("event query cursors", () => {
  it("round-trips the deterministic occurrence/id cursor", () => {
    const value = { version: 1 as const, occurredAt: "2026-07-24T09:00:00.000Z", id: "42" };
    expect(decodeEventCursor(encodeEventCursor(value))).toEqual(value);
  });

  it("normalizes bounded filters and rejects invalid cursors/types", () => {
    expect(parseEventQuery({
      limit: 999,
      order: "oldest",
      types: ["stage_changed", "interview_completed"],
      occurredAfter: "2026-07-01T00:00:00Z",
      applicationId: " 12 ",
    })).toMatchObject({
      limit: 100,
      order: "oldest",
      types: ["stage_changed", "interview_completed"],
      applicationId: "12",
    });
    expect(() => parseEventQuery({ types: ["unknown"] })).toThrow("event_query_invalid");
    expect(() => parseEventQuery({ cursor: "not-a-cursor" })).toThrow("event_query_invalid");
    expect(() => parseEventQuery({ limit: 0.5 })).toThrow("event_query_invalid");
  });
});

describe("validateApplicationSummary", () => {
  it("preserves valid text and rejects rather than truncating oversized summaries", () => {
    expect(validateApplicationSummary(" summary ")).toBe(" summary ");
    expect(validateApplicationSummary("")).toBeNull();
    expect(() => validateApplicationSummary("x".repeat(10_001))).toThrow("notes_too_long");
  });
});
