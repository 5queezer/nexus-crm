import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAuth } from "@/lib/session";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const application = await getDb().getApplication(id, auth.readScopeUserId);

  if (!application) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(application);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const { company, role, status, appliedAt, lastContact, followUpAt, notes, jobDescription, source, resumeId, archivedAt } = body;

  const application = await getDb().updateApplication(id, auth.userId, {
    ...(company !== undefined && { company: String(company).slice(0, 255) }),
    ...(role !== undefined && { role: String(role).slice(0, 255) }),
    ...(status !== undefined && { status }),
    ...(appliedAt !== undefined && {
      appliedAt: appliedAt ? new Date(appliedAt) : null,
    }),
    ...(lastContact !== undefined && {
      lastContact: lastContact ? new Date(lastContact) : null,
    }),
    ...(followUpAt !== undefined && {
      followUpAt: followUpAt ? new Date(followUpAt) : null,
    }),
    ...(notes !== undefined && { notes: notes ? String(notes).slice(0, 10000) : null }),
    ...(jobDescription !== undefined && {
      jobDescription: jobDescription ? String(jobDescription).slice(0, 50000) : null,
    }),
    ...(source !== undefined && {
      source: source ? String(source).slice(0, 100) : null,
    }),
    ...(resumeId !== undefined && {
      resumeId: resumeId ? String(resumeId).slice(0, 255) : null,
    }),
    ...(archivedAt !== undefined && {
      archivedAt: archivedAt ? new Date(archivedAt) : null,
    }),
  });

  return NextResponse.json(application);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  await getDb().deleteApplication(id, auth.userId);

  return NextResponse.json({ success: true });
}
