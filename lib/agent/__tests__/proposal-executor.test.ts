import { describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "@/lib/db/adapter";
import type { ApplicationRecord } from "@/lib/db/types";
import type { ProposalRecord } from "../proposals";
import type {
  ExecutionProposalRecord,
  ProposalExecutionRepository,
  VerificationRecord,
} from "../proposal-executor";
import { approveProposal, rejectProposal } from "../proposal-executor";
import { canonicalizeMcpCall } from "../mcp-proposal";

function application(overrides: Partial<ApplicationRecord> = {}): ApplicationRecord {
  return {
    id: "1", userId: "user-a", company: "Acme", role: "Engineer", status: "applied",
    appliedAt: null, lastContact: null, followUpAt: null, notes: null,
    jobDescription: null, source: null, remote: true, salaryMin: null, salaryMax: null,
    rating: null, jobUrl: null, canonicalJobUrl: null, resumeId: null, companySize: null,
    salaryBandMentioned: false, triageQuality: null, triageReason: null, incomingSource: null,
    autoRejected: false, autoRejectReason: null, archivedAt: null, workMode: null,
    eligibleCountries: [], primaryLocations: [], officeDaysMin: null, travelPercent: null,
    visaSponsorship: null, rightToWorkRequired: null, timezoneOverlap: null,
    salaryCurrency: null, salaryPeriod: null, salaryType: null, atsName: null,
    requisitionId: null, jobCapturedAt: null, jobVerifiedAt: null, jobPostedAt: null,
    jobClosedAt: null, jobContentHash: null, jobLiveness: null, jobSummary: null,
    currentStage: null, createdAt: new Date("2026-07-01T00:00:00Z"),
    updatedAt: new Date("2026-07-10T00:00:00Z"), ...overrides,
  };
}

function proposal(overrides: Partial<ProposalRecord> = {}): ExecutionProposalRecord {
  return {
    id: "proposal-1", userId: "user-a", threadId: "thread-1", runId: null,
    toolInvocationId: null, kind: "update_application", targetType: "application", targetId: "1",
    payload: { status: "interview" },
    expectedDiff: [{ field: "status", from: "applied", to: "interview" }],
    assumptions: null, baseVersion: new Date("2026-07-10T00:00:00Z"),
    idempotencyKey: "idempotency-1", status: "pending",
    expiresAt: new Date(Date.now() + 60_000), executedAt: null,
    createdAt: new Date(), updatedAt: new Date(), verification: null, ...overrides,
  };
}

class MemoryExecutionRepository implements ProposalExecutionRepository {
  value: ExecutionProposalRecord;
  verification: VerificationRecord | null = null;
  transitions: string[] = [];
  constructor(value = proposal()) { this.value = value; }
  async find(userId: string, id: string) {
    return this.value.userId === userId && this.value.id === id
      ? { ...this.value, verification: this.verification }
      : null;
  }
  async transition(userId: string, id: string, from: string[], status: string) {
    if (this.value.userId !== userId || this.value.id !== id || !from.includes(this.value.status)) return false;
    this.value = { ...this.value, status, executedAt: status.startsWith("applied") ? new Date() : this.value.executedAt };
    this.transitions.push(status);
    return true;
  }
  async saveVerification(input: Omit<VerificationRecord, "id" | "createdAt">) {
    this.verification = { ...input, id: "verification-1", createdAt: new Date() };
    return this.verification;
  }
}

const MCP_SCHEMA = {
  type: "object",
  properties: { query: { type: "string" } },
  required: ["query"],
  additionalProperties: false,
};
const MCP_VERSION = new Date("2026-07-10T00:00:00.000Z");

function mcpProposal(overrides: Partial<ProposalRecord> = {}): ExecutionProposalRecord {
  const reviewed = canonicalizeMcpCall({ query: "platform" }, MCP_SCHEMA);
  return proposal({
    kind: "mcp_tool",
    targetType: "mcp_connector",
    targetId: "connector-a",
    baseVersion: null,
    payload: {
      connectorVersion: MCP_VERSION.toISOString(),
      toolName: "search_jobs",
      arguments: reviewed.arguments,
      argumentsHash: reviewed.argumentsHash,
      toolSchemaHash: reviewed.schemaHash,
    },
    ...overrides,
  });
}

function mcpConnectorRepository(updatedAt = MCP_VERSION) {
  return {
    async find(userId: string, id: string) {
      return userId === "user-a" && id === "connector-a"
        ? {
            id,
            userId,
            name: "Research",
            url: "https://mcp.example.com/api",
            encryptedAuthorization: null,
            enabled: true,
            lastCheckedAt: null,
            lastStatus: null,
            lastErrorCode: null,
            createdAt: new Date(),
            updatedAt,
          }
        : null;
    },
    async list() { return []; },
    async upsert() { throw new Error("unused"); },
    async remove() { return false; },
  };
}

const discoverMcp = vi.fn(async () => [{
  name: "research__search_jobs",
  remoteName: "search_jobs",
  description: "Search jobs",
  inputSchema: MCP_SCHEMA,
}]);

describe("proposal executor", () => {
  it("rejects cross-user approval without reading or mutating Nexus", async () => {
    const repository = new MemoryExecutionRepository();
    const db = { getApplication: vi.fn(), updateApplication: vi.fn() } as unknown as DatabaseAdapter;
    await expect(approveProposal({ repository, db, userId: "user-b", proposalId: "proposal-1" }))
      .rejects.toThrow("Proposal not found");
    expect(db.getApplication).not.toHaveBeenCalled();
  });

  it("marks an expired proposal and performs no mutation", async () => {
    const repository = new MemoryExecutionRepository(proposal({ expiresAt: new Date(Date.now() - 1) }));
    const db = { updateApplication: vi.fn() } as unknown as DatabaseAdapter;
    await expect(approveProposal({ repository, db, userId: "user-a", proposalId: "proposal-1" }))
      .rejects.toThrow("Proposal expired");
    expect(repository.value.status).toBe("expired");
    expect(db.updateApplication).not.toHaveBeenCalled();
  });

  it("detects stale Nexus state before applying", async () => {
    const repository = new MemoryExecutionRepository();
    const db = {
      getApplication: vi.fn().mockResolvedValue(application({ updatedAt: new Date("2026-07-11T00:00:00Z") })),
      updateApplication: vi.fn(),
    } as unknown as DatabaseAdapter;
    await expect(approveProposal({ repository, db, userId: "user-a", proposalId: "proposal-1" }))
      .rejects.toThrow("Proposal is stale");
    expect(repository.value.status).toBe("stale");
    expect(db.updateApplication).not.toHaveBeenCalled();
  });

  it("applies exact stored arguments with optimistic concurrency and verifies read-back", async () => {
    const repository = new MemoryExecutionRepository();
    const before = application();
    const after = application({ status: "interview", updatedAt: new Date("2026-07-12T00:00:00Z") });
    const db = {
      getApplication: vi.fn().mockResolvedValueOnce(before).mockResolvedValueOnce(after),
      updateApplication: vi.fn().mockImplementation(async () => {
        expect(repository.value.status).toBe("outcome_unknown");
        return after;
      }),
    } as unknown as DatabaseAdapter;

    const result = await approveProposal({ repository, db, userId: "user-a", proposalId: "proposal-1" });

    expect(db.updateApplication).toHaveBeenCalledWith("1", "user-a", {
      status: "interview",
      expectedUpdatedAt: new Date("2026-07-10T00:00:00Z"),
    });
    expect(result.verification!.success).toBe(true);
    expect(repository.value.status).toBe("applied");
  });

  it("returns recorded outcome when approval is retried", async () => {
    const repository = new MemoryExecutionRepository(proposal({ status: "applied" }));
    repository.verification = {
      id: "verification-1", proposalId: "proposal-1", userId: "user-a", success: true,
      expected: { status: "interview" }, actual: { status: "interview" }, mismatches: null,
      createdAt: new Date(),
    };
    const db = { updateApplication: vi.fn() } as unknown as DatabaseAdapter;
    const result = await approveProposal({ repository, db, userId: "user-a", proposalId: "proposal-1" });
    expect(result.verification!.id).toBe("verification-1");
    expect(db.updateApplication).not.toHaveBeenCalled();
  });

  it("records a visible verification mismatch after mutation", async () => {
    const repository = new MemoryExecutionRepository();
    const db = {
      getApplication: vi.fn().mockResolvedValueOnce(application()).mockResolvedValueOnce(application({ status: "applied" })),
      updateApplication: vi.fn().mockResolvedValue(application({ status: "interview" })),
    } as unknown as DatabaseAdapter;
    const result = await approveProposal({ repository, db, userId: "user-a", proposalId: "proposal-1" });
    expect(result.verification!.success).toBe(false);
    expect(repository.value.status).toBe("applied_unverified");
    expect(result.verification!.mismatches).toEqual([{ field: "status", expected: "interview", actual: "applied" }]);
  });

  it("executes an approved MCP proposal with the exact stored connector, tool, and arguments", async () => {
    const repository = new MemoryExecutionRepository(mcpProposal());
    const callMcp = vi.fn().mockImplementation(async () => {
      expect(repository.value.status).toBe("outcome_unknown");
      return { content: [{ type: "text", text: "result" }] };
    });

    const result = await approveProposal({
      repository,
      connectorRepository: mcpConnectorRepository(),
      callMcp,
      discoverMcp,
      db: {} as DatabaseAdapter,
      userId: "user-a",
      proposalId: "proposal-1",
    });

    expect(callMcp).toHaveBeenCalledWith(
      expect.objectContaining({ id: "connector-a", authorization: null }),
      "search_jobs",
      { query: "platform" },
    );
    expect(result.verification!.success).toBe(true);
    expect(repository.value.status).toBe("applied");
  });

  it("preserves outcome uncertainty when the remote call rejects", async () => {
    const repository = new MemoryExecutionRepository(mcpProposal());

    await expect(
      approveProposal({
        repository,
        db: {} as DatabaseAdapter,
        connectorRepository: mcpConnectorRepository(),
        callMcp: vi.fn().mockRejectedValue(new Error("remote included sensitive detail")),
        discoverMcp,
        userId: "user-a",
        proposalId: "proposal-1",
      }),
    ).rejects.toThrow("remote included sensitive detail");

    expect(repository.value.status).toBe("outcome_unknown");
  });

  it("rejects MCP approval when the reviewed connector version changed", async () => {
    const repository = new MemoryExecutionRepository(mcpProposal());
    const callMcp = vi.fn();
    await expect(
      approveProposal({
        repository,
        db: {} as DatabaseAdapter,
        connectorRepository: mcpConnectorRepository(new Date("2026-07-11T00:00:00.000Z")),
        callMcp,
        discoverMcp,
        userId: "user-a",
        proposalId: "proposal-1",
      }),
    ).rejects.toThrow("Proposal is stale");
    expect(repository.value.status).toBe("stale");
    expect(callMcp).not.toHaveBeenCalled();
  });

  it("records MCP protocol errors as applied but unverified", async () => {
    const repository = new MemoryExecutionRepository(mcpProposal());
    const result = await approveProposal({
      repository,
      db: {} as DatabaseAdapter,
      connectorRepository: mcpConnectorRepository(),
      callMcp: vi.fn().mockResolvedValue({ isError: true, content: [{ type: "text", text: "denied" }] }),
      discoverMcp,
      userId: "user-a",
      proposalId: "proposal-1",
    });
    expect(result.verification!.success).toBe(false);
    expect(repository.value.status).toBe("applied_unverified");
  });

  it("records malformed MCP responses as applied but unverified", async () => {
    const repository = new MemoryExecutionRepository(mcpProposal());
    const result = await approveProposal({
      repository,
      db: {} as DatabaseAdapter,
      connectorRepository: mcpConnectorRepository(),
      callMcp: vi.fn().mockResolvedValue({ unexpected: true }),
      discoverMcp,
      userId: "user-a",
      proposalId: "proposal-1",
    });
    expect(result.verification!.success).toBe(false);
    expect(repository.value.status).toBe("applied_unverified");
  });

  it("preserves outcome_unknown when MCP bookkeeping fails after dispatch", async () => {
    const repository = new MemoryExecutionRepository(mcpProposal());
    vi.spyOn(repository, "saveVerification").mockRejectedValue(new Error("database unavailable"));
    await expect(
      approveProposal({
        repository,
        db: {} as DatabaseAdapter,
        connectorRepository: mcpConnectorRepository(),
        callMcp: vi.fn().mockResolvedValue({ content: [] }),
        discoverMcp,
        userId: "user-a",
        proposalId: "proposal-1",
      }),
    ).rejects.toThrow("database unavailable");
    expect(repository.value.status).toBe("outcome_unknown");
  });

  it("preserves outcome_unknown when CRM read-back fails after mutation", async () => {
    const repository = new MemoryExecutionRepository();
    const db = {
      getApplication: vi.fn().mockResolvedValueOnce(application()).mockRejectedValueOnce(new Error("database unavailable")),
      updateApplication: vi.fn().mockResolvedValue(application({ status: "interview" })),
    } as unknown as DatabaseAdapter;
    await expect(
      approveProposal({ repository, db, userId: "user-a", proposalId: "proposal-1" }),
    ).rejects.toThrow("database unavailable");
    expect(repository.value.status).toBe("outcome_unknown");
  });

  it("returns an outcome_unknown proposal without dispatching it again", async () => {
    const repository = new MemoryExecutionRepository(mcpProposal({ status: "outcome_unknown" }));
    const callMcp = vi.fn();
    const result = await approveProposal({
      repository,
      db: {} as DatabaseAdapter,
      connectorRepository: mcpConnectorRepository(),
      callMcp,
      discoverMcp,
      userId: "user-a",
      proposalId: "proposal-1",
    });
    expect(result.proposal.status).toBe("outcome_unknown");
    expect(result.verification).toBeNull();
    expect(callMcp).not.toHaveBeenCalled();
  });

  it("rejects a pending proposal without mutating Nexus", async () => {
    const repository = new MemoryExecutionRepository();
    const rejected = await rejectProposal(repository, "user-a", "proposal-1");
    expect(rejected.status).toBe("rejected");
    await expect(rejectProposal(repository, "user-b", "proposal-1")).rejects.toThrow("Proposal not found");
  });
});
