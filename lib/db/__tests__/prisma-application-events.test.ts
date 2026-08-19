import { beforeEach, describe, expect, it, vi } from "vitest";
import { submissionRequestHash } from "@/lib/applications/submission";

const fake = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  let application: Row;
  let events: Row[];
  let failCreate = false;
  let replayAfterInitialLookup: Row | null = null;

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
      isDemo: false,
      demoWorkspaceId: null,
      demoKey: null,
      createdAt: new Date("2026-07-01T00:00:00Z"),
      updatedAt: new Date("2026-07-24T08:00:00Z"),
      contacts: [],
    };
    events = [];
    failCreate = false;
    replayAfterInitialLookup = null;
  };
  reset();

  const prisma: Record<string, unknown> = {};
  const applicationApi = {
    findMany: vi.fn(async () => []),
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
    create: vi.fn(async ({ data }: { data: Row }) => ({
      ...application,
      ...data,
      id: Number(application.id) + 1,
      contacts: [],
    })),
    count: vi.fn(async () => 1),
  };
  const eventApi = {
    findUnique: vi.fn(async ({ where }: { where: { userId_idempotencyKey: { userId: string; idempotencyKey: string } } }) => {
      const key = where.userId_idempotencyKey;
      if (replayAfterInitialLookup) {
        const row = replayAfterInitialLookup;
        replayAfterInitialLookup = null;
        events.push(row);
        return null;
      }
      return events.find((event) => event.userId === key.userId && event.idempotencyKey === key.idempotencyKey) ?? null;
    }),
    create: vi.fn(async ({ data }: { data: Row }) => {
      if (failCreate) throw new Error("event_write_failed");
      const row = { id: events.length + 1, createdAt: new Date("2026-07-24T09:00:01Z"), contactId: null, outcome: null, ...data };
      events.push(row);
      return row;
    }),
    findMany: vi.fn(async () => events),
  };
  const contactApi = { count: vi.fn(async () => 1) };
  const documentApi = { count: vi.fn(async () => 1) };
  const submissionApi = { count: vi.fn(async () => 1) };
  const demoWorkspaceApi = { count: vi.fn(async () => 0) };
  const ownerLock = vi.fn(async () => [{ id: "owner-1" }]);
  Object.assign(prisma, {
    application: applicationApi,
    applicationEvent: eventApi,
    contact: contactApi,
    document: documentApi,
    applicationSubmission: submissionApi,
    demoWorkspace: demoWorkspaceApi,
    $queryRaw: ownerLock,
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
    setReplayAfterInitialLookup: (row: Row) => { replayAfterInitialLookup = row; },
    demoWorkspaceCount: demoWorkspaceApi.count,
    ownerLock,
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

  it("returns null instead of throwing for malformed application IDs", async () => {
    await expect(new PrismaAdapter().getApplication("not-an-id", "owner-1")).resolves.toBeNull();
    expect((fake.prisma.application as { findFirst: ReturnType<typeof vi.fn> }).findFirst).not.toHaveBeenCalled();
  });

  it("adds an ID tie-breaker to default cursor pagination", async () => {
    await new PrismaAdapter().listApplicationsFiltered("owner-1", { cursor: "1", limit: 20 });

    expect((fake.prisma.application as { findMany: ReturnType<typeof vi.fn> }).findMany)
      .toHaveBeenCalledWith(expect.objectContaining({
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        cursor: { id: 1 },
        skip: 1,
      }));
  });

  it("normalizes a malformed application cursor", async () => {
    await expect(new PrismaAdapter().listApplicationsFiltered("owner-1", { cursor: "deleted-app" }))
      .rejects.toThrow("application_cursor_invalid");
    expect((fake.prisma.application as { findMany: ReturnType<typeof vi.fn> }).findMany).not.toHaveBeenCalled();
  });

  it("rejects a numeric cursor outside the scoped result set", async () => {
    await expect(new PrismaAdapter().listApplicationsFiltered("owner-1", { cursor: "999" }))
      .rejects.toThrow("application_cursor_invalid");
    expect((fake.prisma.application as { findMany: ReturnType<typeof vi.fn> }).findMany).not.toHaveBeenCalled();
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

  it("propagates demo ownership markers to ordinary event writes", async () => {
    fake.setApplication({ isDemo: true, demoWorkspaceId: 9, demoKey: "fixture-app" });
    await new PrismaAdapter().recordApplicationEvent("1", "owner-1", command);
    expect(fake.events()[0]).toMatchObject({
      isDemo: true,
      demoWorkspaceId: 9,
      demoKey: expect.stringMatching(/^fixture-app:event:/),
    });
  });

  it("fails closed when a parent has inconsistent demo markers", async () => {
    fake.setApplication({ isDemo: false, demoWorkspaceId: 9, demoKey: "fixture-app" });
    await expect(new PrismaAdapter().recordApplicationEvent("1", "owner-1", command))
      .rejects.toThrow("demo_marker_conflict");
    expect(fake.events()).toHaveLength(0);
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

  it("accepts persisted fixture demo keys when replaying an event", async () => {
    fake.setApplication({ isDemo: true, demoWorkspaceId: 9, demoKey: "fixture-app" });
    const requestHash = submissionRequestHash({
      applicationId: "1",
      type: command.type,
      occurredAt: command.occurredAt,
      source: command.source,
      actor: command.actor,
      metadata: command.metadata,
      contactId: command.contactId,
      outcome: command.outcome,
      expectedUpdatedAt: command.expectedUpdatedAt,
    });
    fake.seedEvent({
      id: 99,
      userId: "owner-1",
      applicationId: 1,
      type: command.type,
      idempotencyKey: command.idempotencyKey,
      requestHash,
      occurredAt: command.occurredAt,
      createdAt: command.occurredAt,
      source: command.source,
      actor: command.actor,
      contactId: null,
      outcome: null,
      metadata: command.metadata,
      isDemo: true,
      demoWorkspaceId: 9,
      demoKey: "fixture-stage-changed",
    });

    await expect(new PrismaAdapter().recordApplicationEvent("1", "owner-1", command))
      .resolves.toMatchObject({ replayed: true });
    expect(fake.events()).toHaveLength(1);
  });

  it("fails closed when an inconsistent replay appears inside the transaction", async () => {
    const requestHash = submissionRequestHash({
      applicationId: "1",
      type: command.type,
      occurredAt: command.occurredAt,
      source: command.source,
      actor: command.actor,
      metadata: command.metadata,
      contactId: command.contactId,
      outcome: command.outcome,
      expectedUpdatedAt: command.expectedUpdatedAt,
    });
    fake.setReplayAfterInitialLookup({
      id: 99,
      userId: "owner-1",
      applicationId: 1,
      type: command.type,
      idempotencyKey: command.idempotencyKey,
      requestHash,
      occurredAt: command.occurredAt,
      createdAt: command.occurredAt,
      source: command.source,
      actor: command.actor,
      contactId: null,
      outcome: null,
      metadata: command.metadata,
      isDemo: true,
      demoWorkspaceId: 9,
      demoKey: "foreign:event:replay",
    });

    await expect(new PrismaAdapter().recordApplicationEvent("1", "owner-1", command))
      .rejects.toThrow("demo_marker_conflict");
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

  it("serializes every batch create against the demo lifecycle while preserving partial success", async () => {
    fake.demoWorkspaceCount
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);

    const result = await new PrismaAdapter().batchUpsertApplications("owner-1", [
      { company: "First", role: "Engineer" },
      { company: "Second", role: "Designer" },
    ]);

    expect(result).toMatchObject({
      succeeded: 1,
      failed: 1,
      results: [
        { index: 0, operation: "created" },
        { index: 1, operation: "created", error: "demo_workspace_exists" },
      ],
    });
    expect(fake.ownerLock).toHaveBeenCalledTimes(2);
    expect((fake.prisma as { $transaction: ReturnType<typeof vi.fn> }).$transaction).toHaveBeenCalledTimes(2);
    expect((fake.prisma.application as { create: ReturnType<typeof vi.fn> }).create).toHaveBeenCalledTimes(1);
  });

  it("requires a visible matching parent on event reads", async () => {
    const adapter = new PrismaAdapter();
    await adapter.listApplicationEventsFiltered("owner-1", { limit: 10, order: "newest" }, { demoVisibility: "exclude" });
    expect((fake.prisma.applicationEvent as { findMany: ReturnType<typeof vi.fn> }).findMany)
      .toHaveBeenLastCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          userId: "owner-1",
          isDemo: false,
          application: { userId: "owner-1", isDemo: false },
        }),
      }));

    await adapter.listApplicationEvents("1", "owner-1", 10, { demoVisibility: "only" });
    expect((fake.prisma.applicationEvent as { findMany: ReturnType<typeof vi.fn> }).findMany)
      .toHaveBeenLastCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          applicationId: 1,
          userId: "owner-1",
          isDemo: true,
          application: { userId: "owner-1", isDemo: true },
        }),
      }));
  });

  it("rolls back projection changes when event creation fails", async () => {
    fake.setFailCreate(true);
    await expect(new PrismaAdapter().recordApplicationEvent("1", "owner-1", command)).rejects.toThrow("event_write_failed");
    expect(fake.app()).toMatchObject({ status: "applied", currentStage: "screen" });
    expect(fake.events()).toHaveLength(0);
  });
});
