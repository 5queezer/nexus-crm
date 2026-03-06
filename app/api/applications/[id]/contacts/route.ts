import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuthOrToken } from "@/lib/session";
import { requireUserId } from "@/lib/tenant";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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

  const { id } = await params;
  const applicationId = Number(id);
  if (!Number.isInteger(applicationId) || applicationId <= 0) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  // Verify the application belongs to the requesting user
  const application = await prisma.application.findFirst({
    where: { id: applicationId, userId },
  });
  if (!application) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json();
  const { name, email, phone, role, linkedIn } = body;

  if (!name || !String(name).trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const contact = await prisma.contact.create({
    data: {
      applicationId,
      name: String(name).slice(0, 255),
      email: email ? String(email).slice(0, 255) : null,
      phone: phone ? String(phone).slice(0, 50) : null,
      role: role ? String(role).slice(0, 100) : null,
      linkedIn: linkedIn ? String(linkedIn).slice(0, 500) : null,
    },
  });

  return NextResponse.json(contact, { status: 201 });
}
