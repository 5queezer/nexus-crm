import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuthOrToken } from "@/lib/session";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAuthOrToken(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const application = await prisma.application.findUnique({
    where: { id: numericId },
  });

  if (!application) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(application);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAuthOrToken(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const body = await request.json();
  const { company, role, status, appliedAt, lastContact, followUpAt, notes } = body;

  const application = await prisma.application.update({
    where: { id: numericId },
    data: {
      ...(company !== undefined && { company: String(company).slice(0, 255) }),
      ...(role !== undefined && { role: String(role).slice(0, 255) }),
      ...(status !== undefined && { status }),
      ...(appliedAt !== undefined && {
        appliedAt: appliedAt ? new Date(appliedAt) : null,
      }),
      ...(lastContact !== undefined && {
        lastContact: lastContact ? new Date(lastContact) : null,
      }),
      ...(followUpAt !== undefined && {
        followUpAt: followUpAt ? new Date(followUpAt) : null,
      }),
      ...(notes !== undefined && { notes: notes ? String(notes).slice(0, 10000) : null }),
    },
  });

  return NextResponse.json(application);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAuthOrToken(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  await prisma.application.delete({
    where: { id: numericId },
  });

  return NextResponse.json({ success: true });
}
