import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuthOrToken } from "@/lib/session";
import { requireUserId } from "@/lib/tenant";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; contactId: string }> }
) {
  const auth = await requireAuthOrToken(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let userId: string;
  try {
    userId = requireUserId(auth.userId);
  } catch {
    return NextResponse.json({ error: "Session required" }, { status: 403 });
  }

  const { id, contactId } = await params;
  const applicationId = Number(id);
  const numericContactId = Number(contactId);

  if (
    !Number.isInteger(applicationId) || applicationId <= 0 ||
    !Number.isInteger(numericContactId) || numericContactId <= 0
  ) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const body = await request.json();
  const { name, email, phone, role, linkedIn } = body;

  // Update contact only if the parent application belongs to this user
  const contact = await prisma.contact.update({
    where: {
      id: numericContactId,
      applicationId,
      application: { userId },
    },
    data: {
      ...(name !== undefined && { name: String(name).slice(0, 255) }),
      ...(email !== undefined && { email: email ? String(email).slice(0, 255) : null }),
      ...(phone !== undefined && { phone: phone ? String(phone).slice(0, 50) : null }),
      ...(role !== undefined && { role: role ? String(role).slice(0, 100) : null }),
      ...(linkedIn !== undefined && { linkedIn: linkedIn ? String(linkedIn).slice(0, 500) : null }),
    },
  });

  return NextResponse.json(contact);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; contactId: string }> }
) {
  const auth = await requireAuthOrToken(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let userId: string;
  try {
    userId = requireUserId(auth.userId);
  } catch {
    return NextResponse.json({ error: "Session required" }, { status: 403 });
  }

  const { id, contactId } = await params;
  const applicationId = Number(id);
  const numericContactId = Number(contactId);

  if (
    !Number.isInteger(applicationId) || applicationId <= 0 ||
    !Number.isInteger(numericContactId) || numericContactId <= 0
  ) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  // Delete contact only if the parent application belongs to this user
  await prisma.contact.delete({
    where: {
      id: numericContactId,
      applicationId,
      application: { userId },
    },
  });

  return NextResponse.json({ success: true });
}
