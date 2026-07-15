import { describe, expect, it, vi } from "vitest";
import type { ApplicationRecord } from "@/lib/db/types";
import type { DatabaseAdapter } from "@/lib/db/adapter";
import {
  getApplicationForAgent,
  getPipelineSummary,
  searchApplicationsForAgent,
} from "../tools";
import type { ProposalRecord, ProposalRepository } from "../proposals";
import { proposeApplicationUpdate } from "../proposals";

function application(overrides: Partial<ApplicationRecord> = {}): ApplicationRecord {
  return {
    id: "1",
    userId: "user-a",
    company: "Acme",
    role: "Platform Engineer",
    status: "applied",
    appliedAt: new Date("2026-07-01T00:00:00Z"),
    lastContact: null,
    followUpAt: null,
    notes: null,
    jobDescription: "Untrusted job text",
    source: "manual",
    remote: true,
    salaryMin: null,
    salaryMax: null,
    rating: 4,
    jobUrl: null,
    canonicalJobUrl: null,
    resumeId: null,
    companySize: null,
    salaryBandMentioned: false,
    triageQuality: null,
    triageReason: null,
    incomingSource: null,
    autoRejected: false,
    autoRejectReason: null,
    archivedAt: null,
    workMode: "remote",
    eligibleCountries: [],
    primaryLocations: [],
    officeDaysMin: null,
    travelPercent: null,
    visaSponsorship: null,
    rightToWorkRequired: null,
    timezoneOverlap: null,
    salaryCurrency: null,
    salaryPeriod: null,
    salaryType: null,
    atsName: null,
    requisitionId: null,
    jobCapturedAt: null,
    jobVerifiedAt: null,
    jobPostedAt: null,
    jobClosedAt: null,
    jobContentHash: null,
    jobLiveness: null,
    jobSummary: null,
    currentStage: null,
    createdAt: new Date("2026-07-01T00:00:00Z"),
    updatedAt: new Date("2026-07-10T00:00:00Z"),
    ...overrides,
  };
}

class MemoryProposalRepository implements ProposalRepository {
  proposals: ProposalRecord[] = [];
  async create(input: Omit<ProposalRecord, "id" | "createdAt" | "updatedAt">) {
    const now = new Date();
    const proposal = { ...input, id: `proposal-${this.proposals.length + 1}`, createdAt: now, updatedAt: now };
    this.proposals.push(proposal);
    return proposal;
  }
  async findByIdempotencyKey(userId: string, key: string) {
    return this.proposals.find((proposal) => proposal.userId === userId && proposal.idempotencyKey === key) ?? null;
  }
}

describe("tenant-scoped Nexus agent tools", () => {
  it("always scopes pipeline reads to the authenticated user", async () => {
    const db = {
      listApplications: vi.fn().mockResolvedValue([
        application(),
        application({ id: "2", status: "interview", company: "Beta" }),
      ]),
    } as unknown as DatabaseAdapter;

    const summary = await getPipelineSummary(db, "user-a");

    expect(db.listApplications).toHaveBeenCalledWith("user-a");
    expect(summary.total).toBe(2);
    expect(summary.byStatus).toMatchObject({ applied: 1, interview: 1 });
  });

  it("searches only the user's applications and minimizes returned content", async () => {
    const db = {
      listApplications: vi.fn().mockResolvedValue([
        application(),
        application({ id: "2", company: "Beta", role: "Designer" }),
      ]),
    } as unknown as DatabaseAdapter;

    const results = await searchApplicationsForAgent(db, "user-a", "platform");

    expect(db.listApplications).toHaveBeenCalledWith("user-a");
    expect(results).toHaveLength(1);
    expect(results[0]).not.toHaveProperty("jobDescription");
  });

  it("looks up application details with scoped, bounded, explicitly untrusted context", async () => {
    const db = { getApplication: vi.fn().mockResolvedValue(application({
      notes: "n".repeat(3_000),
      jobSummary: "s".repeat(3_000),
      jobDescription: "d".repeat(5_000),
    })) } as unknown as DatabaseAdapter;
    const result = await getApplicationForAgent(db, "user-a", "1");
    expect(db.getApplication).toHaveBeenCalledWith("1", "user-a");
    expect(result).not.toHaveProperty("notes");
    expect(result).not.toHaveProperty("jobSummary");
    expect(result?.untrustedExternalContext).toMatchObject({
      label: expect.stringContaining("UNTRUSTED"),
    });
    expect(result?.untrustedExternalContext.notes).toHaveLength(1_500);
    expect(result?.untrustedExternalContext.summary).toHaveLength(1_500);
    expect(result?.untrustedExternalContext.jobDescription).toHaveLength(2_500);
  });
});

