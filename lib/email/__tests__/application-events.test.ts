import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ recordApplicationEvent: vi.fn() }));

vi.mock("@/lib/db/prisma-adapter", () => ({
  PrismaAdapter: class {
    recordApplicationEvent = mocks.recordApplicationEvent;
  },
}));

import { recordEmailLifecycleTransition } from "../application-events";

const base = {
  applicationId: 42,
  userId: "owner-1",
  occurredAt: new Date("2026-07-24T10:00:00Z"),
  scannedEmailId: 7,
  expectedUpdatedAt: new Date("2026-07-24T09:00:00Z"),
};

describe("recordEmailLifecycleTransition", () => {
  beforeEach(() => mocks.recordApplicationEvent.mockReset());

  it.each([
    ["interview", "stage_changed", { toStatus: "interview", toStage: "interview" }],
    ["offer", "offer_received", {}],
    ["rejected", "application_rejected", {}],
  ])("records %s atomically as %s", async (status, type, metadata) => {
    await recordEmailLifecycleTransition({ ...base, status });

    expect(mocks.recordApplicationEvent).toHaveBeenCalledWith("42", "owner-1", {
      type,
      occurredAt: base.occurredAt,
      source: "email",
      actor: "system",
      metadata,
      idempotencyKey: `email-lifecycle:7:${status}`,
      expectedUpdatedAt: base.expectedUpdatedAt,
    });
  });
});
