import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { createDemoFixtures } from "@/lib/demo-workspace/fixtures";
import { requireSessionAuth } from "@/lib/session";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };

export async function POST() {
  const auth = await requireSessionAuth({ allowDevBypass: false });
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  try {
    const result = await getDb().ensureDemoWorkspace(auth.userId, createDemoFixtures());
    return NextResponse.json(result, { status: result.replayed ? 200 : 201, headers: NO_STORE });
  } catch (error) {
    if (error instanceof Error && error.message === "real_applications_exist") {
      return NextResponse.json({ error: "real_applications_exist" }, { status: 409, headers: NO_STORE });
    }
    if (error instanceof Error && error.message === "demo_version_conflict") {
      return NextResponse.json({ error: "demo_version_conflict" }, { status: 409, headers: NO_STORE });
    }
    return NextResponse.json({ error: "demo_workspace_failed" }, { status: 500, headers: NO_STORE });
  }
}

export async function DELETE() {
  const auth = await requireSessionAuth({ allowDevBypass: false });
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  try {
    const result = await getDb().deleteDemoWorkspace(auth.userId);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "demo_workspace_delete_failed" }, { status: 500, headers: NO_STORE });
  }
}
