import { beforeEach, describe, expect, it, vi } from "vitest";
import { submissionRequestHash } from "@/lib/applications/submission";

const fake = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  let application: Row;
  let events: Row[];
  let failCreate = false;

  const reset = () => {
    application = {
      id: 1,
      userId: "owner-1",
      company: "Acme",
      role: "Engineer",
      status: "applied",
      appliedAt: new Date("2026-07-01T00:00:00Z"),
      lastContact: null,
      followUpAt: null,
      notes: null,
      jobDescription: null,
      source: null,
      remote: true,
      salaryMin: null,
      salaryMax: null,
      rating: null,
      jobUrl: null,
      canonicalJobUrl: null,
      currentStage: "screen",
      eventVersion: 0,
      createdAt: new Date("2026-07-01T00:00:00Z"),
      updatedAt: new Date("2026-07-24T08:00:00Z"),
      contacts: [],
    };
    events = [];
    failCreate = false;
  };
  reset();

  const prisma: Record<string, unknown> = {};
  const applicationApi = {
    findFirst: vi.fn(async ({ where }: { where: { id?: number; userId?: string } }) => {
      if (where.id !== undefined && where.id !== application.id) return null;
      if (where.userId !== undefined && where.userId !== application.userId) return null;
      return { ...application, contacts: [] };
    }),
    updateMany: vi.fn(async ({ where, data }: { where: { id: number; userId: string; updatedAt?: Date; eventVersion?: number }; data: Row }) => {
      const matches = where.id === application.id
        && where.userId === application.userId
        && (where.updatedAt === undefined || where.updatedAt.getTime() === (application.updatedAt as Date).getTime())
        && (where.eventVersion === undefined || where.eventVersion === application.eventVersion);
      if (!matches) return { count: 0 };
      const nextData = { ...data };
      if (typeof data.eventVersion === "object" && data.eventVersion !== null) {
        nextData.eventVersion = Number(application.eventVersion) + Number((data.eventVersion as { increment: number }).increment);
      }
      application = {
        ...application,
        ...nextData,
        updatedAt: new Date((application.updatedAt as Date).getTime() + 1_000),
      };
      return { count: 1 };
    }),
    update: vi.fn(async ({ data }: { data: Row }) => {
      const increment = (data.eventVersion as { increment?: number } | undefined)?.increment ?? 0;
      application = {
        ...application,
        ...data,
        eventVersion: Number(application.eventVersion) + increment,
        updatedAt: new Date((application.updatedAt as Date).getTime() + 1_000),
      };
      return { ...application, contacts: [] };
    }),
  };
  const eventApi = {
    findUnique: vi.fn(async ({ where }: { where: { userId_idempotencyKey: { userId: string; idempotencyKey: string } } }) => {
      const key = where.userId_idempotencyKey;
      return events.find((event) => event.userId === key.userId && event.idempotencyKey === key.idempotencyKey) ?? null;
    }),
    create: vi.fn(async ({ data }: { data: Row }) => {
      if (failCreate) throw new Error("event_write_failed");
      const row = { id: events.length + 1, createdAt: new Date("2026-07-24T09:00:01Z"), contactId: null, outcome: null, ...data };
      events.push(row);
      return row;
    }),
  };
  const contactApi = { count: vi.fn(async () => 1) };
  const documentApi = { count: vi.fn(async () => 1) };
  const submissionApi = { count: vi.fn(async () => 1) };
  Object.assign(prisma, {
    application: applicationApi,
    applicationEvent: eventApi,
    contact: contactApi,
    document: documentApi,
    applicationSubmission: submissionApi,
    $transaction: vi.fn(async (callback: (transaction: unknown) => Promise<unknown>) => {
      const applicationBefore = structuredClone(application);
      const eventsBefore = structuredClone(events);
      try {
        return await callback(prisma);
      } catch (error) {
        application = applicationBefore;
        events = eventsBefore;
        throw error;
      }
    }),
  });

  return {
    prisma,
    reset,
    app: () => application,
    events: () => events,
    seedEvent: (row: Row) => events.push(row),
    contactCount: contactApi.count,
    documentCount: documentApi.count,
    submissionCount: submissionApi.count,
    setApplication: (update: Row) => { application = { ...application, ...update }; },
    setFailCreate: (value: boolean) => { failCreate = value; },
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: fake.prisma }));

import { PrismaAdapter } from "../prisma-adapter";

const command = {
  type: "stage_changed" as const,
  occurredAt: new Date("2026-07-24T09:00:00Z"),
  expectedUpdatedAt: new Date("2026-07-24T08:00:00Z"),
  idempotencyKey: "stage-change-1",
  source: "test",
  actor: "owner@example.com",
  metadata: { toStage: "technical", toStatus: "interview" },
  contactId: null,
  outcome: null,
};

