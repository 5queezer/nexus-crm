import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAuth } from "@/lib/session";
import { normalizeStatus, normalizeSource, COMPANY_SIZE_OPTIONS, INCOMING_SOURCE_OPTIONS } from "@/types";
import { resolveAppliedAtForCreate } from "@/lib/applications/defaults";
import { parseStructuredApplicationMetadata } from "@/lib/applications/metadata";
import { validateApplicationSummary } from "@/lib/applications/events";

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

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const pageParam = searchParams.get("page");
  const pageSizeParam = searchParams.get("pageSize");

  // If pagination params are provided, use paginated endpoint
  if (pageParam || pageSizeParam) {
    const page = pageParam ? parseInt(pageParam, 10) : 1;
    const pageSize = pageSizeParam ? parseInt(pageSizeParam, 10) : 10;

    if (isNaN(page) || isNaN(pageSize) || page < 1 || pageSize < 1) {
      return NextResponse.json({ error: "Invalid pagination parameters" }, { status: 400 });
    }

    const result = await getDb().listApplicationsPaginated(auth.readScopeUserId, { page, pageSize });
    return NextResponse.json(result);
  }

  // Default: return all (backward compatible)
  const applications = await getDb().listApplications(auth.readScopeUserId);
  return NextResponse.json(applications);
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { company, role, status, appliedAt, lastContact, followUpAt, notes, jobDescription, source, remote, salaryMin, salaryMax, rating, jobUrl, companySize, salaryBandMentioned, triageQuality, triageReason, incomingSource, autoRejected, autoRejectReason } = body;

  if (!company || !role) {
    return NextResponse.json(
      { error: "company and role are required" },
      { status: 400 }
    );
  }

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
  let validatedNotes: string | null;
  try {
    validatedNotes = validateApplicationSummary(notes);
    structuredMetadata = parseStructuredApplicationMetadata(body as Record<string, unknown>);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid structured metadata" },
      { status: 400 },
    );
  }

  try {
    const application = await getDb().createApplication(auth.userId, {
      company: String(company).slice(0, 255),
      role: String(role).slice(0, 255),
      status: normalizeStatus(status || "inbound"),
      appliedAt: resolveAppliedAtForCreate(status || "inbound", appliedAt),
      lastContact: lastContact ? new Date(lastContact) : null,
      followUpAt: followUpAt ? new Date(followUpAt) : null,
      notes: validatedNotes,
      jobDescription: jobDescription ? String(jobDescription).slice(0, 50000) : null,
      source: normalizeSource(source),
      remote: !!remote,
      salaryMin: parsedSalaryMin,
      salaryMax: parsedSalaryMax,
      rating: parsedRating,
      jobUrl: jobUrl ? String(jobUrl).slice(0, 2000) : null,
      companySize: companySize && VALID_COMPANY_SIZES.includes(String(companySize)) ? String(companySize) : null,
      salaryBandMentioned: parseBooleanField(salaryBandMentioned),
      triageQuality: parseTriageQuality(triageQuality),
      triageReason: triageReason ? String(triageReason).slice(0, 1000) : null,
      incomingSource: incomingSource && VALID_INCOMING_SOURCES.includes(String(incomingSource)) ? String(incomingSource) : null,
      autoRejected: parseBooleanField(autoRejected),
      autoRejectReason: autoRejectReason ? String(autoRejectReason).slice(0, 1000) : null,
      ...structuredMetadata,
    });

    return NextResponse.json(application, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "canonical_job_url_conflict") {
      return NextResponse.json({ error: "An application with this canonical job URL already exists" }, { status: 409 });
    }
    if (error instanceof Error && error.message === "appliedAt_invalid") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to create application" }, { status: 500 });
  }
}
