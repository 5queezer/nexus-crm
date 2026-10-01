import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/session";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getDb();
  const [users, stats] = await Promise.all([db.listUsers(), db.listUserApplicationStats()]);
  return NextResponse.json(
    users.map((user) => ({
      ...user,
      applicationCount: stats[user.id]?.applicationCount ?? 0,
      demoWorkspace: stats[user.id]?.demoWorkspace ?? false,
    })),
  );
}
