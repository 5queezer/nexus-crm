import { prisma } from "@/lib/prisma";
import { fetchNewMessages, getMessageDetail } from "./gmail";
import { classifyEmail } from "./classifier";

export interface ScanResult {
  userId: string;
  processed: number;
  skipped: number;
  classified: number;
  autoImported: number;
}

/**
 * Scan a single user's inbox for new job-related emails.
 */
export async function scanUserInbox(userId: string): Promise<ScanResult> {
  const result: ScanResult = {
    userId,
    processed: 0,
    skipped: 0,
    classified: 0,
    autoImported: 0,
  };

  const integration = await prisma.emailIntegration.findUnique({
    where: { userId },
  });

  if (!integration || !integration.enabled) {
    return result;
  }

  // Fetch new messages from Gmail
  const { messages, latestHistoryId } = await fetchNewMessages(
    integration.encryptedToken,
    integration.lastHistoryId,
    50,
    integration.scanDaysBack
  );

  for (const msg of messages) {
    // Check if already scanned (dedup by messageId)
    const existing = await prisma.scannedEmail.findUnique({
      where: { userId_messageId: { userId, messageId: msg.id } },
    });
    if (existing) {
      result.skipped++;
      continue;
    }

    try {
      const detail = await getMessageDetail(
        integration.encryptedToken,
        msg.id
      );

      const classification = classifyEmail({
        subject: detail.subject,
        sender: detail.sender,
        bodySnippet: detail.bodySnippet,
      });

      // Skip emails that don't look job-related
      if (!classification.classification) {
        result.skipped++;
        continue;
      }

      const extractedData = JSON.stringify({
        company: classification.company,
        role: classification.role,
      });

      const status =
        integration.autoImport === "auto" ? "imported" : "pending";

      const scanned = await prisma.scannedEmail.create({
        data: {
          userId,
          messageId: detail.messageId,
          subject: detail.subject,
          sender: detail.sender,
          receivedAt: detail.receivedAt,
          classification: classification.classification,
          confidence: classification.confidence,
          extractedData,
          status,
        },
      });

      result.classified++;

      // Auto-import if configured
      if (integration.autoImport === "auto" && classification.company) {
        await autoImportAsApplication(userId, scanned.id, classification);
        result.autoImported++;
      }
    } catch (err) {
      // Log but continue processing other messages
      console.error(`Failed to process message ${msg.id}:`, err);
    }

    result.processed++;
  }

  // Update historyId cursor and last scan time
  await prisma.emailIntegration.update({
    where: { userId },
    data: {
      lastHistoryId: latestHistoryId ?? integration.lastHistoryId,
      lastScanAt: new Date(),
    },
  });

  return result;
}

async function autoImportAsApplication(
  userId: string,
  scannedEmailId: number,
  data: { company: string | null; role: string | null; classification: string | null }
): Promise<void> {
  if (!data.company) return;

  // Check for existing application with same company+role (fuzzy dedup)
  const normalizedCompany = data.company.toLowerCase().trim();
  const normalizedRole = (data.role ?? "").toLowerCase().trim();

  const existing = await prisma.application.findFirst({
    where: {
      userId,
      company: { equals: normalizedCompany, mode: "insensitive" },
      ...(normalizedRole ? { role: { equals: normalizedRole, mode: "insensitive" } } : {}),
    },
  });

  if (existing) {
    // Update status if the new classification is a progression
    const statusOrder = ["applied", "interview", "offer", "rejection"];
    const currentIdx = statusOrder.indexOf(existing.status);
    const newIdx = statusOrder.indexOf(data.classification ?? "applied");

    if (newIdx > currentIdx) {
      await prisma.application.update({
        where: { id: existing.id },
        data: { status: data.classification ?? existing.status },
      });
    }

    // Link the scanned email to the existing application
    await prisma.scannedEmail.update({
      where: { id: scannedEmailId },
      data: { applicationId: existing.id, status: "imported" },
    });
    return;
  }

  // Create new application
  const app = await prisma.application.create({
    data: {
      userId,
      company: data.company,
      role: data.role ?? "Unknown Role",
      status: data.classification === "rejection" ? "rejected" : (data.classification ?? "applied"),
      source: "email",
      appliedAt: new Date(),
    },
  });

  await prisma.scannedEmail.update({
    where: { id: scannedEmailId },
    data: { applicationId: app.id, status: "imported" },
  });
}

/**
 * Scan all enabled users' inboxes.
 * Called by the scheduled scan endpoint.
 */
export async function scanAllInboxes(): Promise<ScanResult[]> {
  const integrations = await prisma.emailIntegration.findMany({
    where: { enabled: true },
    select: { userId: true, scanFrequency: true, lastScanAt: true },
  });

  const results: ScanResult[] = [];

  for (const integration of integrations) {
    // Skip if not enough time has passed since last scan
    if (integration.lastScanAt) {
      const elapsed = Date.now() - integration.lastScanAt.getTime();
      if (elapsed < integration.scanFrequency * 60 * 1000) {
        continue;
      }
    }

    try {
      const result = await scanUserInbox(integration.userId);
      results.push(result);
    } catch (err) {
      console.error(`Scan failed for user ${integration.userId}:`, err);
      results.push({
        userId: integration.userId,
        processed: 0,
        skipped: 0,
        classified: 0,
        autoImported: 0,
      });
    }
  }

  return results;
}