describe("PrismaAdapter — atomic application events", () => {
  beforeEach(() => {
    fake.reset();
    vi.clearAllMocks();
  });

  it("updates the projection and creates one immutable event", async () => {
    const result = await new PrismaAdapter().recordApplicationEvent("1", "owner-1", command);
    expect(result.replayed).toBe(false);
    expect(result.application).toMatchObject({ status: "interview", currentStage: "technical" });
    expect(result.event.metadata).toMatchObject({ fromStage: "screen", toStage: "technical" });
    expect(result.event.metadata).not.toHaveProperty("requestHash");
    expect(fake.events()).toHaveLength(1);
    expect(fake.events()[0].requestHash).toEqual(expect.any(String));
  });

  it("replays a pre-migration legacy idempotency hash", async () => {
    const legacyHash = submissionRequestHash({
      applicationId: "1",
      type: command.type,
      occurredAt: command.occurredAt,
      metadata: command.metadata,
    });
    fake.seedEvent({
      id: 99,
      userId: "owner-1",
      applicationId: 1,
      type: command.type,
      idempotencyKey: command.idempotencyKey,
      requestHash: null,
      occurredAt: command.occurredAt,
      createdAt: command.occurredAt,
      source: null,
      actor: null,
      contactId: null,
      outcome: null,
      metadata: { ...command.metadata, requestHash: legacyHash },
    });

    const replay = await new PrismaAdapter().recordApplicationEvent("1", "owner-1", command);
    expect(replay.replayed).toBe(true);
    expect(replay.event.metadata).not.toHaveProperty("requestHash");
    expect(replay.event).not.toHaveProperty("requestHash");
    expect(fake.events()).toHaveLength(1);
  });

  it("replays an identical idempotent command without another write", async () => {
    const adapter = new PrismaAdapter();
    await adapter.recordApplicationEvent("1", "owner-1", command);
    const replay = await adapter.recordApplicationEvent("1", "owner-1", command);
    expect(replay.replayed).toBe(true);
    expect(fake.events()).toHaveLength(1);
  });

  it("rejects a changed payload for the same idempotency key", async () => {
    const adapter = new PrismaAdapter();
    await adapter.recordApplicationEvent("1", "owner-1", command);
    await expect(adapter.recordApplicationEvent("1", "owner-1", {
      ...command,
      metadata: { toStage: "onsite", toStatus: "interview" },
    })).rejects.toThrow("idempotency_conflict");
  });

  it.each([
    {
      label: "contact",
      fail: () => fake.contactCount.mockResolvedValueOnce(0),
      input: { ...command, idempotencyKey: "missing-contact", contactId: "7" },
      code: "contact_not_found",
    },
    {
      label: "document",
      fail: () => fake.documentCount.mockResolvedValueOnce(0),
      input: { ...command, idempotencyKey: "missing-document", metadata: { ...command.metadata, documentId: "8" } },
      code: "document_not_found",
    },
    {
      label: "submission",
      fail: () => fake.submissionCount.mockResolvedValueOnce(0),
      input: { ...command, idempotencyKey: "missing-submission", metadata: { ...command.metadata, submissionId: "9" } },
      code: "submission_not_found",
    },
  ])("rejects a linked $label outside the owner/application boundary", async ({ fail, input, code }) => {
    fail();
    await expect(new PrismaAdapter().recordApplicationEvent("1", "owner-1", input)).rejects.toThrow(code);
    expect(fake.events()).toHaveLength(0);
  });

  it("rejects stale and cross-owner commands without an event", async () => {
    const adapter = new PrismaAdapter();
    await expect(adapter.recordApplicationEvent("1", "owner-1", {
      ...command,
      expectedUpdatedAt: new Date("2026-07-24T07:00:00Z"),
    })).rejects.toThrow("conflict");
    await expect(adapter.recordApplicationEvent("1", "other", command)).rejects.toThrow("not_found");
    expect(fake.events()).toHaveLength(0);
  });

  it("takes an optimistic write lock for events without projection changes", async () => {
    const before = fake.app().updatedAt;
    const noteCommand = {
      ...command,
      type: "note_added" as const,
      idempotencyKey: "note-added-1",
      metadata: { note: "Chronological update" },
    };
    await new PrismaAdapter().recordApplicationEvent("1", "owner-1", noteCommand);
    expect((fake.prisma.application as { updateMany: ReturnType<typeof vi.fn> }).updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { eventVersion: { increment: 1 } } }),
    );
    expect(fake.app().eventVersion).toBe(1);
    expect((fake.app().updatedAt as Date).getTime()).toBeGreaterThan((before as Date).getTime());
    expect(fake.events()).toHaveLength(1);
  });

  it("allows unrelated updates to preserve an oversized legacy summary unchanged", async () => {
    const legacyNotes = "x".repeat(10_001);
    fake.setApplication({ notes: legacyNotes });
    await expect(new PrismaAdapter().updateApplication("1", "owner-1", {
      company: "Acme 2",
      notes: legacyNotes,
    })).resolves.toMatchObject({ company: "Acme 2", notes: legacyNotes });
  });

  it("still rejects a newly changed oversized summary", async () => {
    fake.setApplication({ notes: "legacy" });
    await expect(new PrismaAdapter().updateApplication("1", "owner-1", {
      notes: "x".repeat(10_001),
    })).rejects.toThrow("notes_too_long");
  });

  it("rejects lifecycle fields in batch updates", async () => {
    const result = await new PrismaAdapter().batchUpsertApplications("owner-1", [{
      id: "1",
      currentStage: "technical",
    }]);

    expect(result).toMatchObject({
      succeeded: 0,
      failed: 1,
      results: [{ error: "lifecycle_event_required" }],
    });
    expect((fake.prisma.application as { update: ReturnType<typeof vi.fn> }).update).not.toHaveBeenCalled();
  });

  it("rolls back projection changes when event creation fails", async () => {
    fake.setFailCreate(true);
    await expect(new PrismaAdapter().recordApplicationEvent("1", "owner-1", command)).rejects.toThrow("event_write_failed");
    expect(fake.app()).toMatchObject({ status: "applied", currentStage: "screen" });
    expect(fake.events()).toHaveLength(0);
  });
});
