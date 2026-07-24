import { PrismaAdapter } from "@/lib/db/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { deriveEventProjection } from "@/lib/applications/events";
import { submissionRequestHash } from "@/lib/applications/submission";

const events = new PrismaAdapter();

function lifecycleEvent(status: string): {
  type: "stage_changed" | "offer_received" | "application_rejected";
  metadata: Record<string, unknown>;
} | null {
  if (status === "interview") {
    return { type: "stage_changed", metadata: { toStatus: "interview", toStage: "interview" } };
  }
  if (status === "offer") return { type: "offer_received", metadata: {} };
  if (status === "rejected") return { type: "application_rejected", metadata: {} };
  return null;
}

export async function recordEmailLifecycleTransition(input: {
  applicationId: number;
  userId: string;
  status: string;
  occurredAt: Date;
  scannedEmailId: number;
  expectedUpdatedAt: Date;
}): Promise<void> {
  const command = lifecycleEvent(input.status);
  if (!command) {
    throw new Error("invalid_email_lifecycle_status");
  }

  await events.recordApplicationEvent(String(input.applicationId), input.userId, {
    type: command.type,
    occurredAt: input.occurredAt,
    source: "email",
    actor: "system",
    metadata: command.metadata,
    idempotencyKey: `email-lifecycle:${input.scannedEmailId}:${input.status}`,
    expectedUpdatedAt: input.expectedUpdatedAt,
  });
}

export async function createEmailApplicationWithLifecycle(input: {
  userId: string;
  company: string;
  role: string;
  status: string;
  occurredAt: Date;
  scannedEmailId: number;
}): Promise<number> {
  const command = lifecycleEvent(input.status);
  return prisma.$transaction(async (tx) => {
    const application = await tx.application.create({
      data: {
        userId: input.userId,
        company: input.company,
        role: input.role,
        status: command ? "applied" : input.status,
        source: "email",
        appliedAt: input.occurredAt,
      },
    });
    if (!command) return application.id;

    const { patch, metadata } = deriveEventProjection(
      { type: command.type, occurredAt: input.occurredAt, metadata: command.metadata },
      { status: "applied", currentStage: null, followUpAt: null },
    );
    await tx.application.update({
      where: { id: application.id, userId: input.userId },
      data: { ...patch, eventVersion: { increment: 1 } },
    });
    const idempotencyKey = `email-lifecycle:new:${input.scannedEmailId}:${input.status}`;
    const requestHash = submissionRequestHash({
      applicationId: String(application.id),
      type: command.type,
      occurredAt: input.occurredAt,
      source: "email",
      actor: "system",
      metadata,
    });
    await tx.applicationEvent.create({
      data: {
        userId: input.userId,
        applicationId: application.id,
        type: command.type,
        idempotencyKey,
        requestHash,
        occurredAt: input.occurredAt,
        source: "email",
        actor: "system",
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
    return application.id;
  });
}
