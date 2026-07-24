import { PrismaAdapter } from "@/lib/db/prisma-adapter";

const events = new PrismaAdapter();

type EmailLifecycleStatus = "interview" | "offer" | "rejected";

export async function recordEmailLifecycleTransition(input: {
  applicationId: number;
  userId: string;
  status: string;
  occurredAt: Date;
  scannedEmailId: number;
  expectedUpdatedAt: Date;
}): Promise<void> {
  if (!["interview", "offer", "rejected"].includes(input.status)) {
    throw new Error("invalid_email_lifecycle_status");
  }
  const status = input.status as EmailLifecycleStatus;
  const type = status === "offer"
    ? "offer_received"
    : status === "rejected"
      ? "application_rejected"
      : "stage_changed";
  const metadata = status === "interview"
    ? { toStatus: "interview", toStage: "interview" }
    : {};

  await events.recordApplicationEvent(String(input.applicationId), input.userId, {
    type,
    occurredAt: input.occurredAt,
    source: "email",
    actor: "system",
    metadata,
    idempotencyKey: `email-lifecycle:${input.scannedEmailId}:${input.status}`,
    expectedUpdatedAt: input.expectedUpdatedAt,
  });
}