describe("application update proposals", () => {
  it("creates a canonical pending proposal without mutating Nexus", async () => {
    const db = {
      getApplication: vi.fn().mockResolvedValue(application()),
      updateApplication: vi.fn().mockRejectedValue(new Error("must not execute")),
    } as unknown as DatabaseAdapter;
    const repository = new MemoryProposalRepository();

    const proposal = await proposeApplicationUpdate({
      db,
      repository,
      userId: "user-a",
      threadId: "thread-1",
      runId: "run-1",
      applicationId: "1",
      changes: { status: "interview", followUpAt: "2026-07-20T09:00:00.000Z" },
      reason: "Recruiter invited me to an interview",
      idempotencyKey: "test-key",
    });

    expect(db.updateApplication).not.toHaveBeenCalled();
    expect(proposal).toMatchObject({
      userId: "user-a",
      kind: "update_application",
      targetId: "1",
      status: "pending",
      baseVersion: new Date("2026-07-10T00:00:00Z"),
      payload: { status: "interview", followUpAt: "2026-07-20T09:00:00.000Z" },
    });
    expect(proposal.expectedDiff).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "status", from: "applied", to: "interview" })]),
    );
  });

  it("rejects cross-user targets and unsupported fields", async () => {
    const db = { getApplication: vi.fn().mockResolvedValue(null) } as unknown as DatabaseAdapter;
    const repository = new MemoryProposalRepository();

    await expect(
      proposeApplicationUpdate({
        db,
        repository,
        userId: "user-b",
        applicationId: "1",
        changes: { status: "offer" },
        reason: "test",
      }),
    ).rejects.toThrow("Application not found");

    const ownedDb = { getApplication: vi.fn().mockResolvedValue(application()) } as unknown as DatabaseAdapter;
    await expect(
      proposeApplicationUpdate({
        db: ownedDb,
        repository,
        userId: "user-a",
        applicationId: "1",
        changes: { company: "Hijacked" } as never,
        reason: "test",
      }),
    ).rejects.toThrow("Unsupported application change");
  });

  it("accepts inbound and rejects non-canonical application statuses", async () => {
    const db = { getApplication: vi.fn().mockResolvedValue(application()) } as unknown as DatabaseAdapter;
    const repository = new MemoryProposalRepository();

    await expect(
      proposeApplicationUpdate({
        db,
        repository,
        userId: "user-a",
        applicationId: "1",
        changes: { status: "inbound" },
        reason: "Saved for later",
      }),
    ).resolves.toMatchObject({ payload: { status: "inbound" } });

    await expect(
      proposeApplicationUpdate({
        db,
        repository,
        userId: "user-a",
        applicationId: "1",
        changes: { status: "wishlist" },
        reason: "Invalid legacy label",
      }),
    ).rejects.toThrow("Unsupported application status");
  });

  it("returns the winning proposal after a concurrent idempotency conflict", async () => {
    const db = { getApplication: vi.fn().mockResolvedValue(application()) } as unknown as DatabaseAdapter;
    const winner = new MemoryProposalRepository();
    const existing = await winner.create({
      userId: "user-a",
      threadId: null,
      runId: null,
      toolInvocationId: null,
      kind: "update_application",
      targetType: "application",
      targetId: "1",
      payload: { status: "interview" },
      expectedDiff: [],
      assumptions: null,
      baseVersion: application().updatedAt,
      idempotencyKey: "race-key",
      status: "pending",
      expiresAt: new Date(Date.now() + 60_000),
      executedAt: null,
    });
    let lookups = 0;
    const repository: ProposalRepository = {
      create: vi.fn().mockRejectedValue(Object.assign(new Error("unique"), {
        code: "P2002",
        meta: { target: ["userId", "idempotencyKey"] },
      })),
      findByIdempotencyKey: vi.fn(async () => (++lookups === 1 ? null : existing)),
    };

    await expect(
      proposeApplicationUpdate({
        db,
        repository,
        userId: "user-a",
        applicationId: "1",
        changes: { status: "interview" },
        reason: "race",
        idempotencyKey: "race-key",
      }),
    ).resolves.toEqual(existing);
  });

  it("rethrows unrelated unique-constraint conflicts", async () => {
    const db = { getApplication: vi.fn().mockResolvedValue(application()) } as unknown as DatabaseAdapter;
    const unrelated = Object.assign(new Error("tool invocation conflict"), {
      code: "P2002",
      meta: { target: ["toolInvocationId"] },
    });
    const repository: ProposalRepository = {
      create: vi.fn().mockRejectedValue(unrelated),
      findByIdempotencyKey: vi.fn().mockResolvedValue(null),
    };

    await expect(
      proposeApplicationUpdate({
        db,
        repository,
        userId: "user-a",
        applicationId: "1",
        changes: { status: "interview" },
        reason: "unrelated conflict",
        idempotencyKey: "unique-key",
      }),
    ).rejects.toBe(unrelated);
    expect(repository.findByIdempotencyKey).toHaveBeenCalledTimes(1);
  });

  it("deduplicates a repeated idempotency key for the same user", async () => {
    const db = { getApplication: vi.fn().mockResolvedValue(application()) } as unknown as DatabaseAdapter;
    const repository = new MemoryProposalRepository();
    const input = {
      db,
      repository,
      userId: "user-a",
      applicationId: "1",
      changes: { status: "interview" },
      reason: "test",
      idempotencyKey: "same-key",
    };

    const first = await proposeApplicationUpdate(input);
    const second = await proposeApplicationUpdate(input);

    expect(second.id).toBe(first.id);
    expect(repository.proposals).toHaveLength(1);
  });
});
