import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DatabaseAdapter } from "@/lib/db/adapter";
import type { UpdateApplicationInput } from "@/lib/db/types";
import type { ProposalRecord } from "./proposals";
import {
  getConnectorSecret,
  type ConnectorRepository,
} from "./connectors";
import { callMcpTool, discoverMcpTools } from "./mcp-client";
import { canonicalizeMcpCall } from "./mcp-proposal";

export type ProposalExecutionErrorCode =
  | "NOT_FOUND"
  | "TARGET_NOT_FOUND"
  | "EXPIRED"
  | "STALE"
  | "NOT_PENDING"
  | "IN_PROGRESS"
  | "UNSUPPORTED";

export class ProposalExecutionError extends Error {
  constructor(
    public readonly code: ProposalExecutionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProposalExecutionError";
  }
}

function executionError(code: ProposalExecutionErrorCode, message: string): never {
  throw new ProposalExecutionError(code, message);
}

export type VerificationRecord = {
  id: string;
  proposalId: string;
  userId: string;
  success: boolean;
  expected: Record<string, unknown>;
  actual: Record<string, unknown>;
  mismatches: Array<{ field: string; expected: unknown; actual: unknown }> | null;
  createdAt: Date;
};

export type ExecutionProposalRecord = ProposalRecord & {
  verification: VerificationRecord | null;
};

export interface ProposalExecutionRepository {
  find(userId: string, id: string): Promise<ExecutionProposalRecord | null>;
  transition(userId: string, id: string, from: string[], status: string): Promise<boolean>;
  saveVerification(
    input: Omit<VerificationRecord, "id" | "createdAt">,
  ): Promise<VerificationRecord>;
}

function mapVerification(record: {
  id: string;
  proposalId: string;
  userId: string;
  success: boolean;
  expected: unknown;
  actual: unknown;
  mismatches: unknown;
  createdAt: Date;
}): VerificationRecord {
  return {
    ...record,
    expected: record.expected as Record<string, unknown>,
    actual: record.actual as Record<string, unknown>,
    mismatches: record.mismatches as VerificationRecord["mismatches"],
  };
}

export const prismaProposalExecutionRepository: ProposalExecutionRepository = {
  async find(userId, id) {
    const record = await prisma.actionProposal.findFirst({
      where: { id, userId },
      include: { verification: true },
    });
    if (!record) return null;
    return {
      ...record,
      payload: record.payload as Record<string, unknown>,
      expectedDiff: record.expectedDiff as unknown as ProposalRecord["expectedDiff"],
      verification: record.verification ? mapVerification(record.verification) : null,
    };
  },
  async transition(userId, id, from, status) {
    const result = await prisma.actionProposal.updateMany({
      where: { id, userId, status: { in: from } },
      data: {
        status,
        ...(status === "applied" || status === "applied_unverified" || status === "outcome_unknown"
          ? { executedAt: new Date() }
          : {}),
      },
    });
    return result.count === 1;
  },
  async saveVerification(input) {
    const record = await prisma.agentVerificationResult.upsert({
      where: { proposalId: input.proposalId },
      create: {
        userId: input.userId,
        proposalId: input.proposalId,
        success: input.success,
        expected: input.expected as Prisma.InputJsonValue,
        actual: input.actual as Prisma.InputJsonValue,
        mismatches: input.mismatches as unknown as Prisma.InputJsonValue,
      },
      update: {},
    });
    return mapVerification(record);
  },
};

function toUpdateInput(proposal: ExecutionProposalRecord): UpdateApplicationInput {
  const input: UpdateApplicationInput = {};
  for (const [field, value] of Object.entries(proposal.payload)) {
    if (field === "followUpAt" || field === "lastContact") {
      input[field] = value === null ? null : new Date(String(value));
    } else if (field === "status" && typeof value === "string") input.status = value;
    else if (field === "notes" && (typeof value === "string" || value === null)) input.notes = value;
    else if (field === "rating" && (typeof value === "number" || value === null)) input.rating = value;
    else executionError("UNSUPPORTED", "Unsupported proposal payload");
  }
  if (proposal.baseVersion) input.expectedUpdatedAt = proposal.baseVersion;
  return input;
}

function actualValue(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value;
}

