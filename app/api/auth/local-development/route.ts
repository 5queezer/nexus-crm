import { NextResponse } from "next/server";
import { isLocalDevelopmentAuthEnabled } from "@/lib/auth/local-development";

export function GET() {
  return NextResponse.json({ enabled: isLocalDevelopmentAuthEnabled() });
}
