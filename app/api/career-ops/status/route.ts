import { NextResponse } from "next/server";
import { getCareerOpsStatus } from "@/lib/career-ops/service";
import { requireCareerOpsSession, unauthorized } from "@/lib/career-ops/http";

export async function GET() {
  const session = await requireCareerOpsSession();
  if (!session) return unauthorized();

  const status = await getCareerOpsStatus();
  return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
}
