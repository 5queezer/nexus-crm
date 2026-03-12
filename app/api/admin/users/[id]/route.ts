import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/session";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (!auth) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  if (typeof body?.isAdmin !== "boolean") {
    return NextResponse.json({ error: "isAdmin must be a boolean" }, { status: 400 });
  }

  const { id } = await params;

  // Prevent self-demotion
  if (id === auth.userId && !body.isAdmin) {
    return NextResponse.json(
      { error: "Cannot remove your own admin status. Ask another admin." },
      { status: 400 }
    );
  }

  const users = await getDb().listUsers();
  const target = users.find((user) => user.id === id);

  if (!target) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const adminCount = users.filter((user) => user.isAdmin).length;
  if (target.isAdmin && !body.isAdmin && adminCount <= 1) {
    return NextResponse.json(
      { error: "At least one admin user is required" },
      { status: 400 }
    );
  }

  const db = getDb();
  const updated = await db.updateUserAdmin(id, body.isAdmin);

  // Write audit log
  const action = body.isAdmin ? "grant_admin" : "revoke_admin";
  await db.createAuditLog(auth.userId, action, id);

  return NextResponse.json(updated);
}
