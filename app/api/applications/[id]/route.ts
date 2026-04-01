import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAuth } from "@/lib/session";
import { normalizeStatus, normalizeSource, COMPANY_SIZE_OPTIONS, INCOMING_SOURCE_OPTIONS } from "@/types";

const VALID_COMPANY_SIZES = COMPANY_SIZE_OPTIONS.map((o) => o.value) as string[];
const VALID_INCOMING_SOURCES = INCOMING_SOURCE_OPTIONS as readonly string[];

function parseTriageQuality(value: unknown): number | null {
  if (value == null) return null;
  const parsed = parseInt(String(value), 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 5 ? parsed : null;
}

function parseBooleanField(value: unknown): boolean {
  return value === true || value === "true";
}

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
  const { company, role, status, appliedAt, lastContact, followUpAt, notes, jobDescription, source, remote, salaryMin, salaryMax, rating, jobUrl, resumeId, archivedAt, companySize, salaryBandMentioned, triageQuality, triageReason, incomingSource, autoRejected, autoRejectReason } = body;

  const parsedSalaryMin = salaryMin != null ? parseInt(String(salaryMin), 10) : null;
  const parsedSalaryMax = salaryMax != null ? parseInt(String(salaryMax), 10) : null;
  if (parsedSalaryMin != null && parsedSalaryMax != null && parsedSalaryMin > parsedSalaryMax) {
    return NextResponse.json(
      { error: "salaryMin must not exceed salaryMax" },
      { status: 400 }
    );
  }

  const application = await getDb().updateApplication(id, auth.userId, {
    ...(company !== undefined && { company: String(company).slice(0, 255) }),
    ...(role !== undefined && { role: String(role).slice(0, 255) }),
    ...(status !== undefined && { status: normalizeStatus(status) }),
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
      source: normalizeSource(source),
    }),
    ...(remote !== undefined && { remote: !!remote }),
    ...(salaryMin !== undefined && { salaryMin: parsedSalaryMin }),
    ...(salaryMax !== undefined && { salaryMax: parsedSalaryMax }),
    ...(rating !== undefined && {
      rating: rating != null ? Math.min(5, Math.max(1, parseInt(String(rating), 10))) : null,
    }),
    ...(jobUrl !== undefined && {
      jobUrl: jobUrl ? String(jobUrl).slice(0, 2000) : null,
    }),
    ...(resumeId !== undefined && {
      resumeId: resumeId ? String(resumeId).slice(0, 255) : null,
    }),
    ...(companySize !== undefined && {
      companySize: companySize && VALID_COMPANY_SIZES.includes(String(companySize)) ? String(companySize) : null,
    }),
    ...(salaryBandMentioned !== undefined && { salaryBandMentioned: parseBooleanField(salaryBandMentioned) }),
    ...(triageQuality !== undefined && {
      triageQuality: parseTriageQuality(triageQuality),
    }),
    ...(triageReason !== undefined && {
      triageReason: triageReason ? String(triageReason).slice(0, 1000) : null,
    }),
    ...(incomingSource !== undefined && {
      incomingSource: incomingSource && VALID_INCOMING_SOURCES.includes(String(incomingSource)) ? String(incomingSource) : null,
    }),
    ...(autoRejected !== undefined && { autoRejected: parseBooleanField(autoRejected) }),
    ...(autoRejectReason !== undefined && {
      autoRejectReason: autoRejectReason ? String(autoRejectReason).slice(0, 1000) : null,
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