async function approveMcpProposal(input: {
  repository: ProposalExecutionRepository;
  connectorRepository: ConnectorRepository;
  userId: string;
  proposal: ExecutionProposalRecord;
  call: typeof callMcpTool;
  discover: typeof discoverMcpTools;
}) {
  const connector = await getConnectorSecret(
    input.connectorRepository,
    input.userId,
    input.proposal.targetId,
  );
  if (!connector) executionError("TARGET_NOT_FOUND", "Proposal target not found");
  const toolName = input.proposal.payload.toolName;
  const args = input.proposal.payload.arguments;
  const argumentsHash = input.proposal.payload.argumentsHash;
  const toolSchemaHash = input.proposal.payload.toolSchemaHash;
  const connectorVersion = input.proposal.payload.connectorVersion;
  if (
    typeof toolName !== "string" ||
    !args ||
    typeof args !== "object" ||
    Array.isArray(args) ||
    typeof argumentsHash !== "string" ||
    typeof toolSchemaHash !== "string" ||
    typeof connectorVersion !== "string"
  ) {
    executionError("UNSUPPORTED", "Unsupported proposal payload");
  }
  if (connector.updatedAt.toISOString() !== connectorVersion) {
    await input.repository.transition(input.userId, input.proposal.id, ["pending"], "stale");
    executionError("STALE", "Proposal is stale");
  }
  const available = await input.discover(connector);
  const selected = available.find((candidate) => candidate.remoteName === toolName);
  if (!selected) {
    await input.repository.transition(input.userId, input.proposal.id, ["pending"], "stale");
    executionError("STALE", "Proposal is stale");
  }
  const reviewed = canonicalizeMcpCall(
    args as Record<string, unknown>,
    selected.inputSchema,
  );
  if (reviewed.argumentsHash !== argumentsHash || reviewed.schemaHash !== toolSchemaHash) {
    await input.repository.transition(input.userId, input.proposal.id, ["pending"], "stale");
    executionError("STALE", "Proposal is stale");
  }
  const claimed = await input.repository.transition(
    input.userId,
    input.proposal.id,
    ["pending"],
    "executing",
  );
  if (!claimed) executionError("IN_PROGRESS", "Proposal is already being processed");

  const armed = await input.repository.transition(
    input.userId,
    input.proposal.id,
    ["executing"],
    "outcome_unknown",
  );
  if (!armed) throw new Error("External outcome could not be armed");

  const externalResult = await input.call(connector, toolName, reviewed.arguments);

  const validShape =
    externalResult &&
    typeof externalResult === "object" &&
    "content" in externalResult &&
    Array.isArray(externalResult.content);
  const protocolError =
    !validShape ||
    ("isError" in externalResult && externalResult.isError === true);
  const content = validShape ? externalResult.content : undefined;
  const verification = await input.repository.saveVerification({
    proposalId: input.proposal.id,
    userId: input.userId,
    success: !protocolError,
    expected: {
      connectorId: connector.id,
      connectorVersion,
      toolName,
      argumentsHash,
      toolSchemaHash,
    },
    actual: {
      completed: true,
      protocolError,
      contentItems: Array.isArray(content) ? content.length : 0,
    },
    mismatches: protocolError
      ? [{ field: "isError", expected: false, actual: true }]
      : null,
  });
  const status = verification.success ? "applied" : "applied_unverified";
  const completed = await input.repository.transition(
    input.userId,
    input.proposal.id,
    ["outcome_unknown"],
    status,
  );
  if (!completed) throw new Error("External outcome could not be finalized");
  const proposal =
    (await input.repository.find(input.userId, input.proposal.id)) ?? input.proposal;
  return { proposal, verification, externalResult };
}

