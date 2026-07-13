import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAuth } from "@/lib/session";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: applicationId } = await params;

  if (!(await getDb().verifyApplicationOwner(applicationId, auth.userId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json();
  const { name, email, phone, role, linkedIn } = body;

  if (!name || !String(name).trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const contact = await getDb().createContact(applicationId, auth.userId, {
    name: String(name).slice(0, 255),
    email: email ? String(email).slice(0, 255) : null,
    phone: phone ? String(phone).slice(0, 50) : null,
    role: role ? String(role).slice(0, 100) : null,
    linkedIn: linkedIn ? String(linkedIn).slice(0, 500) : null,
  });

  return NextResponse.json(contact, { status: 201 });
}
