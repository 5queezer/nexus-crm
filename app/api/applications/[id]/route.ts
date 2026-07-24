import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAuth } from "@/lib/session";
import { normalizeStatus, normalizeSource, COMPANY_SIZE_OPTIONS, INCOMING_SOURCE_OPTIONS } from "@/types";
import { parseStructuredApplicationMetadata } from "@/lib/applications/metadata";
import { validateApplicationSummary } from "@/lib/applications/events";
import { parseLocalCalendarDate } from "@/lib/applications/local-calendar";

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
  const db = getDb();
  const current = await db.getApplication(id, auth.userId);
  if (!current) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const body = await request.json();
  const { company, role, status, appliedAt, lastContact, followUpAt, notes, jobDescription, source, remote, salaryMin, salaryMax, rating, jobUrl, resumeId, archivedAt, companySize, salaryBandMentioned, triageQuality, triageReason, incomingSource, autoRejected, autoRejectReason } = body;

  const parsedSalaryMin = salaryMin != null && salaryMin !== "" ? Number(salaryMin) : null;
  const parsedSalaryMax = salaryMax != null && salaryMax !== "" ? Number(salaryMax) : null;
  const parsedRating = rating != null && rating !== "" ? Number(rating) : null;
  if (
    (parsedSalaryMin !== null && (!Number.isInteger(parsedSalaryMin) || parsedSalaryMin < 0)) ||
    (parsedSalaryMax !== null && (!Number.isInteger(parsedSalaryMax) || parsedSalaryMax < 0))
  ) {
    return NextResponse.json({ error: "salary values must be non-negative integers" }, { status: 400 });
  }
  if (parsedRating !== null && (!Number.isInteger(parsedRating) || parsedRating < 1 || parsedRating > 5)) {
    return NextResponse.json({ error: "rating must be an integer from 1 to 5" }, { status: 400 });
  }
  if (parsedSalaryMin != null && parsedSalaryMax != null && parsedSalaryMin > parsedSalaryMax) {
    return NextResponse.json(
      { error: "salaryMin must not exceed salaryMax" },
      { status: 400 }
    );
  }

  let structuredMetadata;
  let validatedNotes: string | null | undefined;
  const rawNotes: unknown = notes === undefined ? undefined : notes === null || notes === "" ? null : notes;
  const notesChanged = notes !== undefined && rawNotes !== current.notes;
  try {
    validatedNotes = notesChanged ? validateApplicationSummary(rawNotes) : undefined;
    structuredMetadata = parseStructuredApplicationMetadata(body as Record<string, unknown>);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid structured metadata" },
      { status: 400 },
    );
  }

  let expectedUpdatedAt: Date | undefined;
  if (body.expectedUpdatedAt !== undefined) {
    expectedUpdatedAt = new Date(String(body.expectedUpdatedAt));
    if (Number.isNaN(expectedUpdatedAt.getTime())) {
      return NextResponse.json({ error: "invalid_expected_updated_at" }, { status: 400 });
    }
  }

  const parseLifecycleDate = (raw: unknown): Date | null | "invalid" => {
    if (raw === null || raw === "") return null;
    if (typeof raw !== "string") return "invalid";
    return parseLocalCalendarDate(raw) ?? "invalid";
  };
  const sameDate = (raw: unknown, existing: Date | null) => {
    const next = parseLifecycleDate(raw);
    if (next === "invalid") return false;
    if (next === null) return existing === null;
    if (next.getTime() === existing?.getTime()) return true;
    return /^\d{4}-\d{2}-\d{2}$/.test(raw as string)
      && raw === existing?.toISOString().slice(0, 10);
  };
  const lifecycleDates = { appliedAt, lastContact, followUpAt };
  const invalidLifecycleFields = Object.entries(lifecycleDates)
    .filter(([, raw]) => raw !== undefined && parseLifecycleDate(raw) === "invalid")
    .map(([field]) => field);
  if (invalidLifecycleFields.length) {
    return NextResponse.json(
      { error: "invalid_lifecycle_date", fields: invalidLifecycleFields },
      { status: 400 },
    );
  }
  const lifecycleFields: string[] = [];
  if (status !== undefined && normalizeStatus(status) !== current.status) lifecycleFields.push("status");
  if (appliedAt !== undefined && !sameDate(appliedAt, current.appliedAt)) lifecycleFields.push("appliedAt");
  if (lastContact !== undefined && !sameDate(lastContact, current.lastContact)) lifecycleFields.push("lastContact");
  if (followUpAt !== undefined && !sameDate(followUpAt, current.followUpAt)) lifecycleFields.push("followUpAt");
  if (structuredMetadata.currentStage !== undefined && structuredMetadata.currentStage !== current.currentStage) {
    lifecycleFields.push("currentStage");
  }
  if (lifecycleFields.length) {
    return NextResponse.json({ error: "lifecycle_event_required", fields: lifecycleFields }, { status: 409 });
  }
  const nonLifecycleMetadata = { ...structuredMetadata };
  delete nonLifecycleMetadata.currentStage;

  try {
    const application = await db.updateApplication(id, auth.userId, {
    ...(company !== undefined && { company: String(company).slice(0, 255) }),
    ...(role !== undefined && { role: String(role).slice(0, 255) }),
    ...(notesChanged && { notes: validatedNotes }),
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
      rating: parsedRating,
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
    ...nonLifecycleMetadata,
    ...(expectedUpdatedAt !== undefined && {
      expectedUpdatedAt,
    }),
    });

    return NextResponse.json(application);
  } catch (error) {
    const code = error instanceof Error ? error.message : "update_failed";
    const responseStatus = code === "conflict" || code === "canonical_job_url_conflict"
      ? 409
      : code === "not_found"
        ? 404
        : 400;
    return NextResponse.json({ error: code }, { status: responseStatus });
  }
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
  try {
    await getDb().deleteApplication(id, auth.userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    const code = error instanceof Error ? error.message : "delete_failed";
    return NextResponse.json({ error: code }, { status: code === "not_found" ? 404 : 400 });
  }
}
