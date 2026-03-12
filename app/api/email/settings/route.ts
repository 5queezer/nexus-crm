import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/email/settings — get current user's email integration settings
 */
export async function GET(): Promise<NextResponse> {
  const auth = await requireAuth();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const integration = await prisma.emailIntegration.findUnique({
    where: { userId: auth.userId },
    select: {
      provider: true,
      enabled: true,
      scanFrequency: true,
      autoImport: true,
      scanDaysBack: true,
      lastScanAt: true,
      lastHistoryId: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ integration });
}

/**
 * PATCH /api/email/settings — update email integration preferences
 */
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();

  // Validate allowed fields
  const allowedFields = ["enabled", "scanFrequency", "autoImport", "scanDaysBack"];
  const update: Record<string, unknown> = {};

  for (const key of allowedFields) {
    if (key in body) {
      update[key] = body[key];
    }
  }

  // Validate values
  if ("scanFrequency" in update) {
    const freq = update.scanFrequency as number;
    if (![15, 30, 60].includes(freq)) {
      return NextResponse.json(
        { error: "scanFrequency must be 15, 30, or 60" },
        { status: 400 }
      );
    }
  }

  if ("autoImport" in update) {
    const mode = update.autoImport as string;
    if (!["off", "review", "auto"].includes(mode)) {
      return NextResponse.json(
        { error: "autoImport must be 'off', 'review', or 'auto'" },
        { status: 400 }
      );
    }
  }

  if ("scanDaysBack" in update) {
    const days = update.scanDaysBack as number;
    if (days < 1 || days > 30) {
      return NextResponse.json(
        { error: "scanDaysBack must be between 1 and 30" },
        { status: 400 }
      );
    }
  }

  const existing = await prisma.emailIntegration.findUnique({
    where: { userId: auth.userId },
  });

  if (!existing) {
    return NextResponse.json(
      { error: "No email integration configured. Connect your email first." },
      { status: 404 }
    );
  }

  const updated = await prisma.emailIntegration.update({
    where: { userId: auth.userId },
    data: update,
    select: {
      provider: true,
      enabled: true,
      scanFrequency: true,
      autoImport: true,
      scanDaysBack: true,
      lastScanAt: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ integration: updated });
}

/**
 * DELETE /api/email/settings — disconnect email integration
 */
export async function DELETE(): Promise<NextResponse> {
  const auth = await requireAuth();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Delete integration and all scanned emails
  await prisma.scannedEmail.deleteMany({ where: { userId: auth.userId } });
  await prisma.emailIntegration.deleteMany({ where: { userId: auth.userId } });

  return NextResponse.json({ success: true });
}
