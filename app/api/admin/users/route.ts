import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/session";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getDb();
  const users = await db.listUsers();
  const stats = await db.listUserApplicationStats(users.map((user) => user.id));
  return NextResponse.json(
    users.map((user) => ({
      ...user,
      applicationCount: stats[user.id]?.applicationCount ?? 0,
      demoWorkspace: stats[user.id]?.demoWorkspace ?? false,
    })),
  );
}
