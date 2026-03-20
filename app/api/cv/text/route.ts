import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import { getDb } from "@/lib/db";
import { mergeCvData } from "@/lib/cv/generate";

export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const applicationId = req.nextUrl.searchParams.get("applicationId");
  if (!applicationId) {
    return NextResponse.json({ error: "applicationId required" }, { status: 400 });
  }

  const db = getDb();

  // Verify application ownership
  const app = await db.getApplication(applicationId, session.readScopeUserId);
  if (!app) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const profile = await db.getCvProfile(session.userId);
  if (!profile) {
    return NextResponse.json({ text: "" });
  }

  const patch = await db.getCvPatch(applicationId, session.userId);
  if (!patch) {
    return NextResponse.json({ text: "" });
  }

  const { data: merged } = mergeCvData(profile, patch);

  // Build plain text representation for keyword analysis
  const lines: string[] = [
    merged.name,
    merged.profile,
    "",
    ...merged.skills.flatMap((s) => [`${s.category}: ${s.items.join(", ")}`]),
    "",
    ...merged.experience.flatMap((e) => [
      `${e.company} — ${e.title}`,
      ...e.bullets,
    ]),
    "",
    ...merged.projects.map((p) => `${p.name}: ${p.description} (${p.stack})`),
    "",
    ...merged.education.map((e) => `${e.degree}, ${e.institution}`),
  ];

  return NextResponse.json({ text: lines.join("\n") });
}
