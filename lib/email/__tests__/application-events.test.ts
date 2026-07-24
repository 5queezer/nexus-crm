import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  recordApplicationEvent: vi.fn(),
  applicationCreate: vi.fn(),
  applicationUpdate: vi.fn(),
  eventCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/db/prisma-adapter", () => ({
  PrismaAdapter: class {
    recordApplicationEvent = mocks.recordApplicationEvent;
  },
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
  },
}));

import {
  createEmailApplicationWithLifecycle,
  recordEmailLifecycleTransition,
} from "../application-events";

const base = {
  applicationId: 42,
  userId: "owner-1",
  occurredAt: new Date("2026-07-24T10:00:00Z"),
  scannedEmailId: 7,
  expectedUpdatedAt: new Date("2026-07-24T09:00:00Z"),
};

describe("recordEmailLifecycleTransition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.applicationCreate.mockResolvedValue({ id: 99 });
    mocks.applicationUpdate.mockResolvedValue({ id: 99 });
    mocks.eventCreate.mockResolvedValue({ id: 1 });
    mocks.transaction.mockImplementation(async (callback) => callback({
      application: {
        create: mocks.applicationCreate,
        update: mocks.applicationUpdate,
      },
      applicationEvent: { create: mocks.eventCreate },
    }));
  });

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

  it.each([
    ["interview", "stage_changed", "interview"],
    ["offer", "offer_received", "offer"],
    ["rejected", "application_rejected", "rejected"],
  ])("creates a new %s application and its %s event atomically", async (status, type, projectedStatus) => {
    const id = await createEmailApplicationWithLifecycle({
      userId: "owner-1",
      company: "Acme",
      role: "Engineer",
      status,
      occurredAt: base.occurredAt,
      scannedEmailId: 7,
    });

    expect(id).toBe(99);
    expect(mocks.applicationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: "applied", source: "email" }),
    });
    expect(mocks.applicationUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: projectedStatus, eventVersion: { increment: 1 } }),
    }));
    expect(mocks.eventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        applicationId: 99,
        type,
        source: "email",
        actor: "system",
        requestHash: expect.any(String),
      }),
    });
  });
});