export async function approveProposal(input: {
  repository: ProposalExecutionRepository;
  db: DatabaseAdapter;
  connectorRepository?: ConnectorRepository;
  callMcp?: typeof callMcpTool;
  discoverMcp?: typeof discoverMcpTools;
  userId: string;
  proposalId: string;
}) {
  let proposal = await input.repository.find(input.userId, input.proposalId);
  if (!proposal) executionError("NOT_FOUND", "Proposal not found");
  if (
    (proposal.status === "applied" || proposal.status === "applied_unverified") &&
    proposal.verification
  ) {
    return { proposal, verification: proposal.verification };
  }
  if (proposal.status === "outcome_unknown") {
    return { proposal, verification: proposal.verification };
  }
  if (proposal.status !== "pending") executionError("NOT_PENDING", "Proposal is not pending");
  if (proposal.expiresAt.getTime() <= Date.now()) {
    await input.repository.transition(input.userId, proposal.id, ["pending"], "expired");
    executionError("EXPIRED", "Proposal expired");
  }
  if (proposal.kind === "mcp_tool" && proposal.targetType === "mcp_connector") {
    if (!input.connectorRepository) executionError("UNSUPPORTED", "MCP execution is unavailable");
    return approveMcpProposal({
      repository: input.repository,
      connectorRepository: input.connectorRepository,
      userId: input.userId,
      proposal,
      call: input.callMcp ?? callMcpTool,
      discover: input.discoverMcp ?? discoverMcpTools,
    });
  }
  if (proposal.kind !== "update_application" || proposal.targetType !== "application") {
    executionError("UNSUPPORTED", "Unsupported proposal kind");
  }

  const current = await input.db.getApplication(proposal.targetId, input.userId);
  if (!current) executionError("TARGET_NOT_FOUND", "Proposal target not found");
  if (
    proposal.baseVersion &&
    current.updatedAt.getTime() !== proposal.baseVersion.getTime()
  ) {
    await input.repository.transition(input.userId, proposal.id, ["pending"], "stale");
    executionError("STALE", "Proposal is stale");
  }

  const updateInput = toUpdateInput(proposal);
  const claimed = await input.repository.transition(
    input.userId,
    proposal.id,
    ["pending"],
    "executing",
  );
  if (!claimed) executionError("IN_PROGRESS", "Proposal is already being processed");

  const armed = await input.repository.transition(
    input.userId,
    proposal.id,
    ["executing"],
    "outcome_unknown",
  );
  if (!armed) throw new Error("Applied outcome could not be armed");

  try {
    await input.db.updateApplication(
      proposal.targetId,
      input.userId,
      updateInput,
    );
  } catch (error) {
    if (error instanceof Error && error.message === "conflict") {
      await input.repository.transition(input.userId, proposal.id, ["outcome_unknown"], "stale");
      executionError("STALE", "Proposal is stale");
    }
    throw error;
  }

  const readBack = await input.db.getApplication(proposal.targetId, input.userId);
    if (!readBack) throw new Error("Applied target could not be verified");
    const expected = Object.fromEntries(
      proposal.expectedDiff.map((diff) => [diff.field, diff.to]),
    );
    const actual = Object.fromEntries(
      proposal.expectedDiff.map((diff) => [
        diff.field,
        actualValue(readBack[diff.field as keyof typeof readBack]),
      ]),
    );
    const mismatches = proposal.expectedDiff
      .filter((diff) => !Object.is(actual[diff.field], diff.to))
      .map((diff) => ({ field: diff.field, expected: diff.to, actual: actual[diff.field] }));
    const verification = await input.repository.saveVerification({
      proposalId: proposal.id,
      userId: input.userId,
      success: mismatches.length === 0,
      expected,
      actual,
      mismatches: mismatches.length ? mismatches : null,
    });
    const status = verification.success ? "applied" : "applied_unverified";
    const finalized = await input.repository.transition(
      input.userId,
      proposal.id,
      ["outcome_unknown"],
      status,
    );
    if (!finalized) throw new Error("Applied outcome could not be finalized");
  proposal = (await input.repository.find(input.userId, proposal.id)) ?? proposal;
  return { proposal, verification };
}

export async function rejectProposal(
  repository: ProposalExecutionRepository,
  userId: string,
  proposalId: string,
) {
  const existing = await repository.find(userId, proposalId);
  if (!existing) executionError("NOT_FOUND", "Proposal not found");
  if (existing.status !== "pending") executionError("NOT_PENDING", "Proposal is not pending");
  const rejected = await repository.transition(userId, proposalId, ["pending"], "rejected");
  if (!rejected) executionError("IN_PROGRESS", "Proposal is already being processed");
  return (await repository.find(userId, proposalId))!;
}
