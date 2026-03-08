import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
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

  const { id: applicationId } = await params;

  // Verify the application belongs to the requesting user
  if (!(await getDb().verifyApplicationOwner(applicationId, userId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json();
  const { name, email, phone, role, linkedIn } = body;

  if (!name || !String(name).trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const contact = await getDb().createContact(applicationId, {
    name: String(name).slice(0, 255),
    email: email ? String(email).slice(0, 255) : null,
    phone: phone ? String(phone).slice(0, 50) : null,
    role: role ? String(role).slice(0, 100) : null,
    linkedIn: linkedIn ? String(linkedIn).slice(0, 500) : null,
  });

  return NextResponse.json(contact, { status: 201 });
}
