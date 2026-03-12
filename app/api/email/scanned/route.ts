import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { normalizeStatus } from "@/types";

/**
 * GET /api/email/scanned — list scanned emails for the current user
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status"); // "pending" | "imported" | "dismissed"

  const where: Record<string, unknown> = { userId: auth.userId };
  if (status && ["pending", "imported", "dismissed"].includes(status)) {
    where.status = status;
  }

  const emails = await prisma.scannedEmail.findMany({
    where,
    orderBy: { receivedAt: "desc" },
    take: 100,
  });

  return NextResponse.json({
    emails: emails.map((e) => ({
      id: String(e.id),
      messageId: e.messageId,
      subject: e.subject,
      sender: e.sender,
      receivedAt: e.receivedAt.toISOString(),
      classification: e.classification,
      confidence: e.confidence,
      extractedData: e.extractedData ? JSON.parse(e.extractedData) : null,
      status: e.status,
      applicationId: e.applicationId ? String(e.applicationId) : null,
      createdAt: e.createdAt.toISOString(),
    })),
  });
}

/**
 * PATCH /api/email/scanned — bulk action on scanned emails
 * Body: { ids: string[], action: "import" | "dismiss" }
 * For "import", optionally include overrides: { company, role, status }
 */
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { ids, action, overrides } = body as {
    ids: string[];
    action: "import" | "dismiss";
    overrides?: { company?: string; role?: string; status?: string };
  };

  if (!ids?.length || !["import", "dismiss"].includes(action)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (ids.length > 100) {
    return NextResponse.json(
      { error: "Maximum 100 IDs per request" },
      { status: 400 }
    );
  }

  const numericIds = ids.map((id) => parseInt(id, 10));

  if (action === "dismiss") {
    await prisma.scannedEmail.updateMany({
      where: { id: { in: numericIds }, userId: auth.userId, status: "pending" },
      data: { status: "dismissed" },
    });
    return NextResponse.json({ success: true });
  }

  // Import: create applications from scanned emails
  const emails = await prisma.scannedEmail.findMany({
    where: { id: { in: numericIds }, userId: auth.userId, status: "pending" },
  });

  let imported = 0;
  for (const email of emails) {
    const data = email.extractedData ? JSON.parse(email.extractedData) : {};
    const company = overrides?.company || data.company || "Unknown Company";
    const role = overrides?.role || data.role || "Unknown Role";
    const status = overrides?.status
      ? normalizeStatus(overrides.status)
      : email.classification === "rejection"
        ? "rejected"
        : email.classification === "interview"
          ? "interview"
          : email.classification === "offer"
            ? "offer"
            : "applied";

    // Dedup: check for existing application
    const existing = await prisma.application.findFirst({
      where: {
        userId: auth.userId,
        company: { equals: company, mode: "insensitive" },
        role: { equals: role, mode: "insensitive" },
      },
    });

    let appId: number;
    if (existing) {
      appId = existing.id;
      // Update status if it's a progression (rejected is terminal, not a promotion)
      const statusOrder: Record<string, number> = { applied: 0, interview: 1, offer: 2 };
      const newRank = statusOrder[status] ?? -1;
      const currentRank = statusOrder[existing.status] ?? -1;
      const isProgression = status === "rejected" || (newRank > currentRank && currentRank >= 0);
      if (isProgression && existing.status !== "rejected") {
        await prisma.application.update({
          where: { id: existing.id },
          data: { status },
        });
      }
    } else {
      const app = await prisma.application.create({
        data: {
          userId: auth.userId,
          company,
          role,
          status,
          source: "email",
          appliedAt: email.receivedAt,
        },
      });
      appId = app.id;
    }

    await prisma.scannedEmail.update({
      where: { id: email.id },
      data: { status: "imported", applicationId: appId },
    });
    imported++;
  }

  return NextResponse.json({ success: true, imported });
}
